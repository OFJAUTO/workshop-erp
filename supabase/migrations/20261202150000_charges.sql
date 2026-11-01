-- EARLY CHARGES and PENDING CHARGES (1 November 2026, B2; J-00971 FERRARI 550, RASHED AL SHAMSI TRANSPORT).
--
-- One table of charge lines for both. Each line has a COST (what we pay the provider: amount, supplier, their bill
-- and TRN) and a CHARGE (what the customer pays, or free).
--   - On a job (job_id): recovery, fuel and other costs added any time. Before the customer approves the vehicle
--     check-in they are listed on it as "CHARGES ALREADY INCURRED" and agreed with it (agreed_at, the approval's
--     charges_snapshot); after the approval they go into the quotation (quotation_line_id). The invoice carries
--     every agreed charge exactly once (invoice_id), and a line is locked once invoiced.
--   - Without a gate-in (entry_id): a PENDING CHARGE (a recovery-only trip, a car that never came in, or one that
--     came and left with a bill still open) with its own PROFORMA, never on another job's bill; paid in full it
--     becomes a tax invoice.
-- Server-only tables (the screens read and write them through the server): RLS on, no policies, no grants to anon or
-- authenticated.

create table if not exists public.charge_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  vehicle_id uuid references public.vehicles(id),
  job_id uuid references public.jobs(id),
  service_date date not null default current_date,
  note text,
  proforma_id uuid references public.invoices(id),
  tax_invoice_id uuid references public.invoices(id),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.staff(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);

create table if not exists public.charge_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id),
  entry_id uuid references public.charge_entries(id),
  kind text not null check (kind in ('recovery', 'fuel', 'other')),
  description text not null,
  provider text,
  recovery_type text,
  trips integer,
  litres numeric(10,2),
  cost_aed numeric(12,2) not null default 0,
  cost_vat_aed numeric(12,2),
  supplier_trn text,
  bill_path text,
  charge_aed numeric(12,2) not null default 0,
  free boolean not null default false,
  free_status text check (free_status is null or free_status in ('approved', 'pending_owner', 'refused')),
  trip_id uuid references public.recovery_trips(id),
  service_date date,
  agreed_at timestamptz,
  approval_request_id uuid references public.approval_requests(id),
  quotation_line_id uuid references public.quotation_lines(id),
  invoice_id uuid references public.invoices(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  constraint charge_lines_home check (job_id is not null or entry_id is not null)
);

create index if not exists charge_lines_job_idx on public.charge_lines (job_id) where is_active;
create index if not exists charge_lines_entry_idx on public.charge_lines (entry_id) where is_active;
create index if not exists charge_entries_customer_idx on public.charge_entries (customer_id) where is_active;

alter table public.charge_entries enable row level security;
alter table public.charge_lines enable row level security;
revoke all on public.charge_entries from anon, authenticated;
revoke all on public.charge_lines from anon, authenticated;
grant all on public.charge_entries to service_role;
grant all on public.charge_lines to service_role;

-- The usual triggers: audit (who and when), the stamps, and no delete (rows go inactive).
drop trigger if exists charge_entries_audit on public.charge_entries;
create trigger charge_entries_audit after insert or update on public.charge_entries for each row execute function public.write_audit_log();
drop trigger if exists charge_entries_stamp on public.charge_entries;
create trigger charge_entries_stamp before insert or update on public.charge_entries for each row execute function public.set_audit_columns();
drop trigger if exists charge_lines_audit on public.charge_lines;
create trigger charge_lines_audit after insert or update on public.charge_lines for each row execute function public.write_audit_log();
drop trigger if exists charge_lines_stamp on public.charge_lines;
create trigger charge_lines_stamp before insert or update on public.charge_lines for each row execute function public.set_audit_columns();
drop trigger if exists charge_entries_no_delete on public.charge_entries;
create trigger charge_entries_no_delete before delete on public.charge_entries for each row execute function public.prevent_delete();
drop trigger if exists charge_lines_no_delete on public.charge_lines;
create trigger charge_lines_no_delete before delete on public.charge_lines for each row execute function public.prevent_delete();

-- The customer's approval keeps the charges it listed.
alter table public.approval_requests add column if not exists charges_snapshot jsonb;

-- After X days pending, the advisor is reminded (Waiting on you).
insert into public.settings (key, value, label)
values ('pending_charges_reminder_days', to_jsonb(7), 'Pending charges: remind the advisor after (days)')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
