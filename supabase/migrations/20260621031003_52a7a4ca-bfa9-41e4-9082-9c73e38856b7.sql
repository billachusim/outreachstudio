
CREATE UNIQUE INDEX IF NOT EXISTS pitch_sequences_unique_active_step
ON public.pitch_sequences (lead_id, step)
WHERE status = 'scheduled';
