
-- 1. Add columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS x_url text,
  ADD COLUMN IF NOT EXISTS enrichment_summary text,
  ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz;

-- 2. Add region columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS outreach_region text NOT NULL DEFAULT 'Nigeria',
  ADD COLUMN IF NOT EXISTS outreach_country_code text NOT NULL DEFAULT 'ng';

-- 3. Update compute_lead_score to factor in socials + enrichment_summary
CREATE OR REPLACE FUNCTION public.compute_lead_score(_lead_id uuid)
 RETURNS smallint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  s integer := 0;
  l record;
  has_open boolean;
  has_reply boolean;
  socials integer := 0;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF l.contact_email IS NOT NULL AND length(l.contact_email) > 3 THEN s := s + 25; END IF;
  IF l.phone IS NOT NULL AND length(l.phone) > 5 THEN s := s + 15; END IF;
  IF l.website IS NOT NULL AND length(l.website) > 5 THEN s := s + 10; END IF;
  IF l.contact_name IS NOT NULL AND length(l.contact_name) > 1 THEN s := s + 10; END IF;
  IF l.notes IS NOT NULL AND length(l.notes) > 100 THEN s := s + 10; END IF;
  IF l.enrichment_summary IS NOT NULL AND length(l.enrichment_summary) > 200 THEN s := s + 10; END IF;
  -- socials: +5 each, capped at +15
  IF l.linkedin_url IS NOT NULL AND length(l.linkedin_url) > 5 THEN socials := socials + 5; END IF;
  IF l.instagram_url IS NOT NULL AND length(l.instagram_url) > 5 THEN socials := socials + 5; END IF;
  IF l.facebook_url IS NOT NULL AND length(l.facebook_url) > 5 THEN socials := socials + 5; END IF;
  IF l.x_url IS NOT NULL AND length(l.x_url) > 5 THEN socials := socials + 5; END IF;
  IF socials > 15 THEN socials := 15; END IF;
  s := s + socials;
  SELECT EXISTS(SELECT 1 FROM public.pitch_events WHERE lead_id = _lead_id AND event_type = 'opened') INTO has_open;
  IF has_open THEN s := s + 15; END IF;
  SELECT EXISTS(SELECT 1 FROM public.pitch_events WHERE lead_id = _lead_id AND event_type = 'replied') INTO has_reply;
  IF has_reply THEN s := s + 25; END IF;
  IF s > 100 THEN s := 100; END IF;
  RETURN s::smallint;
END;
$function$;

-- 4. Trigger function: auto-score on insert/update of leads
CREATE OR REPLACE FUNCTION public.trg_leads_autoscore()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
DECLARE
  new_score smallint;
BEGIN
  new_score := public.compute_lead_score(NEW.id);
  IF NEW.score IS DISTINCT FROM new_score THEN
    NEW.score := new_score;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_autoscore_trg ON public.leads;
CREATE TRIGGER leads_autoscore_trg
BEFORE INSERT OR UPDATE OF contact_email, phone, website, contact_name, notes,
                          enrichment_summary, linkedin_url, instagram_url,
                          facebook_url, x_url
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.trg_leads_autoscore();

-- 5. Trigger function: re-score lead on pitch_events open/reply
CREATE OR REPLACE FUNCTION public.trg_pitch_events_rescore()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.event_type IN ('opened', 'replied') THEN
    UPDATE public.leads
       SET score = public.compute_lead_score(NEW.lead_id)
     WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pitch_events_rescore_trg ON public.pitch_events;
CREATE TRIGGER pitch_events_rescore_trg
AFTER INSERT ON public.pitch_events
FOR EACH ROW
EXECUTE FUNCTION public.trg_pitch_events_rescore();

-- 6. Backfill all existing leads' scores
UPDATE public.leads SET score = public.compute_lead_score(id);
