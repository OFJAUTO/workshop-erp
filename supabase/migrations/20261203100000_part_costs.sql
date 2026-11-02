-- Placeholder costs (2 November 2026, section 2: Q-00039's FRONT LH GRILL SURROUND MOULDING at AED 1.00 from "OFJ
-- Additional", sold at 871.00 = "87,000%").
--
-- 1. "Yes, real price": the cost each Parts (or the advisor, for an estimate part) confirmed as real, who and when.
--    A different cost later is asked again (partCostCheck in src/lib/part-cost-check.ts). Plain columns on tables that
--    keep their RLS, policies and grants (no column grant needed: only gate_ins, jobs, gate_outs, job_items and
--    appointments hide columns from the login role). The approved-quote lock (erp_lock_quotation_lines) is unchanged:
--    a confirmation is written only while an estimate is being prepared.
-- 2. An estimate part taken from our own shelf ("From our stock…" on the parts desk): its stock item, so the part made
--    from it at gate-in is linked to the same item (part_items.stock_item_id exists since 1 November).
-- 3. The four limits, seeded with their labels (Settings > Money): ask under AED 5, flag under 50% of the last price
--    paid, "similar" within 20%, warn on a markup over 500%.
-- 4. Part numbers (J-00969's "12"): line numbers ("1", "13") and "OFJ"/"OFJ1" stand-ins become "NO NUMBER" (the honest
--    answer, which is never printed) on parts and on estimate part lines of estimates still being prepared (draft or
--    waiting for the owner: never a locked quotation). LPO lines and invoice lines keep what was stored; every screen
--    and document hides them (realPartNumber).
-- The "OFJ Additional" and "Our stock" supplier rows are NOT deactivated: live parts use them. A part with a stand-in
-- supplier shows "Not a supplier" and is not finished until Parts pick the real supplier or From our stock.

alter table public.part_items add column if not exists cost_confirmed_aed numeric(12,2);
alter table public.part_items add column if not exists cost_confirmed_at timestamptz;
alter table public.part_items add column if not exists cost_confirmed_by uuid references public.staff (id);
comment on column public.part_items.cost_confirmed_aed is 'The cost each Parts confirmed as real ("Yes, real price"); a different cost is asked again (2 November 2026).';

alter table public.quotation_lines add column if not exists cost_confirmed_aed numeric(12,2);
alter table public.quotation_lines add column if not exists cost_confirmed_at timestamptz;
alter table public.quotation_lines add column if not exists cost_confirmed_by uuid references public.staff (id);
alter table public.quotation_lines add column if not exists stock_item_id uuid references public.stock_items (id);
comment on column public.quotation_lines.cost_confirmed_aed is 'An estimate part: the cost each confirmed as real by the parts desk or the advisor (2 November 2026).';
comment on column public.quotation_lines.stock_item_id is 'An estimate part from our own shelf: the stock item (its average cost is the line''s cost).';

insert into public.settings (key, value, label) values
  ('part_cost_ask_below_aed', to_jsonb(5), 'Parts: ask "Is this the real price?" for a cost each under (AED)'),
  ('part_cost_far_below_percent', to_jsonb(50), 'Parts: flag a cost under this percent of the last price paid for the same part number'),
  ('part_cost_similar_percent', to_jsonb(20), 'Parts: a cheap cost bought before within this percent is not asked again'),
  ('part_markup_warn_percent', to_jsonb(500), 'Quotations: warn on a part markup over (%)')
on conflict (key) do nothing;

do $$
declare
  n int;
begin
  update public.part_items
     set part_number = 'NO NUMBER'
   where part_number ~ '^\s*[0-9]{1,3}\s*$'
      or part_number ~* '^\s*ofj[\s\-_./]*[0-9]{0,3}\s*$';
  get diagnostics n = row_count;
  raise notice 'part numbers that were line numbers or OFJ stand-ins, now NO NUMBER (parts): %', n;

  update public.quotation_lines l
     set part_number = 'NO NUMBER'
   where l.line_type = 'part'
     and l.part_item_id is null
     and (l.part_number ~ '^\s*[0-9]{1,3}\s*$' or l.part_number ~* '^\s*ofj[\s\-_./]*[0-9]{0,3}\s*$')
     and exists (select 1 from public.quotations q where q.id = l.quotation_id and q.status in ('draft', 'pending_owner'));
  get diagnostics n = row_count;
  raise notice 'part numbers that were line numbers or OFJ stand-ins, now NO NUMBER (estimate parts being prepared): %', n;
end $$;

notify pgrst, 'reload schema';
