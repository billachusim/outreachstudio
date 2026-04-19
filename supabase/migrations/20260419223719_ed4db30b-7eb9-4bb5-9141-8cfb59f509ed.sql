-- channel_accounts: stores per-user connected channels
CREATE TABLE public.channel_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','x','facebook','instagram')),
  display_name TEXT NOT NULL,
  external_id TEXT,
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel, external_id)
);

ALTER TABLE public.channel_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own channel_accounts select" ON public.channel_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own channel_accounts insert" ON public.channel_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own channel_accounts update" ON public.channel_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own channel_accounts delete" ON public.channel_accounts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_channel_accounts_updated_at
BEFORE UPDATE ON public.channel_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- channel_messages: log of every send/receive across channels
CREATE TABLE public.channel_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  channel_account_id UUID REFERENCES public.channel_accounts(id) ON DELETE SET NULL,
  lead_id UUID,
  campaign_id UUID,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  to_address TEXT,
  from_address TEXT,
  subject TEXT,
  body TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own channel_messages select" ON public.channel_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own channel_messages insert" ON public.channel_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own channel_messages delete" ON public.channel_messages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_channel_messages_user_created ON public.channel_messages (user_id, created_at DESC);
CREATE INDEX idx_channel_messages_lead ON public.channel_messages (lead_id);

-- campaigns: add channel + auto_send
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS auto_send BOOLEAN NOT NULL DEFAULT false;