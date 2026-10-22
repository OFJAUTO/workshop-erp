-- Evening batch of 21 October 2026, section 9: the package keeps its own section on the proforma and
-- the tax invoice too. An invoice line carries the package snapshot it was billed from (copied from the
-- quotation line when the proforma is prepared; the tax invoice copies every column). No new table:
-- no RLS or grant changes needed.

alter table public.invoice_lines add column if not exists package_items jsonb;

-- Open proformas and tax invoices made before today still have their quotation line: copy the snapshot
-- across so those documents show the package section as well.
update public.invoice_lines il
set package_items = ql.package_items
from public.quotation_lines ql
where il.quotation_line_id = ql.id and ql.package_items is not null and il.package_items is null;

notify pgrst, 'reload schema';
