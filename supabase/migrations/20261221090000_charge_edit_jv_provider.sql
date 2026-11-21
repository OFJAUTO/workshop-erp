-- 21 November 2026: EDIT A CHARGE AFTER IT IS SAVED (Section 1) and the JOURNAL VOUCHER provider and invoice details when
-- recording as paid (Section 2). Additive columns only, on tables that already have RLS, policies, grants and the audit,
-- stamp and no-delete triggers. Nothing is removed.

-- A charge names its provider from the SUPPLIER LIST (the same record the Journal Voucher uses), keeps a note, its own
-- edit history (who, when, old value, new value) and when its receipt was asked for.
alter table public.charge_lines add column if not exists supplier_id uuid references public.suppliers (id);
alter table public.charge_lines add column if not exists note text;
alter table public.charge_lines add column if not exists edit_history jsonb not null default '[]'::jsonb;
alter table public.charge_lines add column if not exists receipt_asked_at timestamptz;
alter table public.charge_lines add column if not exists receipt_asked_by uuid references public.staff (id);

-- A voucher names its provider from the supplier list too, and says when it was recorded without a receipt.
alter table public.journal_vouchers add column if not exists supplier_id uuid references public.suppliers (id);
alter table public.journal_vouchers add column if not exists no_receipt boolean not null default false;

create index if not exists charge_lines_supplier on public.charge_lines (supplier_id) where supplier_id is not null;
create index if not exists journal_vouchers_supplier on public.journal_vouchers (supplier_id) where supplier_id is not null;

notify pgrst, 'reload schema';
