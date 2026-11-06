-- SUPPLIER PAYMENTS (6 November 2026, Section 4, Mathew): a real payment with its amount and method (payment link
-- included), spread over one or several invoices of the same supplier, oldest first. Paid less = part paid; paid more =
-- an advance with the supplier (offered on the next invoice) or a fee. Server-only tables: the pages read them with the
-- server's key; nobody signed in reads them directly.

create sequence if not exists public.supplier_payment_number_seq;

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('SPAY-' || lpad(nextval('public.supplier_payment_number_seq')::text, 5, '0')),
  supplier_id uuid references public.suppliers (id),
  supplier_name text not null,
  paid_on date not null,
  method text not null check (method in ('transfer', 'card', 'cash', 'cheque', 'link')),
  reference text,
  amount_aed numeric(14,2) not null check (amount_aed > 0),
  -- What happens to money paid above the invoices: an advance with the supplier, or a fee / charge (an expense).
  excess_kind text check (excess_kind in ('advance', 'fee')),
  fee_aed numeric(14,2) not null default 0 check (fee_aed >= 0),
  proof_path text,
  note text,
  status text not null default 'recorded' check (status in ('recorded', 'void')),
  void_reason text,
  -- Every edit (owner and accounts, with a remark): [{ at, by, remark, changes: [{ field, old, new }] }].
  edit_history jsonb not null default '[]'::jsonb,
  zoho_payment_id text,
  zoho_fee_expense_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create index if not exists supplier_payments_supplier on public.supplier_payments (supplier_id, paid_on);

-- How a payment is spread: one line per invoice (LPO). An advance used later on a new invoice is a line too.
create table if not exists public.supplier_payment_lines (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.supplier_payments (id),
  po_id uuid not null references public.purchase_orders (id),
  amount_aed numeric(14,2) not null check (amount_aed > 0),
  -- An advance applied to this invoice after the payment was recorded (accounts confirmed it).
  applied_later boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create index if not exists supplier_payment_lines_po on public.supplier_payment_lines (po_id);
create index if not exists supplier_payment_lines_payment on public.supplier_payment_lines (payment_id);

-- The payment that settled an LPO in full (the old one-LPO "Paid to supplier" stays for older LPOs).
alter table public.purchase_orders add column if not exists supplier_payment_id uuid references public.supplier_payments (id);

-- Server only: RLS on, no policies, nothing for anon or signed-in logins.
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_lines enable row level security;
revoke all on public.supplier_payments from anon, authenticated;
revoke all on public.supplier_payment_lines from anon, authenticated;
grant all on public.supplier_payments to service_role;
grant all on public.supplier_payment_lines to service_role;
revoke all on sequence public.supplier_payment_number_seq from anon, authenticated;
grant usage, select on sequence public.supplier_payment_number_seq to service_role;

drop trigger if exists supplier_payments_audit on public.supplier_payments;
create trigger supplier_payments_audit after insert or update on public.supplier_payments for each row execute function public.write_audit_log();
drop trigger if exists supplier_payments_stamp on public.supplier_payments;
create trigger supplier_payments_stamp before insert or update on public.supplier_payments for each row execute function public.set_audit_columns();
drop trigger if exists supplier_payments_no_delete on public.supplier_payments;
create trigger supplier_payments_no_delete before delete on public.supplier_payments for each row execute function public.prevent_delete();
drop trigger if exists supplier_payment_lines_audit on public.supplier_payment_lines;
create trigger supplier_payment_lines_audit after insert or update on public.supplier_payment_lines for each row execute function public.write_audit_log();
drop trigger if exists supplier_payment_lines_stamp on public.supplier_payment_lines;
create trigger supplier_payment_lines_stamp before insert or update on public.supplier_payment_lines for each row execute function public.set_audit_columns();
drop trigger if exists supplier_payment_lines_no_delete on public.supplier_payment_lines;
create trigger supplier_payment_lines_no_delete before delete on public.supplier_payment_lines for each row execute function public.prevent_delete();

-- The Zoho outbox learns the new kind: one vendor payment (bills applied, any excess kept by Zoho as the advance).
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery', 'vendorcredit', 'cnrefund', 'settlement', 'supplierpay'));

notify pgrst, 'reload schema';
