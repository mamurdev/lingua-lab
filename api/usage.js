import { createClient } from "@supabase/supabase-js";

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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!supabaseAdmin) {
    console.error("[Startup Error] Supabase admin client not initialized: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace("Bearer ", "") : null;

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const userId = user.id;
    const today = getUtcDateString();

    const { data, error } = await supabaseAdmin
      .from("usage_limits")
      .select("kind, day_count, minute_count, window_date")
      .eq("user_id", userId)
      .eq("window_date", today);

    if (error) {
      console.error("[Usage] Error fetching usage limits:", error);
    }

    let aiUsed = 0;
    let voiceUsed = 0;

    if (data && data.length > 0) {
      const aiRow = data.find((r) => r.kind === "ai");
      const voiceRow = data.find((r) => r.kind === "voice");
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
      dailyLimitResetUtc: "00:00 UTC",
    });
  } catch (error) {
    console.error("[Usage] Error in /api/usage:", error);
    res.status(500).json({ error: "Failed to retrieve usage data" });
  }
}
