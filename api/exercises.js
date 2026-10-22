import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("[Startup Error] Missing required SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
}

const supabaseAdmin = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

async function enforceQuota(userId, kind, dayLimit = 60, minuteLimit = 6) {
  if (!userId) return { allowed: false, reason: "Authentication required" };
  const { data, error } = await supabaseAdmin.rpc("check_and_consume_quota", {
    p_user_id: userId,
    p_kind: kind,
    p_day_limit: dayLimit,
    p_minute_limit: minuteLimit,
  });

  if (error) {
    console.error(`[Quota RPC error (${kind})]:`, error);
    throw new Error("Service temporarily unavailable");
  }

  if (data && data.length > 0) {
    const row = data[0];
    if (!row.allowed) return { allowed: false, reason: row.reason || "Quota limit reached" };
    return { allowed: true };
  }

  throw new Error("Service temporarily unavailable");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!supabaseAdmin) {
    console.error("[Startup Error] Supabase admin client not initialized: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  try {
    // 1. Auth
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

    // 2. Input validation
    const { conversationId } = req.body || {};
    if (!conversationId || typeof conversationId !== "string") {
      return res.status(400).json({ error: "Missing or invalid conversationId" });
    }

    // 3. Ownership check
    const { data: conv, error: convError } = await supabaseAdmin
      .from("conversations")
      .select("id, user_id, language, level")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();

    if (convError || !conv) {
      return res.status(404).json({ error: "Conversation not found or access denied" });
    }

    // 4. Quota
    const quota = await enforceQuota(userId, "ai", 60, 6);
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
    }

    // 5. Provider call
    const { data: messages, error: msgError } = await supabaseAdmin
      .from("messages")
      .select("role, content, sequence")
      .eq("conversation_id", conversationId)
      .order("sequence", { ascending: true });

    if (msgError || !messages) {
      console.error("[Quiz] Messages fetch error:", msgError);
      return res.status(500).json({ error: "Failed to load conversation history" });
    }

    if (messages.length < 4) {
      return res.status(400).json({
        error: "At least 2 complete conversational turns (4 messages) are required to generate a review quiz.",
      });
    }

    const transcript = messages
      .slice(-20)
      .map((m) => `${m.role === "assistant" ? "Tutor" : "Learner"}: ${m.content}`)
      .join("\n");

    const prompt = `You are an expert language teacher.
Based on the following actual practice dialogue in ${conv.language} (${conv.level} level), generate a 3-question multiple choice review quiz testing the vocabulary, phrases, or grammar that appeared in the conversation.

CONVERSATION TRANSCRIPT:
${transcript}

Output JSON with this exact schema:
{
  "questions": [
    {
      "prompt": "Clear question testing words or concepts from the conversation",
      "options": ["Option 0", "Option 1", "Option 2", "Option 3"],
      "answerIndex": 0,
      "explanation": "Clear explanation in English of why this answer is correct."
    }
  ]
}

STRICT REQUIREMENTS:
1. Exactly 3 questions.
2. Exactly 4 distinct options per question.
3. answerIndex must be an integer between 0 and 3.
4. Test words or grammar actually used in the transcript.`;

    const models = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
    let result = null;
    let lastError = null;

    for (const m of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: m,
          generationConfig: {
            responseMimeType: "application/json",
          },
        });
        result = await model.generateContent(prompt);
        if (result && result.response) break;
      } catch (err) {
        console.warn(`[Quiz Vercel] Model ${m} failed (${err.message}), trying next...`);
        lastError = err;
      }
    }

    if (!result) {
      console.error("[Quiz] Gemini generation failed:", lastError);
      return res.status(502).json({ error: "Failed to generate quiz. Please try again." });
    }

    const textOutput = result.response.text();
    let parsedQuiz;

    try {
      parsedQuiz = JSON.parse(textOutput);
    } catch {
      console.error("[Quiz] Malformed JSON from AI:", textOutput);
      return res.status(502).json({ error: "Failed to generate valid quiz format. Please try again." });
    }

    if (!parsedQuiz || !Array.isArray(parsedQuiz.questions) || parsedQuiz.questions.length !== 3) {
      console.error("[Quiz] Invalid question count from AI:", parsedQuiz);
      return res.status(502).json({ error: "Failed to generate valid quiz format. Please try again." });
    }

    for (let i = 0; i < parsedQuiz.questions.length; i++) {
      const q = parsedQuiz.questions[i];
      if (!q.prompt || typeof q.prompt !== "string" || q.prompt.trim().length === 0) {
        return res.status(502).json({ error: "Failed to generate valid quiz format. Please try again." });
      }
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        return res.status(502).json({ error: "Failed to generate valid quiz format. Please try again." });
      }
      const uniqueOptions = new Set(q.options.map((o) => String(o).trim()));
      if (uniqueOptions.size !== 4) {
        return res.status(502).json({ error: "Failed to generate valid quiz format. Please try again." });
      }
      if (typeof q.answerIndex !== "number" || q.answerIndex < 0 || q.answerIndex > 3 || !Number.isInteger(q.answerIndex)) {
        return res.status(502).json({ error: "Failed to generate valid quiz format. Please try again." });
      }
      if (!q.explanation || typeof q.explanation !== "string" || q.explanation.trim().length === 0) {
        return res.status(502).json({ error: "Failed to generate valid quiz format. Please try again." });
      }
    }

    const { data: savedExercise, error: saveError } = await supabaseAdmin
      .from("exercises")
      .insert([
        {
          conversation_id: conversationId,
          quiz: parsedQuiz,
        },
      ])
      .select()
      .single();

    if (saveError || !savedExercise) {
      console.error("[Quiz] Failed to persist exercise:", saveError);
      return res.status(500).json({ error: "Failed to save quiz" });
    }

    res.json({ exercise: savedExercise });
  } catch (error) {
    console.error("[Quiz] Error in /api/exercises:", error);
    const status = error?.message === "Service temporarily unavailable" ? 503 : 500;
    const genericMessage = error?.message === "Service temporarily unavailable"
      ? "Service temporarily unavailable"
      : "Failed to generate exercises";
    res.status(status).json({ error: genericMessage });
  }
}
