-- 13 November 2026, Section 2 (option B): the ERP is the only stock count; Zoho keeps the stock VALUE.
-- A stock item used on a job (or put back from one) posts one Zoho journal that moves its cost between the stock value
-- account and the job's cost account. The code is dormant until this column exists (stockUseColumnReady).

-- The new outbox kind.
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery', 'vendorcredit', 'cnrefund', 'settlement', 'supplierpay', 'paygroup', 'lathebill', 'lpoinvoice', 'stockuse'));

-- The journal of a stock movement in Zoho (server writes only; the column follows the table's existing rules).
alter table public.stock_movements add column if not exists zoho_journal_id text;

notify pgrst, 'reload schema';
