-- 20 October 2026, part 2 section 2: the supplier invoice carries its own date (from the paper),
-- a supplier LPO is marked paid only with the number, the date and the scan on file, job files can
-- be removed (the x on a thumbnail, never deleted), and the daily "invoice missing" reminder to
-- Parts has its stamp.
alter table public.purchase_orders
  add column if not exists supplier_invoice_date date,
  add column if not exists supplier_paid_at timestamptz,
  add column if not exists supplier_paid_by uuid references public.staff(id),
  add column if not exists supplier_paid_reference text,
  add column if not exists invoice_reminder_at timestamptz;

alter table public.job_files
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.staff(id);
