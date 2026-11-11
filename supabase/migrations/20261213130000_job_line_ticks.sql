-- 11 November 2026, Section 9: the technician ticks each job of the approved quotation as done (both departments).
-- A mechanical job with a work line also moves that work line; a bodyshop job (no work line) is ticked here only.
-- Server-only: the screens write it through the server.

create table if not exists public.job_line_ticks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  quotation_line_id uuid not null references public.quotation_lines(id),
  done_at timestamptz,
  done_by uuid references public.staff(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  unique (job_id, quotation_line_id)
);

alter table public.job_line_ticks enable row level security;
revoke all on public.job_line_ticks from anon, authenticated;
grant all on public.job_line_ticks to service_role;

drop trigger if exists job_line_ticks_audit on public.job_line_ticks;
create trigger job_line_ticks_audit after insert or update on public.job_line_ticks for each row execute function public.write_audit_log();
drop trigger if exists job_line_ticks_stamp on public.job_line_ticks;
create trigger job_line_ticks_stamp before insert or update on public.job_line_ticks for each row execute function public.set_audit_columns();
drop trigger if exists job_line_ticks_no_delete on public.job_line_ticks;
create trigger job_line_ticks_no_delete before delete on public.job_line_ticks for each row execute function public.prevent_delete();

notify pgrst, 'reload schema';
