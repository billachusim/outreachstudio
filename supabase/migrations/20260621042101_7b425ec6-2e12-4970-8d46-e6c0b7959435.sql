
ALTER TABLE public.channel_accounts DROP CONSTRAINT IF EXISTS channel_accounts_channel_check;
ALTER TABLE public.channel_accounts ADD CONSTRAINT channel_accounts_channel_check
  CHECK (channel IN ('whatsapp','x','twitter','facebook','instagram','linkedin','telegram','email'));
