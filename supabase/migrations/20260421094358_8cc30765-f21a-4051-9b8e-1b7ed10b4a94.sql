create table public.lead_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  state text not null default 'planning',
  hard_ceiling int not null default 200,
  queries_planned int not null default 0,
  queries_run int not null default 0,
  candidates_seen int not null default 0,
  inserted_count int not null default 0,
  high_quality_count int not null default 0,
  enriched_count int not null default 0,
  current_query text,
  credits_estimate int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lead_fetch_runs enable row level security;

create policy "own fetch_runs select" on public.lead_fetch_runs for select using (auth.uid() = user_id);
create policy "own fetch_runs insert" on public.lead_fetch_runs for insert with check (auth.uid() = user_id);
create policy "own fetch_runs update" on public.lead_fetch_runs for update using (auth.uid() = user_id);
create policy "own fetch_runs delete" on public.lead_fetch_runs for delete using (auth.uid() = user_id);

create trigger update_lead_fetch_runs_updated_at
before update on public.lead_fetch_runs
for each row execute function public.update_updated_at_column();

create index idx_lead_fetch_runs_user_state on public.lead_fetch_runs(user_id, state, created_at desc);

alter table public.lead_fetch_runs replica identity full;
alter publication supabase_realtime add table public.lead_fetch_runs;