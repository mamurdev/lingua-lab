-- supabase/migrations/0001_initial_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CONVERSATIONS
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 3 AND 80),
    language TEXT NOT NULL,
    level TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
);

-- MESSAGES
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (char_length(trim(content)) > 0),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (conversation_id, sequence)
);

-- EXERCISES
CREATE TABLE public.exercises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    quiz JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX idx_conversations_updated_at ON public.conversations(updated_at DESC);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_sequence ON public.messages(sequence);
CREATE INDEX idx_exercises_conversation_id ON public.exercises(conversation_id);

-- ENABLE ROW LEVEL SECURITY
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES

-- Conversations: Users can read, insert, and delete their own conversations.
CREATE POLICY "Users can read their own conversations" 
    ON public.conversations FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own conversations" 
    ON public.conversations FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations" 
    ON public.conversations FOR DELETE 
    USING (auth.uid() = user_id);

-- Messages: Users can read messages of their own conversations.
CREATE POLICY "Users can read messages of their own conversations" 
    ON public.messages FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations 
            WHERE conversations.id = messages.conversation_id 
            AND conversations.user_id = auth.uid()
        )
    );

-- Exercises: Users can read exercises of their own conversations.
CREATE POLICY "Users can read exercises of their own conversations" 
    ON public.exercises FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations 
            WHERE conversations.id = exercises.conversation_id 
            AND conversations.user_id = auth.uid()
        )
    );

-- Note: We intentionally DO NOT provide client-side INSERT policies for messages or exercises, 
-- because according to the PRD (Authorization section), these should be generated/written 
-- securely from the backend using the service-role key.

-- RPC function to atomically save a full chat turn (User + Assistant)
CREATE OR REPLACE FUNCTION public.save_chat_turn(
    p_conversation_id UUID,
    p_user_content TEXT,
    p_assistant_content TEXT
)
RETURNS TABLE (
    user_msg_id UUID,
    assistant_msg_id UUID
) 
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the creator
AS $$
DECLARE
    v_next_seq INTEGER;
    v_user_msg_id UUID;
    v_assistant_msg_id UUID;
BEGIN
    -- Get the next sequence number for this conversation
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
    SET updated_at = timezone('utc'::text, now())
    WHERE id = p_conversation_id;

    -- Return the inserted IDs
    RETURN QUERY SELECT v_user_msg_id, v_assistant_msg_id;
END;
$$;
