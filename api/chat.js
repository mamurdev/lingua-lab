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

// Robust helper to save chat turns: tries atomic RPC first, falls back to direct table inserts
async function saveChatTurn(conversationId, userContent, assistantContent) {
  try {
    const { data: savedTurn, error: saveError } = await supabaseAdmin.rpc("save_chat_turn", {
      p_conversation_id: conversationId,
      p_user_content: userContent,
      p_assistant_content: assistantContent,
    });

    if (!saveError && savedTurn && savedTurn.length > 0) {
      return {
        userMsgId: savedTurn[0].user_msg_id,
        assistantMsgId: savedTurn[0].assistant_msg_id,
      };
    }
    if (saveError) {
      console.warn(`[Chat] save_chat_turn RPC notice (${saveError.message}), using direct insert fallback.`);
    }
  } catch (rpcErr) {
    console.warn("[Chat] save_chat_turn RPC exception, using direct insert fallback:", rpcErr);
  }

  // Direct table insert fallback
  const { data: lastMsg } = await supabaseAdmin
    .from("messages")
    .select("sequence")
    .eq("conversation_id", conversationId)
    .order("sequence", { ascending: false })
    .limit(1);

  const nextSeq = (lastMsg && lastMsg.length > 0 && typeof lastMsg[0].sequence === "number" ? lastMsg[0].sequence : 0) + 1;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("messages")
    .insert([
      {
        conversation_id: conversationId,
        role: "user",
        content: userContent,
        sequence: nextSeq,
      },
      {
        conversation_id: conversationId,
        role: "assistant",
        content: assistantContent,
        sequence: nextSeq + 1,
      },
    ])
    .select();

  if (insertError || !inserted || inserted.length < 2) {
    console.error("[Chat] Direct insert error:", insertError);
    throw new Error(insertError?.message || "Failed to persist chat messages to database");
  }

  try {
    await supabaseAdmin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
  } catch {
    // Non-fatal if column doesn't exist
  }

  return {
    userMsgId: inserted[0].id,
    assistantMsgId: inserted[1].id,
  };
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

    const models = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
    const history = conversationHistory.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const wantsStream = req.body.stream !== false;
    let handled = false;
    let lastModelError = null;

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: `You are a helpful language tutor. The user is practicing ${language} at a ${level} level. Respond naturally in ${language}. Correct them gently if needed. Limit response to under 120 words.`,
        });

        const chat = model.startChat({ history });

        if (wantsStream) {
          if (!res.headersSent) {
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            if (typeof res.flushHeaders === "function") res.flushHeaders();
          }

          const resultStream = await chat.sendMessageStream(message);
          let fullReply = "";

          for await (const chunk of resultStream.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              fullReply += chunkText;
              res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
            }
          }

          // Save conversation turn using robust helper
          const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, message, fullReply);

          res.write(`data: ${JSON.stringify({ done: true, reply: fullReply, assistantMsgId, userMsgId })}\n\n`);
          res.end();
          handled = true;
          break;
        } else {
          const result = await chat.sendMessage(message);
          const reply = result.response.text();

          // Save conversation turn using robust helper
          const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, message, reply);

          res.json({ reply, assistantMsgId, userMsgId });
          handled = true;
          break;
        }
      } catch (mErr) {
        console.warn(`[Chat Vercel] Model ${modelName} failed (${mErr.message}), trying next...`);
        lastModelError = mErr;
        if (res.headersSent) break;
      }
    }

    if (!handled && lastModelError) {
      throw lastModelError;
    }
  } catch (error) {
    console.error("Chat error:", error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message || "Failed to process chat with Gemini" })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: error.message || "Failed to process chat with Gemini" });
    }
  }
}
