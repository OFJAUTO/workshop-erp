-- 13 November 2026 (URGENT, J-00317): BACK ORDER - FIT ON A LATER VISIT.
-- A part that will not come in time for this visit (a 60-day special order) leaves the job: the car is finished,
-- invoiced and released now, and a linked follow-up job ("Continues J-00317", status booked = "Waiting for part -
-- car not here") carries the part with its LPO, the labour for fitting it and the customer's existing approval.
-- One row per back-ordered part. Server-only: the screens read it through the server (it carries money).

alter table public.jobs add column if not exists continues_job_id uuid;
create index if not exists jobs_continues_idx on public.jobs (continues_job_id) where continues_job_id is not null;
-- The new column is read by the login role on the job card (the job card reads jobs as the person).
grant select (continues_job_id) on public.jobs to authenticated;

create table if not exists public.back_orders (
  id uuid primary key default gen_random_uuid(),
  -- This visit, and the follow-up job made for the later visit (plain uuids: two keys to jobs would make every jobs
  -- embed of this table ambiguous; the server reads them apart).
  job_id uuid not null,
  follow_job_id uuid,
  part_item_id uuid not null references public.part_items(id),
  -- The quotation line that charges the part (moved whole) and the shared labour line (hours moved).
  quotation_id uuid,
  part_line_id uuid,
  labour_line_id uuid,
  labour_hours_moved numeric(6,2) not null default 0,
  -- The customer's money that moves to the follow-up job: before VAT and with VAT (exactly; the two jobs add up to the approval).
  moved_net_aed numeric(12,2),
  moved_total_aed numeric(12,2),
  follow_quotation_id uuid,
  reason text not null,
  -- 'now' = the customer pays for the part now (an advance on the follow-up job); 'when_fitted' needs the owner.
  pay_mode text not null default 'now' check (pay_mode in ('now', 'when_fitted')),
  status text not null default 'pending' check (status in ('pending', 'active', 'refused', 'arrived', 'fitted', 'cancelled')),
  expected_date date,
  requested_by uuid references public.staff(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.staff(id),
  decided_at timestamptz,
  decision_note text,
  deposit_invoice_id uuid,
  appointment_id uuid,
  arrived_at timestamptz,
  arrived_notified_at timestamptz,
  fitted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index if not exists back_orders_job_idx on public.back_orders (job_id);
create index if not exists back_orders_follow_idx on public.back_orders (follow_job_id);
create index if not exists back_orders_part_idx on public.back_orders (part_item_id);
create index if not exists back_orders_open_idx on public.back_orders (status) where status in ('pending', 'active', 'arrived');
-- One live back order per part.
create unique index if not exists back_orders_one_per_part on public.back_orders (part_item_id) where is_active and status in ('pending', 'active', 'arrived', 'fitted');

alter table public.back_orders enable row level security;
revoke all on public.back_orders from anon, authenticated;
grant all on public.back_orders to service_role;

drop trigger if exists back_orders_audit on public.back_orders;
create trigger back_orders_audit after insert or update on public.back_orders for each row execute function public.write_audit_log();
drop trigger if exists back_orders_stamp on public.back_orders;
create trigger back_orders_stamp before insert or update on public.back_orders for each row execute function public.set_audit_columns();
drop trigger if exists back_orders_no_delete on public.back_orders;
create trigger back_orders_no_delete before delete on public.back_orders for each row execute function public.prevent_delete();

notify pgrst, 'reload schema';
