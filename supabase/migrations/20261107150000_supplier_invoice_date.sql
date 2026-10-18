-- 18 October 2026 (afternoon), 3: the supplier invoice date typed at receiving.
alter table public.purchase_orders add column if not exists supplier_invoice_date date;
