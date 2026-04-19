-- Extensions for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Run state enum
DO $$ BEGIN
  CREATE TYPE public.run_state AS ENUM (
    'queued', 'discovering', 'enriching', 'drafting', 'sending',
    'paused', 'done', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- campaign_runs
CREATE TABLE IF NOT EXISTS public.campaign_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  state public.run_state NOT NULL DEFAULT 'queued',
  daily_send_cap integer NOT NULL DEFAULT 50,
  target_lead_count integer NOT NULL DEFAULT 20,
  leads_found integer NOT NULL DEFAULT 0,
  leads_enriched integer NOT NULL DEFAULT 0,
  leads_drafted integer NOT NULL DEFAULT 0,
  leads_sent integer NOT NULL DEFAULT 0,
  leads_failed integer NOT NULL DEFAULT 0,
  error text,
  last_step_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own runs select" ON public.campaign_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own runs insert" ON public.campaign_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own runs update" ON public.campaign_runs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own runs delete" ON public.campaign_runs FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_campaign_runs_state ON public.campaign_runs(state);
CREATE INDEX IF NOT EXISTS idx_campaign_runs_user ON public.campaign_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_runs_campaign ON public.campaign_runs(campaign_id);

CREATE TRIGGER trg_campaign_runs_updated
  BEFORE UPDATE ON public.campaign_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- run_events (activity feed)
CREATE TABLE IF NOT EXISTS public.run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  run_id uuid REFERENCES public.campaign_runs(id) ON DELETE CASCADE,
  campaign_id uuid,
  lead_id uuid,
  kind text NOT NULL,
  message text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.run_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own events select" ON public.run_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own events insert" ON public.run_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own events delete" ON public.run_events FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_run_events_user ON public.run_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON public.run_events(run_id, created_at DESC);

-- Chat tables
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own convos select" ON public.chat_conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own convos insert" ON public.chat_conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own convos update" ON public.chat_conversations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own convos delete" ON public.chat_conversations FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_chat_conversations_updated
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  tool_calls jsonb,
  tool_name text,
  tool_call_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own messages select" ON public.chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own messages insert" ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own messages delete" ON public.chat_messages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_convo ON public.chat_messages(conversation_id, created_at);