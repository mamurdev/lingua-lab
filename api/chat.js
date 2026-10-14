import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

async function enforceQuota(userId, kind, dayLimit = 60, minuteLimit = 6) {
  if (!userId) return { allowed: true };
  try {
    const { data, error } = await supabaseAdmin.rpc("check_and_consume_quota", {
      p_user_id: userId,
      p_kind: kind,
      p_day_limit: dayLimit,
      p_minute_limit: minuteLimit,
    });
    if (error) return { allowed: true };
    const row = data && data[0];
    if (row && !row.allowed) return { allowed: false, reason: row.reason };
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace("Bearer ", "") : null;

    let userId = null;
    if (token) {
      const { data: authData } = await supabaseAdmin.auth.getUser(token);
      if (authData?.user) userId = authData.user.id;
    }

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const quota = await enforceQuota(userId, "ai", 60, 6);
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
    }

    const {
      message,
      language = "English",
      level = "Beginner",
      conversationHistory = [],
      conversationId,
    } = req.body;

    if (!message || !conversationId) {
      return res.status(400).json({ error: "Missing message or conversationId" });
    }

    // Verify conversation ownership
    const { data: conv, error: convError } = await supabaseAdmin
      .from("conversations")
      .select("id, user_id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();

    if (convError || !conv) {
      return res.status(404).json({ error: "Conversation not found or access denied" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      systemInstruction: `You are a helpful language tutor. The user is practicing ${language} at a ${level} level. Respond naturally in ${language}. Correct them gently if needed. Limit response to under 120 words.`,
    });

    const history = conversationHistory.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    // Atomically save both messages via the RPC
    const { data: savedTurn, error: saveError } = await supabaseAdmin.rpc("save_chat_turn", {
      p_conversation_id: conversationId,
      p_user_content: message,
      p_assistant_content: reply,
    });

    if (saveError || !savedTurn || savedTurn.length === 0) {
      console.error("[Chat] Failed to save turn:", saveError);
      return res.status(503).json({ error: "Failed to save conversation turn" });
    }

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to process chat with Gemini" });
  }
}
