create table public.briefing_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  briefing_id uuid references public.daily_briefings(id) on delete cascade,
  briefing_date date not null,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  result jsonb,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.briefing_actions to authenticated;
grant all on public.briefing_actions to service_role;

alter table public.briefing_actions enable row level security;

create policy "owners read briefing_actions"
  on public.briefing_actions for select to authenticated
  using (user_id = auth.uid());

create policy "owners insert briefing_actions"
  on public.briefing_actions for insert to authenticated
  with check (user_id = auth.uid());

create policy "owners update briefing_actions"
  on public.briefing_actions for update to authenticated
  using (user_id = auth.uid());

create policy "owners delete briefing_actions"
  on public.briefing_actions for delete to authenticated
  using (user_id = auth.uid());

create index briefing_actions_user_date_idx
  on public.briefing_actions (user_id, briefing_date desc);
create index briefing_actions_status_sched_idx
  on public.briefing_actions (status, scheduled_for);

select cron.schedule(
  'execute-briefing-actions-daily-6pm-wat',
  '0 17 * * *',
  $$
  select net.http_post(
    url:='https://rsuqfpugyztpndjdkpwb.supabase.co/functions/v1/execute-briefing-actions',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdXFmcHVneXp0cG5kamRrcHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDU1NDEsImV4cCI6MjA5MjEyMTU0MX0.lBGVlhqleizAOeXV94aUQl-fWBixUkAtoYXojv5JJY0"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);