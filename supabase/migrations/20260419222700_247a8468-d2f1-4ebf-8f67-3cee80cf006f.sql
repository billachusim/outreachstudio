CREATE TABLE public.agent_memories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  content text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own memories select" ON public.agent_memories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own memories insert" ON public.agent_memories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own memories update" ON public.agent_memories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own memories delete" ON public.agent_memories FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_agent_memories_updated_at
BEFORE UPDATE ON public.agent_memories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_agent_memories_user ON public.agent_memories(user_id);