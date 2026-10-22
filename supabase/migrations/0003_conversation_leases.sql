-- supabase/migrations/0003_conversation_leases.sql
-- Milestone 5.2: Per-conversation generation lease and session turn limits

-- Table for tracking active per-conversation generation leases
CREATE TABLE IF NOT EXISTS public.conversation_leases (
    conversation_id UUID PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    lease_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index on expiry for fast queries
CREATE INDEX IF NOT EXISTS idx_conversation_leases_expires ON public.conversation_leases(expires_at);

-- Enable Row Level Security (server-managed only)
ALTER TABLE public.conversation_leases ENABLE ROW LEVEL SECURITY;

-- Deny all client operations via RLS (no client SELECT/INSERT/UPDATE/DELETE policies)
-- Only service_role can access conversation_leases directly

-- Atomic RPC function to acquire a generation lease for a conversation
CREATE OR REPLACE FUNCTION public.acquire_conversation_lease(
    p_conversation_id UUID,
    p_user_id UUID,
    p_lease_duration_seconds INTEGER DEFAULT 90
)
RETURNS TABLE (
    acquired BOOLEAN,
    lease_token TEXT,
    error_code TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now TIMESTAMP WITH TIME ZONE := timezone('utc'::text, now());
    v_conv_owner UUID;
    v_turn_count INTEGER;
    v_existing_lease public.conversation_leases%ROWTYPE;
    v_new_token TEXT;
    v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
    -- 1. Check conversation exists and ownership
    SELECT user_id INTO v_conv_owner
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF v_conv_owner IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'NOT_FOUND'::TEXT, 'Conversation not found'::TEXT;
        RETURN;
    END IF;

    IF v_conv_owner != p_user_id THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'FORBIDDEN'::TEXT, 'Access denied'::TEXT;
        RETURN;
    END IF;

    -- 2. Check 100 complete turns session cap (Milestone 5.2 requirement)
    SELECT COUNT(*) INTO v_turn_count
    FROM public.messages
    WHERE conversation_id = p_conversation_id AND role = 'assistant';

    IF v_turn_count >= 100 THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'SESSION_COMPLETED'::TEXT, 'Session limit reached (100 turns). Please start a new conversation to continue practicing.'::TEXT;
        RETURN;
    END IF;

    -- 3. Check existing active lease
    SELECT * INTO v_existing_lease
    FROM public.conversation_leases
    WHERE conversation_id = p_conversation_id
    FOR UPDATE;

    -- If an unexpired lease exists, reject acquisition
    IF v_existing_lease.conversation_id IS NOT NULL AND v_existing_lease.expires_at > v_now THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'LEASE_BUSY'::TEXT, 'A response is already being generated for this conversation. Please wait.'::TEXT;
        RETURN;
    END IF;

    -- 4. Generate new unpredictable token and expiry
    v_new_token := gen_random_uuid()::TEXT;
    v_expires_at := v_now + (p_lease_duration_seconds || ' seconds')::INTERVAL;

    INSERT INTO public.conversation_leases (conversation_id, user_id, lease_token, expires_at, created_at)
    VALUES (p_conversation_id, p_user_id, v_new_token, v_expires_at, v_now)
    ON CONFLICT (conversation_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        lease_token = EXCLUDED.lease_token,
        expires_at = EXCLUDED.expires_at,
        created_at = EXCLUDED.created_at;

    RETURN QUERY SELECT TRUE, v_new_token, NULL::TEXT, NULL::TEXT;
END;
$$;

-- Atomic RPC function to release an acquired lease (strictly matching the token)
CREATE OR REPLACE FUNCTION public.release_conversation_lease(
    p_conversation_id UUID,
    p_lease_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.conversation_leases
    WHERE conversation_id = p_conversation_id AND lease_token = p_lease_token;
    
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted > 0;
END;
$$;

-- Atomic RPC function to save chat turn requiring valid, unexpired lease token
CREATE OR REPLACE FUNCTION public.save_chat_turn_with_lease(
    p_conversation_id UUID,
    p_lease_token TEXT,
    p_user_content TEXT,
    p_assistant_content TEXT
)
RETURNS TABLE (
    user_msg_id UUID,
    assistant_msg_id UUID
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now TIMESTAMP WITH TIME ZONE := timezone('utc'::text, now());
    v_lease public.conversation_leases%ROWTYPE;
    v_turn_count INTEGER;
    v_next_seq INTEGER;
    v_user_msg_id UUID;
    v_assistant_msg_id UUID;
BEGIN
    -- Verify active, unexpired lease token
    SELECT * INTO v_lease
    FROM public.conversation_leases
    WHERE conversation_id = p_conversation_id;

    IF v_lease.conversation_id IS NULL OR v_lease.lease_token != p_lease_token OR v_lease.expires_at <= v_now THEN
        RAISE EXCEPTION 'Invalid, stale, or expired generation lease token';
    END IF;

    -- Check session turn limit
    SELECT COUNT(*) INTO v_turn_count
    FROM public.messages
    WHERE conversation_id = p_conversation_id AND role = 'assistant';

    IF v_turn_count >= 100 THEN
        RAISE EXCEPTION 'Session limit reached (100 turns). Please start a new conversation to continue practicing.';
    END IF;

    -- Get next sequence number
    SELECT COALESCE(MAX(sequence), 0) + 1 INTO v_next_seq
    FROM public.messages
    WHERE conversation_id = p_conversation_id;

    -- Insert User Message
    INSERT INTO public.messages (conversation_id, role, content, sequence)
    VALUES (p_conversation_id, 'user', p_user_content, v_next_seq)
    RETURNING id INTO v_user_msg_id;

    -- Insert Assistant Message
    INSERT INTO public.messages (conversation_id, role, content, sequence)
    VALUES (p_conversation_id, 'assistant', p_assistant_content, v_next_seq + 1)
    RETURNING id INTO v_assistant_msg_id;

    -- Update conversation updated_at
    UPDATE public.conversations
    SET updated_at = v_now
    WHERE id = p_conversation_id;

    RETURN QUERY SELECT v_user_msg_id, v_assistant_msg_id;
END;
$$;

-- Security: explicitly restrict execution of lease and save functions to service_role
REVOKE ALL ON FUNCTION public.acquire_conversation_lease(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_conversation_lease(UUID, UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.release_conversation_lease(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_conversation_lease(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.save_chat_turn_with_lease(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_chat_turn_with_lease(UUID, TEXT, TEXT, TEXT) TO service_role;
