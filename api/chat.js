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
      console.warn(`[Scenario Eval Vercel] Model ${m} warning:`, err.message);
    }
  }

  return { completedIds: [] };
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
      scenario,
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

          // Save conversation turn using robust helper
          const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, message, fullReply);

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

          // Save conversation turn using robust helper
          const { userMsgId, assistantMsgId } = await saveChatTurn(conversationId, message, reply);

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
