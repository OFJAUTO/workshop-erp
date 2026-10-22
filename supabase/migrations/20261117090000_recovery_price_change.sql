-- Overnight batch 22 to 23 October 2026, section 3: change the price of a claimed or queried recovery trip.
-- The driver's own figure is kept (original_price_aed) and every change is written in price_history
-- ({ from, to, reason, by, by_name, at }), so the page shows the original crossed out. price_aed stays the
-- FINAL price: monthly totals, statements and the Excel export read it as before.
alter table public.recovery_trips add column if not exists original_price_aed numeric(12,2);
alter table public.recovery_trips add column if not exists price_history jsonb not null default '[]'::jsonb;

-- The normal rate per kind of truck (minimum per trip and AED per km, one way from the workshop), and how far
-- above the expected price a claim is flagged.
insert into public.settings (key, label, value) values
  ('recovery_rates', 'Recovery normal rates (minimum per trip and AED per km)', jsonb_build_object(
    'ours', jsonb_build_object('min', 60, 'per_km', 4),
    'flatbed', jsonb_build_object('min', 80, 'per_km', 6.5),
    'closed_box', jsonb_build_object('min', 150, 'per_km', 10))),
  ('recovery_flag_percent', 'Recovery: flag a trip this many % above the expected price', to_jsonb(25))
on conflict (key) do nothing;

notify pgrst, 'reload schema';
