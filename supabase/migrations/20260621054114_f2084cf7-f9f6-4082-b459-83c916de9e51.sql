
-- intel_sources.kind
ALTER TABLE public.intel_sources
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'news';

-- campaigns.mode
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'outreach';

-- job_posts
CREATE TABLE IF NOT EXISTS public.job_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text,
  title text NOT NULL,
  company text,
  url text NOT NULL,
  apply_email text,
  apply_url text,
  location text,
  salary_text text,
  posted_at timestamptz,
  description text,
  score smallint DEFAULT 0,
  matched_offering_id uuid,
  status text NOT NULL DEFAULT 'new',
  tags text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_posts TO authenticated;
GRANT ALL ON public.job_posts TO service_role;

ALTER TABLE public.job_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_posts_owner_select" ON public.job_posts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "job_posts_owner_insert" ON public.job_posts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "job_posts_owner_update" ON public.job_posts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "job_posts_owner_delete" ON public.job_posts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_job_posts_updated_at
  BEFORE UPDATE ON public.job_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_job_posts_user_score ON public.job_posts (user_id, score DESC, created_at DESC);

-- leads.job_post_id
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS job_post_id uuid REFERENCES public.job_posts(id) ON DELETE SET NULL;

-- marketplace_profiles
CREATE TABLE IF NOT EXISTS public.marketplace_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  url text,
  last_updated_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_profiles TO authenticated;
GRANT ALL ON public.marketplace_profiles TO service_role;

ALTER TABLE public.marketplace_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketplace_profiles_owner_all" ON public.marketplace_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_marketplace_profiles_updated_at
  BEFORE UPDATE ON public.marketplace_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
