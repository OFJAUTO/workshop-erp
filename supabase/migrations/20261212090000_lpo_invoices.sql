-- One LPO, several supplier invoices (10 November 2026, Section 3; the LPO-00043-3 case). The LPO's own invoice columns
-- stay THE first invoice; every further invoice on the same LPO is a row here with the lines (and quantities) it
-- covers. Each is checked, edited, paid and sent to Zoho as its own bill.

create table if not exists public.lpo_invoices (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id),
  supplier_id uuid references public.suppliers(id),
  supplier_name text not null default '',
  number text not null,
  invoice_date date not null,
  -- As printed on the supplier's paper: before VAT and the VAT.
  amount_aed numeric(14,2) not null check (amount_aed >= 0),
  vat_aed numeric(14,2) check (vat_aed is null or vat_aed >= 0),
  -- The LPO lines it covers: [{"line_id": "<purchase_order_lines.id>", "qty": 2}].
  lines jsonb not null default '[]'::jsonb,
  -- How it came: added for lines still waiting, or split off the first invoice.
  origin text not null default 'added' check (origin in ('added', 'split')),
  remark text,
  query text,
  query_at timestamptz,
  query_by uuid references public.staff(id),
  checked_at timestamptz,
  checked_by uuid references public.staff(id),
  paid_at timestamptz,
  paid_by uuid references public.staff(id),
  zoho_bill_id text,
  zoho_bill_taxed boolean,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);
create index if not exists lpo_invoices_po_idx on public.lpo_invoices (po_id) where is_active;
create index if not exists lpo_invoices_supplier_idx on public.lpo_invoices (supplier_id, invoice_date) where is_active;

-- Server-only (the screens go through the server): RLS on, no policies, no grants to logins.
alter table public.lpo_invoices enable row level security;
revoke all on public.lpo_invoices from anon, authenticated;
grant all on public.lpo_invoices to service_role;
drop trigger if exists lpo_invoices_audit on public.lpo_invoices;
create trigger lpo_invoices_audit after insert or update on public.lpo_invoices for each row execute function public.write_audit_log();
drop trigger if exists lpo_invoices_no_delete on public.lpo_invoices;
create trigger lpo_invoices_no_delete before delete on public.lpo_invoices for each row execute function public.prevent_delete();

-- The first invoice's own lines once the LPO has more than one invoice (null = every line not on another invoice).
alter table public.purchase_orders add column if not exists supplier_invoice_lines jsonb;

-- A supplier payment line may pay one of these invoices (null = the LPO's first invoice).
alter table public.supplier_payment_lines add column if not exists lpo_invoice_id uuid references public.lpo_invoices(id);

-- An edit of one of these invoices is kept with the others (null = the LPO's first invoice).
alter table public.supplier_invoice_edits add column if not exists lpo_invoice_id uuid references public.lpo_invoices(id);

-- Zoho: each further invoice posts as its own bill.
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery', 'vendorcredit', 'cnrefund', 'settlement', 'supplierpay', 'paygroup', 'lathebill', 'lpoinvoice'));

notify pgrst, 'reload schema';
