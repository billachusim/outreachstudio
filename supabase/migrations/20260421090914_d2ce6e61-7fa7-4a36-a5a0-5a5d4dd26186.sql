ALTER TABLE public.campaigns ALTER COLUMN email_cap SET DEFAULT 50;
ALTER TABLE public.campaigns ALTER COLUMN whatsapp_cap SET DEFAULT 50;
ALTER TABLE public.campaign_runs ALTER COLUMN target_lead_count SET DEFAULT 50;