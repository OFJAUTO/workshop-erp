-- 15 November 2026 (URGENT): RECEIVING PARTS MUST NEVER BLOCK THE MECHANIC.
-- A delivery is recorded with ONE reference from the supplier's paper (an invoice number, a pre-payment parts invoice
-- number, a WIP number, or a type the owner or accounts add) or as "Arrived - paperwork pending" with none. Every
-- reference stays on the receipt; invoice_number keeps THE number that counts as the supplier's invoice (null while the
-- real invoice is still due). Which types count is the setting supplier_ref_types.

alter table public.part_receipts add column if not exists refs jsonb not null default '[]'::jsonb;
alter table public.part_receipts add column if not exists paperwork_pending boolean not null default false;

-- The receipts saved before today: their invoice number becomes their one reference.
update public.part_receipts set refs = jsonb_build_array(jsonb_build_object('type', 'invoice', 'number', invoice_number))
where invoice_number is not null and refs = '[]'::jsonb;

insert into public.settings (key, label, value) values
  ('supplier_ref_types', 'Supplier reference types at receiving', '[{"key":"invoice","label":"Invoice number","counts":true},{"key":"prepay","label":"Pre-payment parts invoice number","counts":true},{"key":"wip","label":"WIP number","counts":false}]'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
