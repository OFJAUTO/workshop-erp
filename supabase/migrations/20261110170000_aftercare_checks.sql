-- The 10-day after-care check on package jobs (20 October 2026): booked at gate-out, reminded on day 8,
-- signed off by the PPF team leader with his PIN; "not done" matters for warranty claims.
create table if not exists public.aftercare_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) unique,
  appointment_id uuid references public.appointments (id),
  due_date date not null,
  reminded_at timestamptz,
  overdue_notified_at timestamptz,
  done_at timestamptz,
  done_by uuid references public.staff (id),
  notes text,
  findings jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
alter table public.aftercare_checks enable row level security;
drop policy if exists aftercare_checks_read on public.aftercare_checks;
create policy aftercare_checks_read on public.aftercare_checks for select to authenticated using (true);
