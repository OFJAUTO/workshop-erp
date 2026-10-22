-- Evening batch of 21 October 2026, section 7: the package cost estimate.
-- The owner can set the film rolls for ONE job (big cars default to 1.5 through Settings); the estimate
-- itself is worked out in code from Settings. The live bodyshop labour rate row was empty: it becomes
-- the agreed AED 50. No new tables: no RLS or grant changes needed.

alter table public.quotations add column if not exists film_rolls_est numeric(4,1);

update public.settings set value = to_jsonb(50) where key = 'bodyshop_cost_rate_aed' and (value::text = '""' or value::text = '" "' or value::text = '0');
