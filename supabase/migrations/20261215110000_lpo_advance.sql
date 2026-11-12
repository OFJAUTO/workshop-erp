-- 13 November 2026, Section 4: pay a supplier in advance against an LPO (special orders paid before the invoice).
-- An advance is a supplier payment with no invoice yet; it names the LPO it was paid for (a plain uuid: a second
-- foreign key between supplier_payments and purchase_orders would break every unhinted embed between them).
-- The parts desk can mark an LPO "Supplier needs payment first" (accounts get the task).
alter table public.supplier_payments add column if not exists advance_for_po_id uuid;
create index if not exists supplier_payments_advance_po_idx on public.supplier_payments (advance_for_po_id) where advance_for_po_id is not null;

alter table public.purchase_orders add column if not exists pay_first_at timestamptz;
-- plain uuid (no new foreign key: an extra purchase_orders → staff key could make existing embeds ambiguous).
alter table public.purchase_orders add column if not exists pay_first_by uuid;
alter table public.purchase_orders add column if not exists pay_first_note text;

notify pgrst, 'reload schema';
