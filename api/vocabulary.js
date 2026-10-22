import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
    console.error("[Vocab] Error in /api/vocabulary:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to lookup vocabulary" });
  }
}
