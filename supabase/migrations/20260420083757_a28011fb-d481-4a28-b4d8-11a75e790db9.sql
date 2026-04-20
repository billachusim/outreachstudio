-- Helper: extract root domain from URL
CREATE OR REPLACE FUNCTION public.extract_root_domain(url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE host text;
BEGIN
  IF url IS NULL OR length(trim(url)) = 0 THEN RETURN NULL; END IF;
  host := lower(regexp_replace(url, '^(https?://)?([^/?#]+).*$', '\2'));
  host := regexp_replace(host, '^www\.', '');
  host := split_part(host, ':', 1);
  IF length(host) = 0 THEN RETURN NULL; END IF;
  RETURN host;
END;
$$;

-- leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS score smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_intent text,
  ADD COLUMN IF NOT EXISTS root_domain text GENERATED ALWAYS AS (public.extract_root_domain(website)) STORED;

CREATE INDEX IF NOT EXISTS leads_user_score_idx ON public.leads (user_id, score DESC);
CREATE INDEX IF NOT EXISTS leads_user_activity_idx ON public.leads (user_id, last_activity_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS leads_user_root_domain_uniq
  ON public.leads (user_id, root_domain)
  WHERE root_domain IS NOT NULL;

-- campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS email_cap integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS whatsapp_cap integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS social_cap integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS follow_up_days integer[] NOT NULL DEFAULT '{3,7,14}',
  ADD COLUMN IF NOT EXISTS auto_followup boolean NOT NULL DEFAULT true;

-- pitch_events
CREATE TABLE IF NOT EXISTS public.pitch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pitch_id uuid,
  lead_id uuid,
  channel text NOT NULL DEFAULT 'email',
  event_type text NOT NULL,
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  recipient text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pitch_events_user_idx ON public.pitch_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pitch_events_pitch_idx ON public.pitch_events (pitch_id);
CREATE INDEX IF NOT EXISTS pitch_events_lead_idx ON public.pitch_events (lead_id);
CREATE INDEX IF NOT EXISTS pitch_events_provider_msg_idx ON public.pitch_events (provider_message_id);
ALTER TABLE public.pitch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pitch_events select" ON public.pitch_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pitch_events insert" ON public.pitch_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pitch_events delete" ON public.pitch_events FOR DELETE USING (auth.uid() = user_id);

-- pitch_sequences
CREATE TABLE IF NOT EXISTS public.pitch_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  campaign_id uuid,
  parent_pitch_id uuid,
  step integer NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  pitch_id uuid,
  status text NOT NULL DEFAULT 'scheduled',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pitch_sequences_user_due_idx
  ON public.pitch_sequences (user_id, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS pitch_sequences_lead_idx ON public.pitch_sequences (lead_id);
ALTER TABLE public.pitch_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pitch_sequences select" ON public.pitch_sequences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pitch_sequences insert" ON public.pitch_sequences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pitch_sequences update" ON public.pitch_sequences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own pitch_sequences delete" ON public.pitch_sequences FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER trg_pitch_sequences_updated
BEFORE UPDATE ON public.pitch_sequences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- daily_briefings
CREATE TABLE IF NOT EXISTS public.daily_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  briefing_date date NOT NULL,
  body text NOT NULL DEFAULT '',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, briefing_date)
);
CREATE INDEX IF NOT EXISTS daily_briefings_user_date_idx ON public.daily_briefings (user_id, briefing_date DESC);
ALTER TABLE public.daily_briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own briefings select" ON public.daily_briefings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own briefings insert" ON public.daily_briefings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own briefings update" ON public.daily_briefings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own briefings delete" ON public.daily_briefings FOR DELETE USING (auth.uid() = user_id);

-- intel_items (stub)
CREATE TABLE IF NOT EXISTS public.intel_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL,
  url text,
  title text NOT NULL,
  summary text,
  relevance_score smallint DEFAULT 0,
  tags text[],
  posted_at timestamptz,
  acted_on boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_items_user_idx ON public.intel_items (user_id, created_at DESC);
ALTER TABLE public.intel_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own intel select" ON public.intel_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own intel insert" ON public.intel_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own intel update" ON public.intel_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own intel delete" ON public.intel_items FOR DELETE USING (auth.uid() = user_id);

-- Lead score recompute helper
CREATE OR REPLACE FUNCTION public.compute_lead_score(_lead_id uuid)
RETURNS smallint
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  s integer := 0;
  l record;
  has_open boolean;
  has_reply boolean;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF l.contact_email IS NOT NULL AND length(l.contact_email) > 3 THEN s := s + 25; END IF;
  IF l.phone IS NOT NULL AND length(l.phone) > 5 THEN s := s + 15; END IF;
  IF l.website IS NOT NULL AND length(l.website) > 5 THEN s := s + 10; END IF;
  IF l.contact_name IS NOT NULL AND length(l.contact_name) > 1 THEN s := s + 10; END IF;
  IF l.notes IS NOT NULL AND length(l.notes) > 100 THEN s := s + 10; END IF;
  SELECT EXISTS(SELECT 1 FROM public.pitch_events WHERE lead_id = _lead_id AND event_type = 'opened') INTO has_open;
  IF has_open THEN s := s + 15; END IF;
  SELECT EXISTS(SELECT 1 FROM public.pitch_events WHERE lead_id = _lead_id AND event_type = 'replied') INTO has_reply;
  IF has_reply THEN s := s + 25; END IF;
  IF s > 100 THEN s := 100; END IF;
  RETURN s::smallint;
END;
$$;