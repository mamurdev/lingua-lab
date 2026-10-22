import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

const inMemoryQuotaStore = new Map();

function getUtcDateString(d = new Date()) {
  return d.toISOString().split("T")[0];
}

function enforceInMemoryQuota(userId, kind, dayLimit = 60, minuteLimit = 6) {
  const now = new Date();
  const today = getUtcDateString(now);
  const currentMinute = Math.floor(now.getTime() / 60000);
  const storeKey = `${userId}:${kind}`;

  let record = inMemoryQuotaStore.get(storeKey);
  if (!record) {
    record = { day: today, dayCount: 0, minuteWindow: currentMinute, minuteCount: 0 };
    inMemoryQuotaStore.set(storeKey, record);
  }

  if (record.day !== today) {
    record.day = today;
    record.dayCount = 0;
  }

  if (record.minuteWindow !== currentMinute) {
    record.minuteWindow = currentMinute;
    record.minuteCount = 0;
  }

  if (record.dayCount >= dayLimit) {
    return {
      allowed: false,
      reason: `Daily limit reached (${dayLimit} ${kind.toUpperCase()} requests/day). Resets at 00:00 UTC.`,
    };
  }

  if (record.minuteCount >= minuteLimit) {
    return {
      allowed: false,
      reason: `Rate limit exceeded (${minuteLimit} requests/min). Please wait a few moments.`,
    };
  }

  record.dayCount += 1;
  record.minuteCount += 1;
  return { allowed: true };
}

async function enforceQuota(userId, kind, dayLimit = 60, minuteLimit = 6) {
  if (!userId) return { allowed: true };
  try {
    const { data, error } = await supabaseAdmin.rpc("check_and_consume_quota", {
      p_user_id: userId,
      p_kind: kind,
      p_day_limit: dayLimit,
      p_minute_limit: minuteLimit,
    });
    if (!error && data && data.length > 0) {
      const row = data[0];
      if (!row.allowed) return { allowed: false, reason: row.reason || "Quota limit reached" };
      return { allowed: true };
    }
  } catch {
    // fallback
  }
  return enforceInMemoryQuota(userId, kind, dayLimit, minuteLimit);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { conversationId } = req.body;
    if (!conversationId) {
      return res.status(400).json({ error: "Missing conversationId" });
    }

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

    const client = token
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
      : supabaseAdmin;

    const { data: conv, error: convError } = await client
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (convError || !conv) {
      return res.status(404).json({ error: "Conversation not found or access denied" });
    }

    const { data: messages, error: msgError } = await client
      .from("messages")
      .select("role, content, sequence")
      .eq("conversation_id", conversationId)
      .order("sequence", { ascending: true });

    if (msgError || !messages) {
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
      throw lastError || new Error("Failed to generate quiz with AI models");
    }

    const textOutput = result.response.text();
    let parsedQuiz;

    try {
      parsedQuiz = JSON.parse(textOutput);
    } catch {
      return res.status(502).json({ error: "AI generated malformed JSON for quiz" });
    }

    if (!parsedQuiz || !Array.isArray(parsedQuiz.questions) || parsedQuiz.questions.length !== 3) {
      return res.status(502).json({ error: "Quiz must have exactly 3 questions" });
    }

    for (let i = 0; i < parsedQuiz.questions.length; i++) {
      const q = parsedQuiz.questions[i];
      if (!q.prompt || typeof q.prompt !== "string" || q.prompt.trim().length === 0) {
        return res.status(502).json({ error: `Question ${i + 1} has an empty prompt` });
      }
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        return res.status(502).json({ error: `Question ${i + 1} must have exactly 4 options` });
      }
      const uniqueOptions = new Set(q.options.map((o) => String(o).trim()));
      if (uniqueOptions.size !== 4) {
        return res.status(502).json({ error: `Question ${i + 1} contains duplicate options` });
      }
      if (typeof q.answerIndex !== "number" || q.answerIndex < 0 || q.answerIndex > 3 || !Number.isInteger(q.answerIndex)) {
        return res.status(502).json({ error: `Question ${i + 1} has invalid answerIndex` });
      }
      if (!q.explanation || typeof q.explanation !== "string" || q.explanation.trim().length === 0) {
        return res.status(502).json({ error: `Question ${i + 1} is missing an explanation` });
      }
    }

    let saveResult = await supabaseAdmin
      .from("exercises")
      .insert([
        {
          conversation_id: conversationId,
          quiz: parsedQuiz,
        },
      ])
      .select()
      .single();

    if (saveResult.error || !saveResult.data) {
      return res.status(500).json({ error: "Failed to persist exercise to database" });
    }

    res.json({ exercise: saveResult.data });
  } catch (error) {
    console.error("[Quiz] Error in /api/exercises:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate exercises" });
  }
}

