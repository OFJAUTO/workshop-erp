-- Section 6 (23 October 2026): the A/C gas item's leak answer "No" and its own repairs (condenser, compressor,
-- evaporator, expansion valve) join the allowed values.
alter table public.inspection_items drop constraint if exists inspection_items_leak_severity_check;
alter table public.inspection_items add constraint inspection_items_leak_severity_check
  check (leak_severity is null or leak_severity in ('none', 'sweating', 'dripping', 'heavy'));
alter table public.inspection_items drop constraint if exists inspection_items_leak_repair_check;
alter table public.inspection_items add constraint inspection_items_leak_repair_check
  check (leak_repair is null or leak_repair in ('gasket', 'seal', 'reseal', 'hose', 'replace', 'condenser', 'compressor', 'evaporator', 'expansion_valve'));
