-- Owner's answers of 27 October 2026.
-- 1. Paying a supplier records HOW it was paid (bank transfer / card / cash / cheque, bank transfer by default) and a
--    proof (bank slip, card slip, signed receipt or cheque copy) — the Zoho vendor payment uses that method and the
--    paid-from account the mapping names for it.
-- 2. The live Zoho test suites stamp when they ran: the go-live panel warns when one ran in the 7 days before a flip
--    (their documents stay in OFJ TEST and turn those days red).

alter table public.purchase_orders add column if not exists supplier_paid_method text not null default 'transfer';
alter table public.purchase_orders drop constraint if exists purchase_orders_supplier_paid_method_check;
alter table public.purchase_orders add constraint purchase_orders_supplier_paid_method_check check (supplier_paid_method in ('transfer', 'card', 'cash', 'cheque'));
alter table public.purchase_orders add column if not exists supplier_paid_proof_path text;
alter table public.purchase_orders add column if not exists supplier_paid_proof_at timestamptz;
alter table public.purchase_orders add column if not exists supplier_paid_proof_by uuid references public.staff (id);

insert into public.settings (key, value, label, description) values
  ('zoho_last_live_test_at', '""'::jsonb, 'Zoho Books: last live test run', 'Stamped by the live Zoho test suites. The go-live panel warns when one ran in the last 7 days.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
