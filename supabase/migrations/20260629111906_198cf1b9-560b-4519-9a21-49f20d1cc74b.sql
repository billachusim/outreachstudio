ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ad_context jsonb;
CREATE INDEX IF NOT EXISTS idx_leads_ad_context_platform ON public.leads ((ad_context->>'platform')) WHERE ad_context IS NOT NULL;