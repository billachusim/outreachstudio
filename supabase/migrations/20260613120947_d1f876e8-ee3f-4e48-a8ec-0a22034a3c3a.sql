ALTER TABLE public.pitches
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS message_id_header text;
CREATE INDEX IF NOT EXISTS pitches_provider_msg_idx ON public.pitches(provider_message_id);
CREATE INDEX IF NOT EXISTS pitches_msgid_header_idx ON public.pitches(message_id_header);