-- 18 October 2026, 5: the quote's profit colours and the low-profit warning.
insert into public.settings (key, value, label, description) values
  ('quote_margin_yellow_percent', '30'::jsonb, 'Quote margin: yellow below (%)', 'A quotation''s profit shows yellow below this margin.'),
  ('quote_margin_red_percent', '20'::jsonb, 'Quote margin: red below (%)', 'A quotation''s profit shows red below this margin; completing a red quote asks "Are you sure?" and the owner is told when it is sent anyway.')
on conflict (key) do nothing;
