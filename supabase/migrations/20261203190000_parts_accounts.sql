-- Section 12 of 2 November 2026 (built 3 November): PARTS ACCOUNTS + the suppliers search.
--
-- The Parts accounts page itself needs NO database change: it reads the existing tables through the server (owner and
-- accounts only, permission viewPartsAccounts in src/lib/roles.ts, like the Zoho page). This migration adds only:
--   1. suppliers.contact_name - the person we deal with at the supplier ("Contact person" on Parts > Suppliers, found
--      by the suppliers search). Until it is applied the box is not shown and nothing reads or writes the column
--      (supplierContactReady in src/lib/schema-ready.ts).
--   2. the setting supplier_credit_wait_days (14): a part returned to the supplier with no credit note on file turns
--      red under Parts accounts > Problems after this many days (Settings > Money). The code default is the same, so
--      nothing waits on this row; it is seeded with its label so Settings shows and saves it.
-- No new table, no new policy, no new grant: suppliers keeps its table grants and RLS (a new column of an existing
-- table is covered by them). No live data is changed.

alter table public.suppliers add column if not exists contact_name text;
comment on column public.suppliers.contact_name is 'The person we deal with at the supplier (Parts > Suppliers; found by the suppliers search).';

insert into public.settings (key, value, label)
values ('supplier_credit_wait_days', to_jsonb(14), 'Supplier credit note: days to wait')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
