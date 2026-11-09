-- Promised date on every approved job (9 November 2026): the optional time next to the promised date. The date stays
-- jobs.promised_at (a date); a change of either is logged in job_events with its reason by the server.
alter table public.jobs add column if not exists promised_time time;

-- jobs columns are granted to logged-in users one by one (29 October 2026): the screens read this one.
grant select (promised_time) on public.jobs to authenticated;

notify pgrst, 'reload schema';
