-- 26 October 2026, Zoho Books phase 2 (docs/zoho-plan.md): credit notes, vendors, bills, vendor payments and
-- expenses join the same outbox. Same rules: one row per document, ids stored on the ERP records, OFJ TEST only.
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery'));

-- The Zoho id on every synced record (one-way: ids and the stored figures are all that ever come back).
alter table public.suppliers add column if not exists zoho_vendor_id text;
alter table public.purchase_orders add column if not exists zoho_bill_id text;
alter table public.purchase_orders add column if not exists zoho_billpayment_id text;
alter table public.invoices add column if not exists zoho_creditnote_id text;
alter table public.commission_payments add column if not exists zoho_expense_id text;
alter table public.recovery_payouts add column if not exists zoho_expense_id text;

notify pgrst, 'reload schema';
