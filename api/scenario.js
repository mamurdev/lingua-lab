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

function isValidScenario(scenario) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) return false;
  if (typeof scenario.title !== "string" || scenario.title.trim().length === 0 || scenario.title.length > 100) return false;
  if (scenario.aiRole !== undefined && (typeof scenario.aiRole !== "string" || scenario.aiRole.length > 200)) return false;
  if (scenario.userRole !== undefined && (typeof scenario.userRole !== "string" || scenario.userRole.length > 200)) return false;
  if (scenario.setting !== undefined && (typeof scenario.setting !== "string" || scenario.setting.length > 200)) return false;
  if (scenario.objectives !== undefined) {
    if (!Array.isArray(scenario.objectives) || scenario.objectives.length > 6) return false;
    for (const obj of scenario.objectives) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
      if (typeof obj.id !== "string" || obj.id.length > 40) return false;
      if (typeof obj.text !== "string" || obj.text.length > 200) return false;
    }
  }
  return true;
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
    const uncompleted = (scenario.objectives || []).filter((o) => !o.completed);
    if (uncompleted.length === 0) {
      return res.json({ evaluation: { completedIds: [], allCompleted: true } });
    }

    const prompt = `You are an immersion scenario evaluator for a language learning app.
Scenario: "${scenario.title}"
Setting: ${scenario.setting || "Real-world immersion"}
Target Language: ${language}

Uncompleted Objectives:
${uncompleted.map((o) => `[ID: "${o.id}"] Goal: ${o.text}`).join("\n")}

Latest Dialogue Turn:
Learner: "${userMessage.replace(/"/g, '\\"')}"
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
        const model = genAI.getGenerativeModel({
          model: m,
          generationConfig: { responseMimeType: "application/json" },
        });
        const aiRes = await model.generateContent(prompt);
        const raw = aiRes.response.text();
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = JSON.parse(raw.replace(/\\'/g, "'"));
        }
        return res.json({
          evaluation: {
            completedIds: Array.isArray(parsed.completedIds) ? parsed.completedIds : [],
            feedback: parsed.feedback || null,
          },
        });
      } catch (err) {
        console.warn(`[Scenario Vercel] Model ${m} warning:`, err.message);
      }
    }

    res.json({ evaluation: { completedIds: [] } });
  } catch (error) {
    console.error("[Scenario Vercel] Error:", error);
    res.status(500).json({ error: "Failed to evaluate scenario" });
  }
}
