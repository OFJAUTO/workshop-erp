-- PURCHASE RETURNS (8 November 2026, Section 8): one PR- record per part (or part of a quantity) going back to its
-- supplier, from "Return to supplier" on the Parts table to its outcome: credit received, refund received, replaced
-- or refused by the supplier. The printable return note for the supplier comes from this row (no customer details).
-- The supplier balance moves only when accounts record the credit or refund; until then the row is "Credit expected".
-- Server-only: the pages read it with the server's key; nobody signed in reads it directly.

create sequence if not exists public.purchase_return_number_seq;

create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('PR-' || lpad(nextval('public.purchase_return_number_seq')::text, 5, '0')),
  part_item_id uuid not null references public.part_items (id),
  job_id uuid references public.jobs (id),
  po_id uuid references public.purchase_orders (id),
  po_line_id uuid references public.purchase_order_lines (id),
  supplier_id uuid references public.suppliers (id),
  supplier_name text not null,
  description text not null,
  part_number text,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0,
  supplier_invoice_number text,
  reason text not null,
  status text not null default 'requested' check (status in ('requested', 'sent', 'credited', 'refunded', 'replaced', 'refused')),
  requested_at timestamptz not null default now(),
  requested_by uuid references public.staff (id),
  -- Sent back: when, who took it to the supplier (or the supplier's driver who collected it), the signed slip.
  sent_at timestamptz,
  sent_by uuid references public.staff (id),
  sent_with text,
  slip_path text,
  -- Credit received: the supplier's credit note as printed.
  credit_number text,
  credit_date date,
  credit_net_aed numeric(14,2),
  credit_vat_aed numeric(14,2),
  credit_scan_path text,
  -- Refund received: money back from the supplier.
  refund_method text check (refund_method in ('transfer', 'card', 'cash', 'cheque')),
  refund_date date,
  refund_aed numeric(14,2),
  -- Replaced: the supplier sent the right part instead.
  replacement_part_id uuid references public.part_items (id),
  -- Refused by the supplier: back to our stock at cost, or written off with the owner's approval.
  refused_action text check (refused_action in ('stock', 'write_off')),
  write_off_status text check (write_off_status in ('pending', 'approved', 'declined')),
  write_off_decided_by uuid references public.staff (id),
  write_off_decided_at timestamptz,
  -- A restocking fee the supplier keeps (an expense, never an advance), charged to the job or to overhead.
  restock_fee_aed numeric(14,2) not null default 0 check (restock_fee_aed >= 0),
  cost_to text check (cost_to in ('job', 'overhead')),
  outcome_note text,
  closed_at timestamptz,
  closed_by uuid references public.staff (id),
  credit_reminded_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);

create index if not exists purchase_returns_part_idx on public.purchase_returns (part_item_id);
create index if not exists purchase_returns_po_idx on public.purchase_returns (po_id);
create index if not exists purchase_returns_status_idx on public.purchase_returns (status);

alter table public.purchase_returns enable row level security;
revoke all on public.purchase_returns from anon, authenticated;
grant all on public.purchase_returns to service_role;
revoke all on sequence public.purchase_return_number_seq from anon, authenticated;
grant usage, select on sequence public.purchase_return_number_seq to service_role;

create trigger purchase_returns_audit after insert or update on public.purchase_returns for each row execute function public.write_audit_log();
create trigger purchase_returns_stamp before insert or update on public.purchase_returns for each row execute function public.set_audit_columns();
create trigger purchase_returns_no_delete before delete on public.purchase_returns for each row execute function public.prevent_delete();

notify pgrst, 'reload schema';
