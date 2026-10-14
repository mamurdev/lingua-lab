import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

async function enforceQuota(userId, kind, dayLimit = 30, minuteLimit = 6) {
  if (!userId) return { allowed: true };
  try {
    const { data, error } = await supabaseAdmin.rpc("check_and_consume_quota", {
      p_user_id: userId,
      p_kind: kind,
      p_day_limit: dayLimit,
      p_minute_limit: minuteLimit,
    });
    if (error) return { allowed: true };
    const row = data && data[0];
    if (row && !row.allowed) return { allowed: false, reason: row.reason };
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

async function synthesizeSpeech(text, preferredVoiceId, apiKey) {
  const tryVoices = [
    preferredVoiceId,
    "JBFqnCBsd6RMkjVDRZzb",
    "EXAVITQu4vr4xnSDxMaL",
    "pNInz6obpgDQGcFmaJgB",
  ].filter(Boolean);

  const uniqueVoices = [...new Set(tryVoices)];
  let lastError = null;

  for (const voiceId of uniqueVoices) {
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
      return { ok: true, buffer, voiceId };
    }

    const errText = await response.text();
    lastError = { status: response.status, text: errText };
    const isPlanRestriction =
      response.status === 402 ||
      errText.includes("library voices") ||
      errText.includes("paid_plan_required");

    if (!isPlanRestriction) break;
  }

  return { ok: false, error: lastError };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
      return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured" });
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
}

