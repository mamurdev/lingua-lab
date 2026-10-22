import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

const inMemoryQuotaStore = new Map();

function getUtcDateString(d = new Date()) {
  return d.toISOString().split("T")[0];
}

function enforceInMemoryQuota(userId, kind, dayLimit = 30, minuteLimit = 6) {
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

async function enforceQuota(userId, kind, dayLimit = 30, minuteLimit = 6) {
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

