-- 20 October 2026, part 2 section 3: the advance payment is a real step. The advisor's "Send deposit
-- request" is stamped on the job, so the step bar, the next-step line and the Waiting lists all know
-- whether the request has gone out.
alter table public.jobs
  add column if not exists deposit_requested_at timestamptz,
  add column if not exists deposit_requested_by uuid references public.staff(id);
