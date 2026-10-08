import "cross-fetch/dist/node-polyfill.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

// Milestone 2: Chat generation
app.post("/api/chat", async (req, res) => {
  try {
    const {
      message,
      language = "English",
      level = "Beginner",
      conversationHistory = [],
    } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      systemInstruction: `You are a helpful language tutor. The user is practicing ${language} at a ${level} level. Respond naturally in ${language}. Correct them gently if needed. Limit response to under 120 words.`,
    });

    const history = conversationHistory.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);

    res.json({ reply: result.response.text() });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to process chat with Gemini" });
  }
});

// Helper for ElevenLabs synthesis with automatic free premade voice fallback
async function synthesizeSpeech(text, preferredVoiceId, apiKey) {
  // ElevenLabs free tier blocks library voices. Fall back to standard premade system voices if needed.
  const tryVoices = [
    preferredVoiceId,
    "JBFqnCBsd6RMkjVDRZzb", // George (standard premade)
    "EXAVITQu4vr4xnSDxMaL", // Sarah (standard premade)
    "pNInz6obpgDQGcFmaJgB", // Adam (standard premade)
  ].filter(Boolean);

  // Remove duplicates
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

    // Only retry other voices if this was a library voice / payment restriction
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

// Milestone 3: Voice Playback (ElevenLabs)
app.post("/api/speech", async (req, res) => {
  try {
    const { messageId, text } = req.body;
    let textToSpeech = (text || "").trim();

    // If messageId provided, fetch message content from Supabase
    if (messageId && !textToSpeech) {
      const authHeader = req.headers.authorization;
      const token = authHeader ? authHeader.replace("Bearer ", "") : null;

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

      if (!msgError && messageData) {
        textToSpeech = (messageData.content || "").trim();
      }
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Secure Lingua Lab server running on http://localhost:${PORT}`);
});
