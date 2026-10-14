-- supabase/migrations/0002_usage_limits.sql

-- Table for tracking daily and per-minute usage limits (PRD Milestone 5.1)
CREATE TABLE IF NOT EXISTS public.usage_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('ai', 'voice')),
    window_date DATE NOT NULL,
    day_count INTEGER NOT NULL DEFAULT 0,
    window_minute TIMESTAMP WITH TIME ZONE NOT NULL,
    minute_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, kind, window_date)
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_usage_limits_user ON public.usage_limits(user_id, kind);

-- Enable RLS (managed exclusively by server)
ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;

-- Deny client writes or modifications
CREATE POLICY "Users can only read own usage limits"
    ON public.usage_limits FOR SELECT
    USING (auth.uid() = user_id);

-- Atomic RPC function to check and increment quota in one transaction
CREATE OR REPLACE FUNCTION public.check_and_consume_quota(
    p_user_id UUID,
    p_kind TEXT,
    p_day_limit INTEGER DEFAULT 60,
    p_minute_limit INTEGER DEFAULT 6
)
RETURNS TABLE (
    allowed BOOLEAN,
    current_day_count INTEGER,
    current_minute_count INTEGER,
    reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (now() AT TIME ZONE 'UTC')::DATE;
    v_current_minute TIMESTAMP WITH TIME ZONE := date_trunc('minute', now() AT TIME ZONE 'UTC');
    v_row public.usage_limits%ROWTYPE;
BEGIN
    -- Lock or insert row for this user, kind, and UTC day
    INSERT INTO public.usage_limits (user_id, kind, window_date, day_count, window_minute, minute_count)
    VALUES (p_user_id, p_kind, v_today, 0, v_current_minute, 0)
    ON CONFLICT (user_id, kind, window_date) DO NOTHING;

    SELECT * INTO v_row
    FROM public.usage_limits
    WHERE user_id = p_user_id AND kind = p_kind AND window_date = v_today
    FOR UPDATE;

    -- Check if minute window has rolled over
    IF v_row.window_minute < v_current_minute THEN
        v_row.window_minute := v_current_minute;
        v_row.minute_count := 0;
    END IF;

    -- Check daily quota limit
    IF v_row.day_count >= p_day_limit THEN
        RETURN QUERY SELECT FALSE, v_row.day_count, v_row.minute_count, 'Daily limit reached (' || p_day_limit || ' requests/day). Resets at 00:00 UTC.'::TEXT;
        RETURN;
    END IF;

    -- Check minute rate limit
    IF v_row.minute_count >= p_minute_limit THEN
        RETURN QUERY SELECT FALSE, v_row.day_count, v_row.minute_count, 'Rate limit exceeded (' || p_minute_limit || ' requests/min). Please wait a few moments.'::TEXT;
        RETURN;
    END IF;

    -- Increment counters
    v_row.day_count := v_row.day_count + 1;
    v_row.minute_count := v_row.minute_count + 1;
    v_row.updated_at := timezone('utc'::text, now());

    UPDATE public.usage_limits
    SET day_count = v_row.day_count,
        window_minute = v_row.window_minute,
        minute_count = v_row.minute_count,
        updated_at = v_row.updated_at
    WHERE id = v_row.id;

    RETURN QUERY SELECT TRUE, v_row.day_count, v_row.minute_count, 'Allowed'::TEXT;
END;
$$;

