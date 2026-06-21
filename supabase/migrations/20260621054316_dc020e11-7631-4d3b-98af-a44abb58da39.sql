
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'scan-jobs-every-3h',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://rsuqfpugyztpndjdkpwb.supabase.co/functions/v1/scan-jobs',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdXFmcHVneXp0cG5kamRrcHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDU1NDEsImV4cCI6MjA5MjEyMTU0MX0.lBGVlhqleizAOeXV94aUQl-fWBixUkAtoYXojv5JJY0"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
