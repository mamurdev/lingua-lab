import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

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
    console.error("[Startup Error] Supabase admin client not initialized");
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  try {
    // 1. Auth check
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace("Bearer ", "") : null;
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !authData?.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = authData.user.id;

    // 2. Input validation
    const { word, context, language = "English" } = req.body || {};
    if (!word || typeof word !== "string" || !word.trim()) {
      return res.status(400).json({ error: "Missing word for vocabulary lookup" });
    }

    const cleanWord = word.trim().replace(/[.,!?;:"'()[\]{}«»¡¿]/g, "");
    if (!cleanWord || cleanWord.length > 100) {
      return res.status(400).json({ error: "Invalid word" });
    }

    if (context && (typeof context !== "string" || context.length > 500)) {
      return res.status(400).json({ error: "Context exceeds maximum length of 500 characters" });
    }

    // 3. Quota check
    let quota;
    try {
      quota = await enforceQuota(userId, "ai", 60, 6);
    } catch {
      return res.status(503).json({ error: "Service temporarily unavailable" });
    }
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
    }

    // 4. Provider call
    const prompt = `You are an expert polyglot language tutor.
Analyze the target word "${cleanWord}" in the language ${language}${context ? ` within the context sentence: "${context}"` : ""}.
Provide a concise translation into English and grammatical details.

Return ONLY a JSON object with these exact keys:
{
  "word": "${cleanWord}",
  "translation": "<English translation of the word in this context>",
  "partOfSpeech": "<e.g. noun (masculine), verb (infinitive), adjective, adverb>",
  "phonetic": "<IPA phonetic transcription if available, e.g. /aˈmi.ɣo/>",
  "explanation": "<Brief definition or usage tip in under 20 words>"
}`;

    const models = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
    let result = null;
    let lastError = null;

    for (const m of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: m,
          generationConfig: { responseMimeType: "application/json" },
        });
        result = await model.generateContent(prompt);
        if (result && result.response) break;
      } catch (err) {
        console.warn(`[Vocab] Model ${m} error (${err.message}), trying next...`);
        lastError = err;
      }
    }

    if (!result) {
      console.error("[Vocab] AI generation error:", lastError);
      return res.status(502).json({ error: "Failed to lookup vocabulary with AI models" });
    }

    const textOutput = result.response.text();
    let data;
    try {
      data = JSON.parse(textOutput);
    } catch {
      return res.status(502).json({ error: "Malformed response from language service" });
    }

    res.json({
      word: data.word || cleanWord,
      translation: data.translation || "Translation unavailable",
      partOfSpeech: data.partOfSpeech || "word",
      phonetic: data.phonetic || "",
      explanation: data.explanation || "",
      context: context || "",
      language,
    });
  } catch (error) {
    console.error("[Vocab] Error in /api/vocabulary:", error);
    res.status(500).json({ error: "Failed to lookup vocabulary" });
  }
}
