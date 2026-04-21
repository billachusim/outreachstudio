-- Phase 3: custom intel sources per user
CREATE TABLE public.intel_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.intel_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own intel_sources select" ON public.intel_sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own intel_sources insert" ON public.intel_sources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own intel_sources update" ON public.intel_sources FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own intel_sources delete" ON public.intel_sources FOR DELETE USING (auth.uid() = user_id);

-- Phase 3: keyword boosters + Phase 2: auto-lead toggle on offerings
ALTER TABLE public.offerings ADD COLUMN trigger_keywords text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.offerings ADD COLUMN auto_lead_from_intel boolean NOT NULL DEFAULT false;

-- Phase 1: link intel items to leads/pitches
ALTER TABLE public.intel_items ADD COLUMN linked_lead_id uuid;
ALTER TABLE public.intel_items ADD COLUMN linked_pitch_id uuid;
CREATE INDEX idx_intel_items_linked_lead ON public.intel_items(linked_lead_id);
CREATE INDEX idx_intel_items_user_acted ON public.intel_items(user_id, acted_on, created_at);

-- Phase 4: social drafts
CREATE TABLE public.social_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  intel_item_id uuid,
  platform text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  posted_at timestamptz,
  provider_post_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own social_drafts select" ON public.social_drafts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own social_drafts insert" ON public.social_drafts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own social_drafts update" ON public.social_drafts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own social_drafts delete" ON public.social_drafts FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_social_drafts_user_status ON public.social_drafts(user_id, status, created_at DESC);