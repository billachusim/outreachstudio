-- New table to track per-host aggregator performance
CREATE TABLE public.aggregator_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  host text NOT NULL,
  source_url text NOT NULL,
  total_extracted integer NOT NULL DEFAULT 0,
  total_high_quality integer NOT NULL DEFAULT 0,
  promoted_to_intel boolean NOT NULL DEFAULT false,
  promoted_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, host)
);

ALTER TABLE public.aggregator_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own aggregator_performance select" ON public.aggregator_performance
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own aggregator_performance insert" ON public.aggregator_performance
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own aggregator_performance update" ON public.aggregator_performance
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own aggregator_performance delete" ON public.aggregator_performance
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_aggregator_performance_user_host ON public.aggregator_performance(user_id, host);

-- Add auto_promoted flag to intel_sources
ALTER TABLE public.intel_sources
  ADD COLUMN IF NOT EXISTS auto_promoted boolean NOT NULL DEFAULT false;

-- Track number of sources promoted in a fetch-leads run
ALTER TABLE public.lead_fetch_runs
  ADD COLUMN IF NOT EXISTS promoted_sources_count integer NOT NULL DEFAULT 0;
