import "cross-fetch/dist/node-polyfill.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors({ origin: ["http://localhost:5173", "http://localhost:3000"] }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "lingua-lab-api", timestamp: new Date().toISOString() });
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

// Milestone 5.1: Quota and Rate Limiting Helper
async function enforceQuota(userId, kind, dayLimit = 60, minuteLimit = 6) {
  if (!userId) return { allowed: true };
  try {
    const { data, error } = await supabaseAdmin.rpc("check_and_consume_quota", {
      p_user_id: userId,
      p_kind: kind,
      p_day_limit: dayLimit,
      p_minute_limit: minuteLimit,
    });

    if (error) {
      console.warn(`[Quota] Quota RPC check skipped (${error.message})`);
      return { allowed: true };
    }

    const row = data && data[0];
    if (row && !row.allowed) {
      return { allowed: false, reason: row.reason };
    }

    return { allowed: true };
  } catch (err) {
    console.warn("[Quota] Quota check exception:", err);
    return { allowed: true };
  }
}

// Milestone 5.2: In-process concurrency lock per user
// Prevents the same user from firing multiple AI requests simultaneously
// (e.g. double-clicking Send or having the app open in two tabs).
const activeRequests = new Map(); // userId -> Set of active operation keys

function acquireLock(userId, key) {
  if (!userId) return true; // unauthenticated requests are not locked
  if (!activeRequests.has(userId)) {
    activeRequests.set(userId, new Set());
  }
  const locks = activeRequests.get(userId);
  if (locks.has(key)) {
    return false; // Already in-flight
  }
  locks.add(key);
  return true;
}

function releaseLock(userId, key) {
  if (!userId) return;
  const locks = activeRequests.get(userId);
  if (locks) {
    locks.delete(key);
    if (locks.size === 0) activeRequests.delete(userId);
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

// Feature 1: Grammar and Syntax Mistake Analyzer
async function analyzeGrammar(genAIInstance, text, language = "English", level = "Beginner") {
  if (!text || text.trim().length < 2) {
    return { hasMistake: false };
  }

  const prompt = `You are an expert language grammar analyzer and pedagogue.
The user is practicing ${language} at a ${level} level.
User message: "${text.replace(/"/g, '\\"')}".

Analyze if this message contains any grammatical mistakes, incorrect verb conjugations, wrong gender/number agreements, unnatural phrasing, or spelling mistakes in ${language}.
Ignore minor punctuation casing differences.

If there ARE mistakes:
Return strictly valid standard JSON (do not escape single quotes):
{
  "hasMistake": true,
  "corrected": "<The fully corrected, natural sentence in ${language}>",
  "explanation": "<Concise explanation of the mistakes and how to fix them, in English, under 45 words>",
  "diff": [
    {
      "original": "<the exact mistaken word or phrase>",
      "corrected": "<the corrected word or phrase>",
      "rule": "<short rule explanation, e.g. Preterite 1st person singular of 'ir'>"
    }
  ]
}

If the sentence is grammatically correct and natural:
Return strictly valid standard JSON:
{
  "hasMistake": false
}`;

  const models = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
  for (const m of models) {
    try {
      const model = genAIInstance.getGenerativeModel({
        model: m,
        generationConfig: { responseMimeType: "application/json" },
      });
      const res = await model.generateContent(prompt);
      const raw = res.response.text();
      try {
        return JSON.parse(raw);
      } catch {
        return JSON.parse(raw.replace(/\\'/g, "'"));
      }
    } catch (err) {
      console.warn(`[Grammar] Model ${m} analysis warning:`, err.message);
    }
  }

  return { hasMistake: false };
}

// Milestone 2, 5.1 & 5.2: Chat generation with quota + concurrency checking
app.post("/api/chat", async (req, res) => {
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

    // Enforce 5.1 spending controls (60 AI requests/day, 6/min)
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

    // Verify conversation ownership before acquiring lock
    const { data: conv, error: convError } = await supabaseAdmin
      .from("conversations")
      .select("id, user_id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();

    if (convError || !conv) {
      return res.status(404).json({ error: "Conversation not found or access denied" });
    }

    // Milestone 5.2: Prevent concurrent AI requests for the same conversation
    const lockKey = `chat:${conversationId}`;
    if (!acquireLock(userId, lockKey)) {
      return res.status(409).json({ error: "A response is already being generated for this conversation. Please wait." });
    }

    try {
      const models = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
      const history = conversationHistory.map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));

      const wantsStream = req.body.stream !== false;
      let lastModelError = null;
      let handled = false;

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

            // Feature 1: Analyze user message grammar
            let grammarFeedback = null;
            try {
              grammarFeedback = await analyzeGrammar(genAI, message, language, level);
            } catch (gErr) {
              console.warn("[Grammar] Non-fatal analysis warning:", gErr.message);
            }

            res.write(`data: ${JSON.stringify({ done: true, reply: fullReply, assistantMsgId, userMsgId, grammarFeedback })}\n\n`);
            res.end();
            handled = true;
            break;
          } else {
            const result = await chat.sendMessage(message);
            const reply = result.response.text();

            // Save conversation turn using robust helper
            const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, message, reply);

            // Feature 1: Analyze user message grammar
            let grammarFeedback = null;
            try {
              grammarFeedback = await analyzeGrammar(genAI, message, language, level);
            } catch (gErr) {
              console.warn("[Grammar] Non-fatal analysis warning:", gErr.message);
            }

            res.json({ reply, assistantMsgId, userMsgId, grammarFeedback });
            handled = true;
            break;
          }
        } catch (mErr) {
          console.warn(`[Chat] Model ${modelName} failed (${mErr.message}), trying next model...`);
          lastModelError = mErr;
          // If headers were already sent with chunk data, we cannot retry another stream
          if (res.headersSent) {
            break;
          }
        }
      }

      if (!handled && lastModelError) {
        throw lastModelError;
      }
    } finally {
      releaseLock(userId, lockKey);
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
});


// Helper for ElevenLabs synthesis with automatic free premade voice fallback
async function synthesizeSpeech(text, preferredVoiceId, apiKey) {
  const tryVoices = [
    preferredVoiceId,
    "JBFqnCBsd6RMkjVDRZzb", // George (standard premade)
    "EXAVITQu4vr4xnSDxMaL", // Sarah (standard premade)
    "pNInz6obpgDQGcFmaJgB", // Adam (standard premade)
  ].filter(Boolean);

  const uniqueVoices = [...new Set(tryVoices)];
  let lastError = null;

  for (const voiceId of uniqueVoices) {
    console.log(`[TTS] Requesting ElevenLabs audio with voice: ${voiceId}`);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey.trim(),
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (response.ok) {
      const buffer = await response.arrayBuffer();
      console.log(`[TTS] Successfully generated audio using voice: ${voiceId} (${buffer.byteLength} bytes)`);
      return { ok: true, buffer, voiceId };
    }

    const errText = await response.text();
    console.warn(`[TTS] Voice ${voiceId} failed (${response.status}):`, errText);
    lastError = { status: response.status, text: errText };

    const isPlanRestriction =
      response.status === 402 ||
      errText.includes("library voices") ||
      errText.includes("paid_plan_required");

    if (!isPlanRestriction) {
      break;
    }
  }

  return { ok: false, error: lastError };
}

// Milestone 3 & 5.1: Voice Playback (with 30 voice requests/day limit)
app.post("/api/speech", async (req, res) => {
  try {
    const { messageId, text } = req.body;
    let textToSpeech = (text || "").trim();

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

    // Enforce 5.1 spending controls (30 voice requests/day, 6/min)
    const quota = await enforceQuota(userId, "voice", 30, 6);
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
    }

    if (messageId) {
      const client = token
        ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
        : supabaseAdmin;

      const { data: messageData, error: msgError } = await client
        .from("messages")
        .select("content, role")
        .eq("id", messageId)
        .single();

      if (msgError || !messageData || messageData.role !== "assistant") {
        return res.status(404).json({ error: "Assistant message not found or access denied" });
      }

      textToSpeech = (messageData.content || "").trim();
    }

    if (!textToSpeech) {
      return res.status(400).json({ error: "Missing message text for speech synthesis" });
    }

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured in backend/.env" });
    }

    const rawVoiceId = process.env.ELEVENLABS_VOICE_ID || "";
    const preferredVoiceId = rawVoiceId.split("#")[0].trim() || "JBFqnCBsd6RMkjVDRZzb";

    const result = await synthesizeSpeech(textToSpeech, preferredVoiceId, process.env.ELEVENLABS_API_KEY);

    if (!result.ok) {
      return res.status(502).json({
        error: `ElevenLabs API error (${result.error.status}): ${result.error.text}`,
      });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache");
    res.send(Buffer.from(result.buffer));
  } catch (error) {
    console.error("[TTS] Speech Generation Error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to process speech request" });
  }
});

// Milestone 4 & 5.1: Review Quizzes (with shared AI quota limit)
app.post("/api/exercises", async (req, res) => {
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

    // Enforce 5.1 spending controls (shared with AI bucket: 60/day, 6/min)
    const quota = await enforceQuota(userId, "ai", 60, 6);
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
    }

    // Milestone 5.2: Prevent concurrent quiz generation for the same conversation
    const lockKey = `quiz:${conversationId}`;
    if (!acquireLock(userId, lockKey)) {
      return res.status(409).json({ error: "A quiz is already being generated for this conversation. Please wait." });
    }

    try {
      // (lock released in finally below)

      const client = token
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
      : supabaseAdmin;

    // 1. Fetch conversation details to verify ownership and context
    const { data: conv, error: convError } = await client
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (convError || !conv) {
      return res.status(404).json({ error: "Conversation not found or access denied" });
    }

    // 2. Fetch conversation history
    const { data: messages, error: msgError } = await client
      .from("messages")
      .select("role, content, sequence")
      .eq("conversation_id", conversationId)
      .order("sequence", { ascending: true });

    if (msgError || !messages) {
      return res.status(500).json({ error: "Failed to load conversation history" });
    }

    // Requirement: At least 2 completed turns (4 messages) before generating quiz
    if (messages.length < 4) {
      return res.status(400).json({
        error: "At least 2 complete conversational turns (4 messages) are required to generate a review quiz.",
      });
    }

    console.log(`[Quiz] Generating 3-question review quiz for conversation ${conversationId} (${conv.language} - ${conv.level})`);

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
        console.warn(`[Quiz] Model ${m} error (${err.message}), trying next...`);
        lastError = err;
      }
    }

    if (!result) {
      throw lastError || new Error("Failed to generate quiz with all AI models");
    }

    const textOutput = result.response.text();
    let parsedQuiz;

    try {
      parsedQuiz = JSON.parse(textOutput);
    } catch {
      console.error("[Quiz] JSON parse error:", textOutput);
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
      console.error("[Quiz] Supabase insert error:", saveResult.error);
      return res.status(500).json({ error: "Failed to persist exercise to database" });
    }

      console.log(`[Quiz] Successfully created and saved exercise ${saveResult.data.id}`);
      res.json({ exercise: saveResult.data });
    } finally {
      releaseLock(userId, lockKey);
    }
  } catch (error) {
    console.error("[Quiz] Error in /api/exercises:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to generate exercises" });
  }
});

// Feature 2: 1-Click Vocabulary Lookup
app.post("/api/vocabulary/lookup", async (req, res) => {
  try {
    const { word, context, language = "English" } = req.body;
    if (!word || typeof word !== "string" || !word.trim()) {
      return res.status(400).json({ error: "Missing word for vocabulary lookup" });
    }

    const cleanWord = word.trim().replace(/[.,!?;:"'()[\]{}«»¡¿]/g, "");
    if (!cleanWord) {
      return res.status(400).json({ error: "Invalid word" });
    }

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
      throw lastError || new Error("Failed to lookup vocabulary with AI models");
    }

    const textOutput = result.response.text();
    let data;
    try {
      data = JSON.parse(textOutput);
    } catch {
      return res.status(502).json({ error: "Malformed JSON response from AI" });
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
    console.error("[Vocab] Error in /api/vocabulary/lookup:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to lookup vocabulary" });
  }
});

// Feature 1: Standalone Grammar Analysis endpoint
app.post("/api/grammar/analyze", async (req, res) => {
  try {
    const { message, language = "English", level = "Beginner" } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Missing message text for grammar analysis" });
    }

    const feedback = await analyzeGrammar(genAI, message.trim(), language, level);
    res.json({ feedback });
  } catch (error) {
    console.error("[Grammar] Error in /api/grammar/analyze:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to analyze grammar" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Secure Lingua Lab server running on http://localhost:${PORT}`);
});
