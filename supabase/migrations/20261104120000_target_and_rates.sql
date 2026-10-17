-- 17 October 2026, F: the owner's target box and the monthly labour rate check.
insert into public.settings (key, value, label, description) values
  ('monthly_fixed_costs_aed', '380000'::jsonb, 'Monthly fixed costs (AED)',
   'The break-even line of the owner''s target box. Don''t include technicians'' pay here if it''s already charged as labour cost on jobs.'),
  ('labour_cost_actuals', '{}'::jsonb, 'Labour cost actuals',
   'Typed by accounts each month on the labour rate check: the technicians'' all-in cost per side.')
on conflict (key) do nothing;
