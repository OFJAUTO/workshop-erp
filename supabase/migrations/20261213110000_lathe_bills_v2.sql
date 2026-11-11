-- 11 November 2026, Section 6 (lathe bills, KA-673205): a lathe bill can be corrected while unpaid and not in Zoho
-- (every change kept in its history), voided with a reason and the owner's approval once paid or in Zoho (nothing
-- deleted), and paid through Supplier payments like any supplier invoice, advances included.

alter table public.lathe_bills add column if not exists edit_history jsonb not null default '[]'::jsonb;
alter table public.lathe_bills add column if not exists void_requested_at timestamptz;
alter table public.lathe_bills add column if not exists void_requested_by uuid references public.staff(id);
alter table public.lathe_bills add column if not exists void_request_reason text;
alter table public.lathe_bills add column if not exists voided_at timestamptz;
alter table public.lathe_bills add column if not exists voided_by uuid references public.staff(id);
alter table public.lathe_bills add column if not exists void_reason text;

-- A supplier payment line pays an LPO or a lathe bill.
alter table public.supplier_payment_lines alter column po_id drop not null;
alter table public.supplier_payment_lines add column if not exists lathe_bill_id uuid references public.lathe_bills(id);
alter table public.supplier_payment_lines drop constraint if exists supplier_payment_lines_target;
alter table public.supplier_payment_lines add constraint supplier_payment_lines_target check (po_id is not null or lathe_bill_id is not null);
create index if not exists supplier_payment_lines_lathe_idx on public.supplier_payment_lines (lathe_bill_id) where lathe_bill_id is not null;

-- A supplier invoice with no car (a stock LPO, a lathe bill) is filed like any other: job_files.job_id may be empty for it.
alter table public.job_files alter column job_id drop not null;
alter table public.job_files drop constraint if exists job_files_car_or_supplier_invoice;
alter table public.job_files add constraint job_files_car_or_supplier_invoice check (job_id is not null or kind = 'supplier_invoice');

notify pgrst, 'reload schema';
