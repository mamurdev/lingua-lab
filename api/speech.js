import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("[Startup Error] Missing required SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
}

const supabaseAdmin = (supabaseUrl && supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

async function enforceQuota(userId, kind, dayLimit = 30, minuteLimit = 6) {
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
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
}
