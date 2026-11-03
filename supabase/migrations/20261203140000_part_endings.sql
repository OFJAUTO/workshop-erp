-- Removing an ordered part (3 November 2026, section 7; J-00969, FRONT LH GRILL SURROUND MOULDING on LPO-00037-1).
--
-- The endings of an ordered part that is not needed are Cancelled with the supplier (nothing delivered), Return to
-- supplier (delivered: a supplier credit note is awaited and tracked) and Keep in stock. The code works WITHOUT this
-- migration (it is live at once): until it is applied, "cancelled" and "return pending" are written as disposition NULL
-- with disposition_at set (only an ending ever does that), and a credit note's number goes in disposition_note.
--
-- This migration:
--   1. lets part_items.disposition hold the two states by name ('cancelled', 'return_pending');
--   2. adds the supplier credit note's own columns (number, amount, date, who and when it was recorded);
--   3. names the endings already written the old way (guarded: only rows still in exactly that shape);
--   4. an index for the "Waiting for a supplier credit note" list.
-- No new table, function or trigger; part_items keeps its RLS policies, audit and no-delete triggers and grants (new
-- columns on part_items need no column grant). Nothing else changes.

-- 1. The two new states.
alter table public.part_items drop constraint if exists part_items_disposition_check;
alter table public.part_items add constraint part_items_disposition_check
  check (disposition is null or disposition in ('returned', 'stock', 'fit_pending', 'fit_approved', 'scrap', 'cancelled', 'return_pending'));

-- 2. The supplier credit note of a part returned to the supplier.
alter table public.part_items add column if not exists credit_note_number text;
alter table public.part_items add column if not exists credit_note_amount_aed numeric(12,2);
alter table public.part_items add column if not exists credit_note_date date;
alter table public.part_items add column if not exists credit_note_at timestamptz;
alter table public.part_items add column if not exists credit_note_by uuid references public.staff (id);

-- 3. Endings written before this migration: disposition NULL + disposition_at set + the part marked not needed and off
--    the job. "to_return" = waiting for the credit note, anything else = cancelled with the supplier.
do $$
declare
  n int;
begin
  update public.part_items
     set disposition = case when return_status = 'to_return' then 'return_pending' else 'cancelled' end
   where disposition is null
     and disposition_at is not null
     and not_needed_at is not null
     and removed_at is not null;
  get diagnostics n = row_count;
  raise notice 'endings named: %', n;
end $$;

-- 4. The credit notes still awaited, oldest first.
create index if not exists part_items_return_pending_idx on public.part_items (disposition_at) where disposition = 'return_pending';

notify pgrst, 'reload schema';
