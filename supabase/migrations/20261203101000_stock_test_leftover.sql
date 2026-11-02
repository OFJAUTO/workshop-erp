-- Placeholder costs, review fixes (3 November 2026, section 2).
--
-- A test leftover on the live stock list: "Rear brake discs · E2E-DISC-1 · 8 on hand · AED 49.00", made by a browser test
-- on 16 October (before tests moved to the TEST database on 30 October). "From our stock…" now offers the stock list to
-- Parts on every car, so a real brake disc could be priced from this made-up item (AED 49, never on an LPO, "received"
-- at approval). It is switched off (never deleted: the no-delete rule), and only while it is still exactly that test
-- row: the same id, part number and name, and no part on any job uses it. Nothing else changes.
--
-- No new table, column, function or grant: the code of these fixes reads only columns that exist since migration
-- 20261203100000_part_costs (or earlier), and stays dormant where that one is not applied.

do $$
declare
  n int;
begin
  update public.stock_items s
     set is_active = false,
         updated_at = now()
   where s.id = '02a4c243-30a4-4ae4-954b-675141467ee6'
     and s.part_number = 'E2E-DISC-1'
     and lower(s.name) = 'rear brake discs'
     and s.is_active
     and not exists (select 1 from public.part_items p where p.stock_item_id = s.id);
  get diagnostics n = row_count;
  raise notice 'test stock item E2E-DISC-1 switched off: %', n;
end $$;
