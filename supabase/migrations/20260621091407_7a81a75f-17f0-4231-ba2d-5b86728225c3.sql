ALTER TABLE public.job_posts
  ADD COLUMN IF NOT EXISTS draft jsonb,
  ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;