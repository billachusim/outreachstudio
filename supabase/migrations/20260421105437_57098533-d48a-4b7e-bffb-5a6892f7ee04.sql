ALTER TABLE public.lead_fetch_runs
  ADD COLUMN IF NOT EXISTS aggregators_exploded integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extracted_businesses integer NOT NULL DEFAULT 0;