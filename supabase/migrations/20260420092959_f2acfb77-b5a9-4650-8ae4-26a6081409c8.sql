ALTER TABLE public.intel_items
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_offerings uuid[] DEFAULT '{}'::uuid[];

CREATE UNIQUE INDEX IF NOT EXISTS intel_items_user_url_unique
  ON public.intel_items(user_id, url) WHERE url IS NOT NULL;

CREATE INDEX IF NOT EXISTS intel_items_user_created_idx
  ON public.intel_items(user_id, created_at DESC);