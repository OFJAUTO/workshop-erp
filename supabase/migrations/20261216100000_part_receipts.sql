-- 13 November 2026 (URGENT): THE SUPPLIER'S INVOICE NUMBER AT RECEIVING.
-- Every delivery received (part by part, on a car's LPO or a stock LPO) is one receipt: what arrived, when, who, and the
-- supplier's invoice number - compulsory, unless the supplier is marked "Invoice later allowed" (owner or accounts, at
-- most 5 days), then the receipt is "INVOICE DUE BY <date>" with the delivery paper's photo (or "No paper came").
-- The files (delivery paper, invoice) are kept whole: a retake adds a new file and the old one stays in the history.
-- Server-only tables: the screens read them through the server.

alter table public.suppliers add column if not exists invoice_later_allowed boolean not null default false;
alter table public.suppliers add column if not exists invoice_later_days integer not null default 5;
alter table public.suppliers drop constraint if exists suppliers_invoice_later_days_check;
alter table public.suppliers add constraint suppliers_invoice_later_days_check check (invoice_later_days between 1 and 5);

create table if not exists public.part_receipts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id),
  job_id uuid,
  supplier_id uuid,
  supplier_name text,
  -- [{ line_id, part_item_id, description, qty }]: what arrived in this delivery.
  lines jsonb not null default '[]'::jsonb,
  received_at timestamptz not null default now(),
  received_by uuid references public.staff(id),
  invoice_number text,
  invoice_later boolean not null default false,
  invoice_due_date date,
  no_paper boolean not null default false,
  -- "Same invoice as LPO-…": the number was already used for this supplier and the parts desk confirmed it.
  same_invoice_po_id uuid,
  invoice_entered_at timestamptz,
  invoice_entered_by uuid references public.staff(id),
  -- [{ old, new, by, by_name, at }]: every correction of the number.
  number_history jsonb not null default '[]'::jsonb,
  retake_asked_at timestamptz,
  retake_asked_by uuid references public.staff(id),
  retake_note text,
  retake_done_at timestamptz,
  reminded_day3_at timestamptz,
  reminded_day5_at timestamptz,
  last_reminded_on date,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index if not exists part_receipts_po_idx on public.part_receipts (po_id);
create index if not exists part_receipts_open_idx on public.part_receipts (invoice_due_date) where invoice_number is null and is_active;
create index if not exists part_receipts_number_idx on public.part_receipts (supplier_id, lower(invoice_number)) where invoice_number is not null;

create table if not exists public.receipt_files (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.part_receipts(id),
  kind text not null check (kind in ('paper', 'invoice')),
  path text not null,
  content_type text,
  replaced_at timestamptz,
  replaced_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index if not exists receipt_files_receipt_idx on public.receipt_files (receipt_id, kind, created_at desc);

alter table public.part_receipts enable row level security;
alter table public.receipt_files enable row level security;
revoke all on public.part_receipts from anon, authenticated;
revoke all on public.receipt_files from anon, authenticated;
grant all on public.part_receipts to service_role;
grant all on public.receipt_files to service_role;

drop trigger if exists part_receipts_audit on public.part_receipts;
create trigger part_receipts_audit after insert or update on public.part_receipts for each row execute function public.write_audit_log();
drop trigger if exists part_receipts_stamp on public.part_receipts;
create trigger part_receipts_stamp before insert or update on public.part_receipts for each row execute function public.set_audit_columns();
drop trigger if exists part_receipts_no_delete on public.part_receipts;
create trigger part_receipts_no_delete before delete on public.part_receipts for each row execute function public.prevent_delete();
drop trigger if exists receipt_files_audit on public.receipt_files;
create trigger receipt_files_audit after insert or update on public.receipt_files for each row execute function public.write_audit_log();
drop trigger if exists receipt_files_stamp on public.receipt_files;
create trigger receipt_files_stamp before insert or update on public.receipt_files for each row execute function public.set_audit_columns();
drop trigger if exists receipt_files_no_delete on public.receipt_files;
create trigger receipt_files_no_delete before delete on public.receipt_files for each row execute function public.prevent_delete();

notify pgrst, 'reload schema';
