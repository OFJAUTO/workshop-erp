-- Quantity and unit on every parts form (section 9 of 2 November 2026, built 3 November: E-00058, Rolls-Royce Cullinan
-- 2021 - the parts desk saw "ENGINE OIL – ROLLS ROYCE GENUINE ×1" with no way to change it, and "7" meant litres only
-- in people's heads).
--
-- 1. A part's UNIT: pieces (pc, the default), litres (l) or sets (set). The cost is per unit, so 8 L at AED 165 is
--    AED 1,320. On part items (the job's Parts table) and on quotation lines (the estimate's own parts and the job
--    quotation's part lines, which follow their part). Documents print "ENGINE OIL – ROLLS-ROYCE GENUINE · 8 L" and
--    "8 L" in the QTY column; invoices and LPOs read the unit of the line's part or quotation line (no copy needed).
-- 2. An estimate part line: the quantity the advisor asked for before the parts desk changed it (asked_quantity, kept
--    once, so "Advisor asked 1, Parts changed to 8 L" survives), when and by whom the quantity changed, and the list
--    price and supplier discount of the shared Parts row (the estimate desk now uses the same row as a job's parts).
-- 3. The parts list (Settings > Parts list) may say litres: engine oil, coolant, brake fluid, transmission, differential
--    and transfer case oil are set to litres (compressor oil is left to the owner).
-- 4. Open work only follows: parts not ordered yet whose name is a fluid become litres (their requests with them, and
--    open fluid requests with no part yet), and the part lines of quotations and estimates still being prepared (draft
--    or waiting for the owner) follow their part or their name.
--    Nothing approved, sent, invoiced or on an LPO changes (sent documents stay exactly as the customer saw them).
--
-- Plain columns on tables that keep their RLS, policies and grants (no column grant needed: only gate_ins, jobs,
-- gate_outs, job_items and appointments hide columns from the login role). The audit and lock triggers cover new
-- columns by themselves; the approved-quote lock refuses the new columns on approved lines like any other.

alter table public.part_items add column if not exists unit text not null default 'pc';
alter table public.part_items drop constraint if exists part_items_unit_check;
alter table public.part_items add constraint part_items_unit_check check (unit in ('pc', 'l', 'set'));
comment on column public.part_items.unit is 'Pieces (pc), litres (l) or sets (set); the cost is per unit (3 November 2026).';

alter table public.quotation_lines add column if not exists unit text not null default 'pc';
alter table public.quotation_lines drop constraint if exists quotation_lines_unit_check;
alter table public.quotation_lines add constraint quotation_lines_unit_check check (unit in ('pc', 'l', 'set'));
alter table public.quotation_lines add column if not exists asked_quantity numeric(10,2);
alter table public.quotation_lines add column if not exists quantity_changed_at timestamptz;
alter table public.quotation_lines add column if not exists quantity_changed_by uuid references public.staff (id);
alter table public.quotation_lines add column if not exists list_price_aed numeric(12,2);
alter table public.quotation_lines add column if not exists supplier_discount_percent numeric(5,2);
comment on column public.quotation_lines.unit is 'A part line: pieces (pc), litres (l) or sets (set); the cost and the selling price are per unit.';
comment on column public.quotation_lines.asked_quantity is 'An estimate part: the quantity the advisor asked for before the parts desk changed it (kept once).';
comment on column public.quotation_lines.list_price_aed is 'An estimate part priced on the shared Parts row: the supplier''s list price per unit (the net is unit_cost).';
comment on column public.quotation_lines.supplier_discount_percent is 'An estimate part: the supplier''s discount off the list price (not the customer''s discount_percent).';

alter table public.part_catalogue drop constraint if exists part_catalogue_unit_check;
alter table public.part_catalogue add constraint part_catalogue_unit_check check (unit in ('each', 'set', 'l'));

do $$
declare
  n int;
  fluid constant text := '(engine|motor) oil|coolant|anti-?freeze|transmission (oil|fluid)|gearbox oil|\matf\M|gear oil|(differential|diff|axle) oil|transfer (case|box) oil|brake fluid|power steering (fluid|oil)|(^|[^a-z0-9])[0-9o]{1,2} ?w ?-? ?[0-9]{2}([^0-9]|$)';
  not_fluid constant text := '\m(filters?|seals?|pumps?|cooler|pan|gaskets?|hoses?|pipes?|lines?|caps?|sensors?|housing|tanks?|reservoirs?|level|separator|radiator|thermostat|plugs?|washers?|valves?|bottle|switch|dipstick|o-?rings?|rings?|bolts?|covers?|elements?|mounts?|brackets?|screws?|clamps?|jets?)\M';
begin
  update public.part_catalogue
     set unit = 'l'
   where unit = 'each'
     and upper(name) in ('ENGINE OIL', 'COOLANT', 'BRAKE FLUID', 'TRANSMISSION OIL', 'DIFFERENTIAL OIL', 'TRANSFER CASE OIL');
  get diagnostics n = row_count;
  raise notice 'parts list entries now in litres: %', n;

  -- The requests of the open fluid parts converted just below follow them first (a request's "pc" was nobody's choice:
  -- the inspection's parts list stored it for every fluid), so a converted row never reads "Technician asked 8, Parts
  -- changed to 8 L" when nobody changed anything (review of 3 November 2026).
  update public.part_requests r
     set unit = 'l'
   where coalesce(r.unit, 'pc') not in ('l', 'set')
     and exists (
       select 1 from public.part_items p
        where p.part_request_id = r.id
          and p.unit = 'pc'
          and p.is_active
          and p.order_status = 'none'
          and p.confirm_status <> 'rejected'
          and p.description ~* fluid
          and p.description !~* not_fluid);
  get diagnostics n = row_count;
  raise notice 'requests of open fluid parts now in litres: %', n;

  -- Open requests with no part yet whose name is a fluid (the screens read them so already; the stored value agrees).
  update public.part_requests r
     set unit = 'l'
   where r.is_active
     and r.status in ('open', 'listed')
     and coalesce(r.unit, 'pc') not in ('l', 'set')
     and r.label ~* fluid
     and r.label !~* not_fluid
     and not exists (select 1 from public.part_items p where p.part_request_id = r.id);
  get diagnostics n = row_count;
  raise notice 'open fluid requests with no part yet now in litres: %', n;

  -- Open parts (not ordered, not removed) whose name is a fluid.
  update public.part_items
     set unit = 'l'
   where unit = 'pc'
     and is_active
     and order_status = 'none'
     and confirm_status <> 'rejected'
     and description ~* fluid
     and description !~* not_fluid;
  get diagnostics n = row_count;
  raise notice 'open parts now in litres: %', n;

  -- The part lines of quotations still being prepared follow their part.
  update public.quotation_lines l
     set unit = p.unit
    from public.part_items p
   where l.part_item_id = p.id
     and l.line_type = 'part'
     and l.is_active
     and l.unit <> p.unit
     and exists (select 1 from public.quotations q where q.id = l.quotation_id and q.status in ('draft', 'pending_owner'));
  get diagnostics n = row_count;
  raise notice 'quotation part lines being prepared that follow their part: %', n;

  -- An estimate's own part lines being prepared: by their name.
  update public.quotation_lines l
     set unit = 'l'
   where l.line_type = 'part'
     and l.part_item_id is null
     and l.is_active
     and l.unit = 'pc'
     and l.title ~* fluid
     and l.title !~* not_fluid
     and exists (select 1 from public.quotations q where q.id = l.quotation_id and q.status in ('draft', 'pending_owner'));
  get diagnostics n = row_count;
  raise notice 'estimate part lines being prepared now in litres: %', n;
end $$;

notify pgrst, 'reload schema';
