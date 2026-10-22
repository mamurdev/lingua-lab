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

async function acquireLease(conversationId, userId, durationSeconds = 90) {
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
  if (!conversationId || !token) return;
  const { error } = await supabaseAdmin.rpc("release_conversation_lease", {
    p_conversation_id: conversationId,
    p_lease_token: token,
  });
  if (error) {
    console.error("[Release Lease RPC error]:", error);
  }
}

async function saveChatTurn(conversationId, leaseToken, userContent, assistantContent) {
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

async function analyzeGrammar(genAIInstance, text, language = "English", level = "Beginner") {
  if (!text || text.trim().length < 2) return { hasMistake: false };

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
      console.warn(`[Grammar] Model ${m} warning:`, err.message);
    }
  }

  return { hasMistake: false };
}

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
      console.warn(`[Scenario Eval Vercel] Model ${m} warning:`, err.message);
    }
  }

  return { completedIds: [] };
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

  let leaseAcquired = false;
  let activeLeaseToken = null;
  let activeConversationId = null;

  try {
    // 1. Authenticate
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

    // 2. Validate input
    const {
      message,
      conversationId,
      scenario,
    } = req.body || {};

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

    // 3. Verify conversation ownership & select language / level from DB
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

    // 4. Acquire lease (atomic RPC)
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

    // 5. Reserve quota & provider call inside try block so finally always releases lease
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
      let handled = false;
      let lastModelError = null;

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

            // 7. Save conversation turn using ONLY save_chat_turn_with_lease
            const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, activeLeaseToken, message, fullReply);

            // Parallel analysis: Grammar check + Feature 3 Scenario Objective Evaluation
            const [grammarFeedback, scenarioEvaluation] = await Promise.all([
              analyzeGrammar(genAI, message, language, level).catch((gErr) => {
                console.warn("[Grammar Vercel] Warning:", gErr.message);
                return null;
              }),
              scenario
                ? evaluateScenarioObjectives(genAI, scenario, message, fullReply, language).catch((sErr) => {
                    console.warn("[Scenario Eval Vercel] Warning:", sErr.message);
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

            // 7. Save conversation turn using ONLY save_chat_turn_with_lease
            const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, activeLeaseToken, message, reply);

            // Parallel analysis: Grammar check + Feature 3 Scenario Objective Evaluation
            const [grammarFeedback, scenarioEvaluation] = await Promise.all([
              analyzeGrammar(genAI, message, language, level).catch((gErr) => {
                console.warn("[Grammar Vercel] Warning:", gErr.message);
                return null;
              }),
              scenario
                ? evaluateScenarioObjectives(genAI, scenario, message, reply, language).catch((sErr) => {
                    console.warn("[Scenario Eval Vercel] Warning:", sErr.message);
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
          console.warn(`[Chat Vercel] Model ${modelName} failed (${mErr.message}), trying next...`);
          lastModelError = mErr;
          if (res.headersSent) break;
        }
      }

      if (!handled && lastModelError) {
        throw lastModelError;
      }
    } finally {
      // 8. Release lease in finally
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
}
