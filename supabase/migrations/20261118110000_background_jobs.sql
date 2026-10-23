-- 23 October 2026: the scheduled background jobs record every run (Settings > Background jobs, owner only): when it
-- ran, whether it worked and what it did. A job that has not run on time (mailbox check over 15 minutes, hourly
-- housekeeping over 2 hours) turns red and tells the owner once (late_notified_at, cleared by the next good run).
-- Server-only: RLS on, NO policies, no anon or authenticated grants, only service_role. No audit trigger: the
-- mailbox check writes it every five minutes (like the mailbox token row).
create table if not exists public.background_jobs (
  key text primary key,
  label text not null,
  schedule_label text not null,
  late_after_minutes integer not null,
  last_ran_at timestamptz,
  last_ok boolean,
  last_result text,
  late_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.background_jobs enable row level security;
revoke all on public.background_jobs from anon, authenticated;
grant all on public.background_jobs to service_role;

insert into public.background_jobs (key, label, schedule_label, late_after_minutes) values
  ('mailbox', 'Mailbox check', 'every 5 minutes', 15),
  ('housekeeping', 'Hourly housekeeping', 'every hour', 120)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
