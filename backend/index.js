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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("[Startup Error] Missing required SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
}

const supabaseAdmin = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

function getUtcDateString(d = new Date()) {
  return d.toISOString().split("T")[0];
}

async function enforceQuota(userId, kind, dayLimit = 60, minuteLimit = 6) {
  if (!userId) return { allowed: false, reason: "Authentication required" };
  if (!supabaseAdmin) throw new Error("Service temporarily unavailable");

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
    return { allowed: true, currentDayCount: row.current_day_count, currentMinuteCount: row.current_minute_count };
  }

  throw new Error("Service temporarily unavailable");
}

// Milestone 5.1: Quota inspection endpoint
app.get("/api/usage", async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let userId;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    userId = user.id;
  } catch {
    return res.status(401).json({ error: "Failed to verify session" });
  }

  let dbUsage = null;
  try {
    const today = getUtcDateString();
    const { data, error } = await supabaseAdmin
      .from("usage_limits")
      .select("kind, day_count, minute_count, window_date")
      .eq("user_id", userId)
      .eq("window_date", today);
    if (!error && data) {
      dbUsage = data;
    }
  } catch {
    // non-fatal
  }

  let aiUsed = 0;
  let voiceUsed = 0;

  if (dbUsage && dbUsage.length > 0) {
    const aiRow = dbUsage.find((r) => r.kind === "ai");
    const voiceRow = dbUsage.find((r) => r.kind === "voice");
    if (aiRow) aiUsed = aiRow.day_count;
    if (voiceRow) voiceUsed = voiceRow.day_count;
  }

  res.json({
    ai: {
      used: aiUsed,
      limit: 60,
      remaining: Math.max(0, 60 - aiUsed),
      description: "Tutor turns and review quizzes (shared pool)",
    },
    voice: {
      used: voiceUsed,
      limit: 30,
      remaining: Math.max(0, 30 - voiceUsed),
      description: "Voice speech audio replays",
    },
    rateLimitPerMinute: 6,
    resetsAt: "00:00 UTC",
    serverUtcTime: new Date().toISOString(),
  });
});

// ==========================================
// Milestone 5.2: Generation Leases & Session Turn Caps
// ==========================================

async function acquireLease(conversationId, userId, durationSeconds = 90) {
  if (!supabaseAdmin) {
    return { acquired: false, code: "RPC_ERROR", reason: "Service temporarily unavailable" };
  }
  const { data, error } = await supabaseAdmin.rpc("acquire_conversation_lease", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_lease_duration_seconds: durationSeconds,
  });

  if (error) {
    console.error("[Acquire Lease RPC error]:", error);
    return { acquired: false, code: "RPC_ERROR", reason: "Service temporarily unavailable" };
  }

  if (data && data.length > 0) {
    const res = data[0];
    if (res.acquired) {
      return { acquired: true, token: res.lease_token };
    }
    return {
      acquired: false,
      code: res.error_code,
      reason: res.error_message || "A response is already being generated for this conversation.",
    };
  }

  return { acquired: false, code: "UNKNOWN_ERROR", reason: "Service temporarily unavailable" };
}

async function releaseLease(conversationId, token) {
  if (!conversationId || !token || !supabaseAdmin) return;
  const { error } = await supabaseAdmin.rpc("release_conversation_lease", {
    p_conversation_id: conversationId,
    p_lease_token: token,
  });
  if (error) {
    console.error("[Release Lease RPC error]:", error);
  }
}

// Save chat turns: enforces unexpired lease token, checks turn cap, uses ONLY atomic RPC save_chat_turn_with_lease
async function saveChatTurn(conversationId, leaseToken, userContent, assistantContent) {
  if (!supabaseAdmin) {
    const err = new Error("Service temporarily unavailable");
    err.isSaveError = true;
    throw err;
  }

  let savedTurn;
  let saveError;
  try {
    const res = await supabaseAdmin.rpc("save_chat_turn_with_lease", {
      p_conversation_id: conversationId,
      p_lease_token: leaseToken,
      p_user_content: userContent,
      p_assistant_content: assistantContent,
    });
    savedTurn = res.data;
    saveError = res.error;
  } catch (err) {
    err.isSaveError = true;
    throw err;
  }

  if (saveError || !savedTurn || savedTurn.length === 0) {
    console.error("[Save Chat Turn RPC error]:", saveError);
    const err = new Error(saveError?.message || "Failed to save chat turn");
    err.isSaveError = true;
    throw err;
  }

  return {
    userMsgId: savedTurn[0].user_msg_id,
    assistantMsgId: savedTurn[0].assistant_msg_id,
  };
}

function isValidScenario(scenario) {
  if (scenario === undefined || scenario === null) return true;
  if (typeof scenario !== "object" || Array.isArray(scenario)) return false;

  if (typeof scenario.title !== "string" || scenario.title.trim().length === 0 || scenario.title.length > 100) {
    return false;
  }
  if (scenario.aiRole !== undefined && (typeof scenario.aiRole !== "string" || scenario.aiRole.length > 200)) {
    return false;
  }
  if (scenario.userRole !== undefined && (typeof scenario.userRole !== "string" || scenario.userRole.length > 200)) {
    return false;
  }
  if (scenario.setting !== undefined && (typeof scenario.setting !== "string" || scenario.setting.length > 200)) {
    return false;
  }
  if (scenario.objectives !== undefined) {
    if (!Array.isArray(scenario.objectives) || scenario.objectives.length > 6) {
      return false;
    }
    for (const obj of scenario.objectives) {
      if (!obj || typeof obj !== "object") return false;
      if (typeof obj.id !== "string" || obj.id.length > 40) return false;
      if (typeof obj.text !== "string" || obj.text.length > 200) return false;
    }
  }
  return true;
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

// Feature 3: Evaluate immersion scenario mission objectives
async function evaluateScenarioObjectives(genAIInstance, scenario, userMessage, assistantReply, language = "English") {
  if (!scenario || !Array.isArray(scenario.objectives)) return { completedIds: [] };

  const uncompleted = scenario.objectives.filter((o) => !o.completed);
  if (uncompleted.length === 0) {
    return { completedIds: [], allCompleted: true };
  }

  const prompt = `You are an immersion scenario evaluator for a language learning app.
Scenario: "${scenario.title}"
Setting: ${scenario.setting || "Real-world immersion"}
Target Language: ${language}

Uncompleted Objectives:
${uncompleted.map((o) => `[ID: "${o.id}"] Goal: ${o.text}`).join("\n")}

Latest Dialogue Turn:
Learner: "${(userMessage || '').replace(/"/g, '\\"')}"
AI Partner: "${(assistantReply || '').replace(/"/g, '\\"')}"

Check if the learner's message in this turn successfully achieved ANY of the uncompleted objectives in ${language}.
Be fair and encouraging: if the communicative intent clearly satisfies the objective goal in ${language}, count it as achieved!

Return strictly valid JSON:
{
  "completedIds": ["<id>"],
  "feedback": "<Optional short 1-sentence encouraging note if an objective was met, or null>"
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
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = JSON.parse(raw.replace(/\\'/g, "'"));
      }
      return {
        completedIds: Array.isArray(parsed.completedIds) ? parsed.completedIds : [],
        feedback: parsed.feedback || null,
      };
    } catch (err) {
      console.warn(`[Scenario Eval] Model ${m} warning:`, err.message);
    }
  }

  return { completedIds: [] };
}

// Milestone 2, 5.1 & 5.2: Chat generation with quota + lease concurrency checking
app.post("/api/chat", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!supabaseAdmin) {
    console.error("[Startup Error] Supabase admin client not initialized: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  let leaseAcquired = false;
  let activeLeaseToken = null;
  let activeConversationId = null;

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

    const {
      message,
      conversationId,
      scenario,
    } = req.body || {};

    // 1. Validate inputs (PRD lines 251, 324)
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Message exceeds maximum length of 2,000 characters" });
    }
    if (!conversationId || typeof conversationId !== "string") {
      return res.status(400).json({ error: "Missing or invalid conversationId" });
    }

    if (scenario && !isValidScenario(scenario)) {
      return res.status(400).json({ error: "Invalid scenario payload" });
    }

    // 2. Verify conversation ownership & retrieve conversation language / level
    const { data: conv, error: convError } = await supabaseAdmin
      .from("conversations")
      .select("id, user_id, language, level")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();

    if (convError || !conv) {
      return res.status(404).json({ error: "Conversation not found or access denied" });
    }

    const language = conv.language || "English";
    const level = conv.level || "Beginner";

    // 3. Atomically acquire per-conversation generation lease (90s)
    const lease = await acquireLease(conversationId, userId, 90);
    if (!lease.acquired) {
      if (lease.code === "NOT_FOUND") {
        return res.status(404).json({ error: lease.reason || "Conversation not found" });
      }
      if (lease.code === "SESSION_COMPLETED") {
        return res.status(400).json({ error: lease.reason || "Session limit reached (100 turns). Please start a new conversation." });
      }
      if (lease.code === "LEASE_BUSY") {
        return res.status(409).json({ error: lease.reason || "A response is already being generated for this conversation." });
      }
      return res.status(503).json({ error: "Service temporarily unavailable" });
    }

    leaseAcquired = true;
    activeLeaseToken = lease.token;
    activeConversationId = conversationId;

    // 4. Reserve quota & provider call inside try block so finally always releases lease
    try {
      const quota = await enforceQuota(userId, "ai", 60, 6);
      if (!quota.allowed) {
        return res.status(429).json({ error: quota.reason });
      }

      // Load last 20 messages from messages table ordered by sequence
      const { data: dbMessages, error: msgError } = await supabaseAdmin
        .from("messages")
        .select("role, content, sequence")
        .eq("conversation_id", conversationId)
        .order("sequence", { ascending: false })
        .limit(20);

      if (msgError) {
        console.error("[Messages fetch error]:", msgError);
        throw new Error("Service temporarily unavailable");
      }

      const historyMessages = (dbMessages || []).reverse();
      const history = historyMessages.map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));

      // Feature 3: Dynamic persona & immersion instructions
      let systemInstruction = `You are a helpful language tutor. The user is practicing ${language} at a ${level} level. Respond naturally in ${language}. Correct them gently if needed. Limit response to under 120 words.`;
      if (scenario && scenario.title) {
        const objectivesList = Array.isArray(scenario.objectives)
          ? scenario.objectives.map((o) => `- ${o.text}`).join("\n")
          : "";
        systemInstruction = `You are roleplaying as ${scenario.aiRole || "a conversational partner"} in an immersion scenario: "${scenario.title}".
Setting: ${scenario.setting || "Real-world conversational context"}.
The user is ${scenario.userRole || "a language learner"}.
Stay in character! Respond naturally, authentically, and warmly in ${language} calibrated for a ${level} level.
Keep replies conversational and concise (under 100 words) so the learner has ample turns to speak.
Respond in character to naturally allow the user to achieve their mission objectives:
${objectivesList}
Do not break character or list the objectives explicitly; roleplay authentically in ${language}.`;
      }

      const models = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
      const wantsStream = req.body.stream !== false;
      let lastModelError = null;
      let handled = false;

      for (const modelName of models) {
        try {
          const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction,
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

            // Save conversation turn atomically using ONLY save_chat_turn_with_lease
            const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, activeLeaseToken, message, fullReply);

            // Parallel analysis: Grammar check + Feature 3 Scenario Objective Evaluation
            const [grammarFeedback, scenarioEvaluation] = await Promise.all([
              analyzeGrammar(genAI, message, language, level).catch((gErr) => {
                console.warn("[Grammar] Non-fatal analysis warning:", gErr.message);
                return null;
              }),
              scenario
                ? evaluateScenarioObjectives(genAI, scenario, message, fullReply, language).catch((sErr) => {
                    console.warn("[Scenario Eval] Non-fatal warning:", sErr.message);
                    return null;
                  })
                : Promise.resolve(null),
            ]);

            res.write(`data: ${JSON.stringify({ done: true, reply: fullReply, assistantMsgId, userMsgId, grammarFeedback, scenarioEvaluation })}\n\n`);
            res.end();
            handled = true;
            break;
          } else {
            const result = await chat.sendMessage(message);
            const reply = result.response.text();

            // Save conversation turn atomically using ONLY save_chat_turn_with_lease
            const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, activeLeaseToken, message, reply);

            // Parallel analysis: Grammar check + Feature 3 Scenario Objective Evaluation
            const [grammarFeedback, scenarioEvaluation] = await Promise.all([
              analyzeGrammar(genAI, message, language, level).catch((gErr) => {
                console.warn("[Grammar] Non-fatal analysis warning:", gErr.message);
                return null;
              }),
              scenario
                ? evaluateScenarioObjectives(genAI, scenario, message, reply, language).catch((sErr) => {
                    console.warn("[Scenario Eval] Non-fatal warning:", sErr.message);
                    return null;
                  })
                : Promise.resolve(null),
            ]);

            res.json({ reply, assistantMsgId, userMsgId, grammarFeedback, scenarioEvaluation });
            handled = true;
            break;
          }
        } catch (mErr) {
          if (mErr.isSaveError) {
            throw mErr;
          }
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
      // Milestone 5.2: Release the matching lease token in cleanup
      if (leaseAcquired && activeConversationId && activeLeaseToken) {
        await releaseLease(activeConversationId, activeLeaseToken);
        leaseAcquired = false;
      }
    }
  } catch (error) {
    console.error("Chat error:", error);
    const genericMessage = error?.message === "Service temporarily unavailable"
      ? "Service temporarily unavailable"
      : "Something went wrong. Please try again.";
    const status = error?.message === "Service temporarily unavailable" ? 503 : 500;

    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: genericMessage })}\n\n`);
      res.end();
    } else {
      res.status(status).json({ error: genericMessage });
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
  res.setHeader("Cache-Control", "no-store");

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
    const { messageId, text } = req.body || {};
    let textToSpeech = (text || "").trim();

    if (!messageId && !textToSpeech) {
      return res.status(400).json({ error: "Missing message text for speech synthesis" });
    }

    // 3. Ownership check & assistant role validation
    if (messageId) {
      const { data: messageData, error: msgError } = await supabaseAdmin
        .from("messages")
        .select("content, role, conversation_id")
        .eq("id", messageId)
        .single();

      if (msgError || !messageData || messageData.role !== "assistant") {
        return res.status(404).json({ error: "Assistant message not found or access denied" });
      }

      const { data: conv, error: convError } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("id", messageData.conversation_id)
        .eq("user_id", userId)
        .single();

      if (convError || !conv) {
        return res.status(404).json({ error: "Assistant message not found or access denied" });
      }

      textToSpeech = (messageData.content || "").trim();
    }

    if (!textToSpeech) {
      return res.status(400).json({ error: "Missing message text for speech synthesis" });
    }

    // 4. Quota
    const quota = await enforceQuota(userId, "voice", 30, 6);
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
    }

    // 5. Provider call
    if (!process.env.ELEVENLABS_API_KEY) {
      console.error("[TTS] Missing ELEVENLABS_API_KEY");
      return res.status(503).json({ error: "Service temporarily unavailable" });
    }

    const rawVoiceId = process.env.ELEVENLABS_VOICE_ID || "";
    const preferredVoiceId = rawVoiceId.split("#")[0].trim() || "JBFqnCBsd6RMkjVDRZzb";

    const result = await synthesizeSpeech(textToSpeech, preferredVoiceId, process.env.ELEVENLABS_API_KEY);

    if (!result.ok) {
      console.error(`[TTS] ElevenLabs API error (${result.error?.status}):`, result.error?.text);
      return res.status(502).json({ error: "Speech synthesis failed. Please try again." });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(result.buffer));
  } catch (error) {
    console.error("[TTS] Speech Generation Error:", error);
    const status = error?.message === "Service temporarily unavailable" ? 503 : 500;
    const genericMessage = error?.message === "Service temporarily unavailable"
      ? "Service temporarily unavailable"
      : "Failed to process speech request";
    res.status(status).json({ error: genericMessage });
  }
});

// Milestone 4 & 5.1: Review Quizzes (with shared AI quota limit)
app.post("/api/exercises", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

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

    // Milestone 5.2: Prevent concurrent quiz generation for the same conversation
    const lockKey = `quiz:${conversationId}`;
    if (!acquireLock(userId, lockKey)) {
      return res.status(409).json({ error: "A quiz is already being generated for this conversation. Please wait." });
    }

    try {
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
        console.error("[Quiz] Gemini generation failed:", lastError);
        return res.status(502).json({ error: "Failed to generate quiz. Please try again." });
      }

      const textOutput = result.response.text();
      let parsedQuiz;

      try {
        parsedQuiz = JSON.parse(textOutput);
      } catch {
        console.error("[Quiz] JSON parse error:", textOutput);
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
        console.error("[Quiz] Supabase insert error:", saveError);
        return res.status(500).json({ error: "Failed to persist exercise to database" });
      }

      console.log(`[Quiz] Successfully created and saved exercise ${savedExercise.id}`);
      res.json({ exercise: savedExercise });
    } finally {
      releaseLock(userId, lockKey);
    }
  } catch (error) {
    console.error("[Quiz] Error in /api/exercises:", error);
    const status = error?.message === "Service temporarily unavailable" ? 503 : 500;
    const genericMessage = error?.message === "Service temporarily unavailable"
      ? "Service temporarily unavailable"
      : "Failed to generate exercises";
    res.status(status).json({ error: genericMessage });
  }
});

// Feature 2: 1-Click Vocabulary Lookup
app.post("/api/vocabulary/lookup", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!supabaseAdmin) {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

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

    // Quota check
    let quota;
    try {
      quota = await enforceQuota(user.id, "ai", 60, 6);
    } catch {
      return res.status(503).json({ error: "Service temporarily unavailable" });
    }
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
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
    console.error("[Vocab] Error in /api/vocabulary/lookup:", error);
    res.status(500).json({ error: "Failed to lookup vocabulary" });
  }
});

// Feature 1: Standalone Grammar Analysis endpoint
app.post("/api/grammar/analyze", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!supabaseAdmin) {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const { message, language = "English", level = "Beginner" } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Missing message text for grammar analysis" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Message exceeds maximum length of 2,000 characters" });
    }

    // Quota check
    let quota;
    try {
      quota = await enforceQuota(user.id, "ai", 60, 6);
    } catch {
      return res.status(503).json({ error: "Service temporarily unavailable" });
    }
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
    }

    const feedback = await analyzeGrammar(genAI, message.trim(), language, level);
    res.json({ feedback });
  } catch (error) {
    console.error("[Grammar] Error in /api/grammar/analyze:", error);
    res.status(500).json({ error: "Failed to analyze grammar" });
  }
});

// Feature 3: Standalone Scenario Objective Evaluation endpoint
app.post("/api/scenario/evaluate", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!supabaseAdmin) {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const { scenario, userMessage, assistantReply, language = "English" } = req.body || {};
    if (!scenario || !userMessage) {
      return res.status(400).json({ error: "Missing scenario or userMessage for evaluation" });
    }
    if (!isValidScenario(scenario)) {
      return res.status(400).json({ error: "Invalid scenario payload" });
    }
    if (typeof userMessage !== "string" || userMessage.length > 2000) {
      return res.status(400).json({ error: "Invalid user message" });
    }

    // Quota check
    let quota;
    try {
      quota = await enforceQuota(user.id, "ai", 60, 6);
    } catch {
      return res.status(503).json({ error: "Service temporarily unavailable" });
    }
    if (!quota.allowed) {
      return res.status(429).json({ error: quota.reason });
    }

    const evaluation = await evaluateScenarioObjectives(genAI, scenario, userMessage, assistantReply || "", language);
    res.json({ evaluation });
  } catch (error) {
    console.error("[Scenario] Error in /api/scenario/evaluate:", error);
    res.status(500).json({ error: "Failed to evaluate scenario" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Secure Lingua Lab server running on http://localhost:${PORT}`);
});
