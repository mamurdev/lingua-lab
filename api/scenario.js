import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { scenario, userMessage, assistantReply, language = "English" } = req.body;
    if (!scenario || !userMessage) {
      return res.status(400).json({ error: "Missing scenario or userMessage for evaluation" });
    }

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
    res.status(500).json({ error: error.message || "Failed to evaluate scenario" });
  }
}
