
-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- handle_new_user trigger: create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Offerings
CREATE TABLE public.offerings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  tagline TEXT,
  target_audience TEXT,
  problem_solved TEXT,
  pricing TEXT,
  demo_url TEXT,
  screenshot_url TEXT,
  testimonial TEXT,
  ideal_customer TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.offerings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own offerings select" ON public.offerings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own offerings insert" ON public.offerings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own offerings update" ON public.offerings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own offerings delete" ON public.offerings FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER set_offerings_updated_at BEFORE UPDATE ON public.offerings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Campaigns
CREATE TABLE public.campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offering_id UUID REFERENCES public.offerings(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  city TEXT,
  category TEXT,
  keywords TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own campaigns select" ON public.campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own campaigns insert" ON public.campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own campaigns update" ON public.campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own campaigns delete" ON public.campaigns FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER set_campaigns_updated_at BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Leads
CREATE TYPE public.lead_status AS ENUM ('new','enriched','drafted','sent','opened','replied','won','lost');
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  website TEXT,
  phone TEXT,
  address TEXT,
  contact_email TEXT,
  contact_name TEXT,
  status public.lead_status NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own leads select" ON public.leads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own leads insert" ON public.leads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own leads update" ON public.leads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own leads delete" ON public.leads FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER set_leads_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_leads_campaign ON public.leads(campaign_id);

-- Pitches
CREATE TABLE public.pitches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pitches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pitches select" ON public.pitches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pitches insert" ON public.pitches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pitches update" ON public.pitches FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own pitches delete" ON public.pitches FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER set_pitches_updated_at BEFORE UPDATE ON public.pitches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Templates
CREATE TABLE public.templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own templates select" ON public.templates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own templates insert" ON public.templates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own templates update" ON public.templates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own templates delete" ON public.templates FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER set_templates_updated_at BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
