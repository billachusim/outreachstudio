
ALTER TABLE public.lead_fetch_runs
  ADD COLUMN IF NOT EXISTS max_leads integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS query_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retries_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_reason text;
