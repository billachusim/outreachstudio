
select cron.unschedule('daily-briefing-8am-wat');
select cron.unschedule('scan-jobs-every-3h');
select cron.unschedule('campaign-tick-every-2min');
select cron.unschedule('follow-up-tick-every-10min');

select cron.schedule(
  'scan-jobs-twice-daily',
  '0 6,18 * * *',
  $$
  select net.http_post(
    url:='https://rsuqfpugyztpndjdkpwb.supabase.co/functions/v1/scan-jobs',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdXFmcHVneXp0cG5kamRrcHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDU1NDEsImV4cCI6MjA5MjEyMTU0MX0.lBGVlhqleizAOeXV94aUQl-fWBixUkAtoYXojv5JJY0"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

select cron.schedule(
  'campaign-tick-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url:='https://rsuqfpugyztpndjdkpwb.supabase.co/functions/v1/campaign-tick',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdXFmcHVneXp0cG5kamRrcHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDU1NDEsImV4cCI6MjA5MjEyMTU0MX0.lBGVlhqleizAOeXV94aUQl-fWBixUkAtoYXojv5JJY0"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

select cron.schedule(
  'follow-up-tick-every-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url:='https://rsuqfpugyztpndjdkpwb.supabase.co/functions/v1/follow-up-tick',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdXFmcHVneXp0cG5kamRrcHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDU1NDEsImV4cCI6MjA5MjEyMTU0MX0.lBGVlhqleizAOeXV94aUQl-fWBixUkAtoYXojv5JJY0"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);
