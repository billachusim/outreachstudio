create unique index if not exists idx_social_drafts_unique_cache
  on public.social_drafts (user_id, intel_item_id, platform);