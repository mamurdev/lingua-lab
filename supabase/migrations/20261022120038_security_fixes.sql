-- Lock down functions so only the backend (service_role) can call them
REVOKE ALL ON FUNCTION public.save_chat_turn(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_chat_turn_with_lease(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_and_consume_quota(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_conversation_lease(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_conversation_lease(UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_chat_turn(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_chat_turn_with_lease(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_and_consume_quota(UUID, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_conversation_lease(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_conversation_lease(UUID, TEXT) TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Race-free lease acquisition
CREATE OR REPLACE FUNCTION public.acquire_conversation_lease(
    p_conversation_id UUID,
    p_user_id UUID,
    p_lease_duration_seconds INTEGER DEFAULT 90
)
RETURNS TABLE (acquired BOOLEAN, lease_token TEXT, error_code TEXT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_owner UUID;
    v_turns INTEGER;
    v_token TEXT;
BEGIN
    SELECT c.user_id INTO v_owner FROM conversations c WHERE c.id = p_conversation_id;

    IF v_owner IS NULL OR v_owner <> p_user_id THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'NOT_FOUND'::TEXT, 'Conversation not found'::TEXT;
        RETURN;
    END IF;

    SELECT COUNT(*) INTO v_turns
    FROM messages m WHERE m.conversation_id = p_conversation_id AND m.role = 'assistant';

    IF v_turns >= 100 THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'SESSION_COMPLETED'::TEXT,
          'Session limit reached (100 turns). Please start a new conversation.'::TEXT;
        RETURN;
    END IF;

    INSERT INTO conversation_leases AS cl (conversation_id, user_id, lease_token, expires_at, created_at)
    VALUES (p_conversation_id, p_user_id, gen_random_uuid()::TEXT,
            v_now + make_interval(secs => p_lease_duration_seconds), v_now)
    ON CONFLICT (conversation_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          lease_token = EXCLUDED.lease_token,
          expires_at = EXCLUDED.expires_at,
          created_at = EXCLUDED.created_at
      WHERE cl.expires_at <= v_now
    RETURNING cl.lease_token INTO v_token;

    IF v_token IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'LEASE_BUSY'::TEXT,
          'A response is already being generated for this conversation.'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, v_token, NULL::TEXT, NULL::TEXT;
END;
$$;

-- Re-assert grants after the function replacement
REVOKE ALL ON FUNCTION public.acquire_conversation_lease(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_conversation_lease(UUID, UUID, INTEGER) TO service_role;
