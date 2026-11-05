-- SUPPLIER INVOICE EDIT (5 November 2026, the owner's urgent case LPO-00037-2 / Gargash): the owner
-- and accounts edit an entered supplier invoice's number, date, amount and VAT with a COMPULSORY
-- remark; every edit keeps who, when and old → new, visible on the invoice and the LPO.

-- The invoice's own VAT (suppliers round differently): empty = 5% of the before-VAT amount, as today.
alter table public.purchase_orders add column if not exists supplier_invoice_vat_aed numeric(14,2);

-- The edit history (server-only: written and read by server code, shown on staff pages it renders).
create table public.supplier_invoice_edits (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id),
  remark text not null,
  -- [{ field: "amount", old: "12228.30", new: "11684.82" }, …] in plain strings, ready to print.
  changes jsonb not null,
  -- When the LPO was already paid: the new total minus the old (minus = the supplier owes us).
  paid_difference_aed numeric(14,2),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index supplier_invoice_edits_po on public.supplier_invoice_edits (po_id, created_at);

alter table public.supplier_invoice_edits enable row level security;
revoke all on public.supplier_invoice_edits from anon, authenticated;
grant all on public.supplier_invoice_edits to service_role;

create trigger supplier_invoice_edits_nodel before delete on public.supplier_invoice_edits for each row execute function prevent_delete();
create trigger supplier_invoice_edits_stamp before insert or update on public.supplier_invoice_edits for each row execute function set_audit_columns();

notify pgrst, 'reload schema';
