-- JOURNAL VOUCHERS (17 November 2026, Section 6). Advisors enter recovery, fuel, delivery and other charges on a job with
-- "Cost (we pay)". Accounts record each cost as a voucher (JV-00001…): who paid it (company cash, company card, bank
-- transfer, or a staff member's own money to reimburse), the date, the reference and the proof; or "pay later" against
-- one supplier invoice for providers who bill monthly; and manual vouchers for expenses not tied to a car. The voucher
-- uses the SAME charge line the advisor entered (one record, never two). Server-only tables: the pages read them with
-- the server's key (accounts and the owner only, checked on the server).

create sequence if not exists public.journal_voucher_number_seq;

create table if not exists public.journal_vouchers (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('JV-' || lpad(nextval('public.journal_voucher_number_seq')::text, 5, '0')),
  -- charge = from charges entered on jobs; manual = an expense not tied to a car.
  kind text not null default 'charge' check (kind in ('charge', 'manual')),
  -- paid = recorded as paid; unpaid = "pay later" against the provider's invoice; void = taken back with a reason.
  status text not null default 'paid' check (status in ('paid', 'unpaid', 'void')),
  -- Who paid: company cash, company card, bank transfer, or a staff member's own money (to reimburse). Null while unpaid.
  paid_by text check (paid_by is null or paid_by in ('cash', 'card', 'transfer', 'staff')),
  staff_id uuid references public.staff (id),
  paid_on date,
  reference text,
  proof_path text,
  -- The provider and its own invoice (for "pay later" and for VAT).
  provider text,
  provider_trn text,
  provider_invoice_number text,
  provider_invoice_date date,
  -- fuel / recovery / delivery / other: picks the Zoho account (Settings > Zoho Books > Account mapping).
  expense_type text not null default 'other' check (expense_type in ('fuel', 'recovery', 'delivery', 'other')),
  description text,
  amount_aed numeric(14,2) not null check (amount_aed >= 0),
  vat_aed numeric(14,2) not null default 0 check (vat_aed >= 0),
  note text,
  reimbursed_at timestamptz,
  reimbursed_by uuid references public.staff (id),
  reimburse_method text,
  reimburse_reference text,
  void_reason text,
  edit_history jsonb not null default '[]'::jsonb,
  zoho_expense_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create index if not exists journal_vouchers_status on public.journal_vouchers (status, paid_on);
create index if not exists journal_vouchers_staff on public.journal_vouchers (staff_id) where paid_by = 'staff' and reimbursed_at is null;

-- The charges a voucher covers (one voucher can cover several charges of one provider's monthly invoice).
create table if not exists public.journal_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.journal_vouchers (id),
  charge_line_id uuid not null references public.charge_lines (id),
  job_id uuid references public.jobs (id),
  amount_aed numeric(14,2) not null check (amount_aed >= 0),
  vat_aed numeric(14,2) not null default 0 check (vat_aed >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create index if not exists journal_voucher_lines_voucher on public.journal_voucher_lines (voucher_id);
-- One charge is on one live voucher only (never paid twice).
create unique index if not exists journal_voucher_lines_one on public.journal_voucher_lines (charge_line_id) where is_active;

-- Server only: RLS on, no policies, nothing for anon or signed-in logins.
alter table public.journal_vouchers enable row level security;
alter table public.journal_voucher_lines enable row level security;
revoke all on public.journal_vouchers from anon, authenticated;
revoke all on public.journal_voucher_lines from anon, authenticated;
grant all on public.journal_vouchers to service_role;
grant all on public.journal_voucher_lines to service_role;
revoke all on sequence public.journal_voucher_number_seq from anon, authenticated;
grant usage, select on sequence public.journal_voucher_number_seq to service_role;

drop trigger if exists journal_vouchers_audit on public.journal_vouchers;
create trigger journal_vouchers_audit after insert or update on public.journal_vouchers for each row execute function public.write_audit_log();
drop trigger if exists journal_vouchers_stamp on public.journal_vouchers;
create trigger journal_vouchers_stamp before insert or update on public.journal_vouchers for each row execute function public.set_audit_columns();
drop trigger if exists journal_vouchers_no_delete on public.journal_vouchers;
create trigger journal_vouchers_no_delete before delete on public.journal_vouchers for each row execute function public.prevent_delete();
drop trigger if exists journal_voucher_lines_audit on public.journal_voucher_lines;
create trigger journal_voucher_lines_audit after insert or update on public.journal_voucher_lines for each row execute function public.write_audit_log();
drop trigger if exists journal_voucher_lines_stamp on public.journal_voucher_lines;
create trigger journal_voucher_lines_stamp before insert or update on public.journal_voucher_lines for each row execute function public.set_audit_columns();
drop trigger if exists journal_voucher_lines_no_delete on public.journal_voucher_lines;
create trigger journal_voucher_lines_no_delete before delete on public.journal_voucher_lines for each row execute function public.prevent_delete();

-- "Delivery" is a fourth charge type on the job's charges form.
alter table public.charge_lines drop constraint if exists charge_lines_kind_check;
alter table public.charge_lines add constraint charge_lines_kind_check check (kind in ('recovery', 'fuel', 'other', 'delivery'));

-- The Zoho outbox learns the voucher (an expense in Zoho, OFJ TEST until go-live).
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery', 'vendorcredit', 'cnrefund', 'settlement', 'supplierpay', 'paygroup', 'lathebill', 'lpoinvoice', 'stockuse', 'jv'));

notify pgrst, 'reload schema';
