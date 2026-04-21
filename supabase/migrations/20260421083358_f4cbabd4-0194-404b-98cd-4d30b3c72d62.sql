ALTER TABLE public.campaigns ALTER COLUMN email_cap SET DEFAULT 20;
UPDATE public.campaigns SET email_cap = 20 WHERE email_cap = 5;