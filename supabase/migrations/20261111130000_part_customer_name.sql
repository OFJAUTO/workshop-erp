-- 21 October 2026, part 1 section 1.5: two names per part. The supplier name (description) stays on
-- LPOs, the parts pages and the stickers; the customer name, editable by the advisor or the owner,
-- goes on the quotation, proforma, invoice and their PDFs. Empty means the supplier name is used.
alter table public.part_items add column if not exists customer_name text;
