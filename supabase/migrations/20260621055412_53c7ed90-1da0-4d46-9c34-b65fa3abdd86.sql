
CREATE TABLE public.email_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  outreach_cap smallint NOT NULL DEFAULT 60,
  jobhunt_cap smallint NOT NULL DEFAULT 25,
  outreach_sent smallint NOT NULL DEFAULT 0,
  jobhunt_sent smallint NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_budgets TO authenticated;
GRANT ALL ON public.email_budgets TO service_role;

ALTER TABLE public.email_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own budgets" ON public.email_budgets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own budgets" ON public.email_budgets
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own budgets" ON public.email_budgets
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own budgets" ON public.email_budgets
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER email_budgets_set_updated_at
  BEFORE UPDATE ON public.email_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS max_follow_ups smallint NOT NULL DEFAULT 3;

UPDATE public.campaigns
  SET max_follow_ups = 1,
      follow_up_days = ARRAY[14]::int[]
  WHERE mode = 'job_hunt';

CREATE INDEX IF NOT EXISTS job_posts_user_posted_idx
  ON public.job_posts (user_id, posted_at DESC NULLS LAST);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS reply_intent text;
