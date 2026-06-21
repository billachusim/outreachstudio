
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS base_cv_md text;
ALTER TABLE public.job_posts ADD COLUMN IF NOT EXISTS tailored_cv_md text;
ALTER TABLE public.job_posts ADD COLUMN IF NOT EXISTS tailored_cv_updated_at timestamptz;
