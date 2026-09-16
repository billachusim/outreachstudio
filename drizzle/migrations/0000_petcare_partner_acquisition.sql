-- Approval gate for outreach emails
ALTER TABLE public.pitches
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

-- Partner conversion tracking on leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS partner_stage text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS partner_stage_at timestamptz,
  ADD COLUMN IF NOT EXISTS opted_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS services text,
  ADD COLUMN IF NOT EXISTS relevance_reason text,
  ADD COLUMN IF NOT EXISTS source_url text;

CREATE INDEX IF NOT EXISTS leads_partner_stage_idx ON public.leads (user_id, partner_stage);
CREATE INDEX IF NOT EXISTS pitches_approved_idx ON public.pitches (lead_id, approved_at);
