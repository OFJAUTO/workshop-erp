-- 15 November 2026, Section 4: LATHE INVOICES GO THROUGH SUPPLIER INVOICES FIRST.
-- A lathe bill shows on Supplier invoices like any supplier invoice (tagged LATHE): accounts check it (or query it), and
-- only a checked bill can be paid on Supplier payments. Its Zoho bill goes at the check, like every supplier bill.
-- lathe_bills is server-only (RLS on, no policies, no grants to logins) - unchanged.

alter table public.lathe_bills add column if not exists checked_at timestamptz;
alter table public.lathe_bills add column if not exists checked_by uuid references public.staff(id);
alter table public.lathe_bills add column if not exists query text;
alter table public.lathe_bills add column if not exists query_at timestamptz;
alter table public.lathe_bills add column if not exists query_by uuid references public.staff(id);

-- Bills entered (and paid, or sent to Zoho) before today count as checked: nothing already settled goes back to accounts.
update public.lathe_bills set checked_at = coalesce(paid_at, created_at)
where checked_at is null and (paid_at is not null or zoho_bill_id is not null
  or exists (select 1 from public.supplier_payment_lines l where l.lathe_bill_id = lathe_bills.id and l.is_active));

notify pgrst, 'reload schema';
