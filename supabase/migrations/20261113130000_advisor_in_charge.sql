-- Evening batch of 21 October 2026, section 4: ONE advisor in charge per car.
-- jobs.advisor_id is set at gate-in (or when an estimate's car arrives), changeable by advisors and the
-- owner (logged). Notifications about a car go to its advisor in charge plus anyone who pressed Follow -
-- never to every advisor. job_followers holds the optional follows.

alter table public.jobs add column if not exists advisor_id uuid references public.staff(id);
create index if not exists jobs_advisor_idx on public.jobs (advisor_id) where advisor_id is not null;

-- Backfill: the person who gated the car in when they are an advisor; else whoever sent the approval
-- link; else the estimate's creator; owners count as their own advisor-in-charge.
update public.jobs j
set advisor_id = coalesce(
  (select s.id from public.staff s where s.id = j.gated_in_by and s.role_id in ('service_advisor', 'owner')),
  (select a.sent_by from public.approval_requests a join public.staff s2 on s2.id = a.sent_by and s2.role_id in ('service_advisor', 'owner')
     where a.job_id = j.id order by a.created_at asc limit 1),
  (select q.created_by from public.quotations q join public.staff s3 on s3.id = q.created_by and s3.role_id in ('service_advisor', 'owner')
     where q.job_id = j.id order by q.created_at asc limit 1)
)
where j.advisor_id is null;

-- Follows: an advisor's own opt-in to another advisor's car. Written by server actions only.
create table public.job_followers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  staff_id uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true,
  unique (job_id, staff_id)
);
alter table public.job_followers enable row level security;
-- Server-only writes; signed-in staff may read who follows a car (shown on the job card).
create policy job_followers_read on public.job_followers
  for select to authenticated using (auth.uid() is not null);
grant select on public.job_followers to authenticated;
grant all on public.job_followers to service_role;
create trigger job_followers_audit after insert or update on public.job_followers for each row execute function write_audit_log();
create trigger job_followers_nodel before delete on public.job_followers for each row execute function prevent_delete();
create trigger job_followers_stamp before insert or update on public.job_followers for each row execute function set_audit_columns();

notify pgrst, 'reload schema';
