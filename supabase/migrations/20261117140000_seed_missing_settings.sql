-- 23 October 2026 (found while testing section 5): 17 settings existed only as defaults in the code, with no stored
-- row. The app read the defaults fine, but the Settings page showed four of them empty and refused to save
-- ("Please fill this in"), and a change to any of them was silently dropped (the save updates stored rows only).
-- Each gets its stored row with the same default the code already used; nothing changes in behaviour.
insert into public.settings (key, label, value) values
  ('tint_cars_per_roll', 'Tint: cars per roll', to_jsonb(10)),
  ('ceramic_bottle_price_aed', 'Ceramic: bottle price (AED)', to_jsonb(300)),
  ('ceramic_cars_exterior_per_bottle', 'Ceramic: cars per bottle (exterior)', to_jsonb(4)),
  ('ceramic_cars_interior_per_bottle', 'Ceramic: cars per bottle (interior)', to_jsonb(5.5)),
  ('package_installer_hours', 'Packages: installer hours per month', to_jsonb(80)),
  ('big_car_film_rolls', 'PPF: film rolls for a big car', to_jsonb(1.5)),
  ('big_car_models', 'PPF: big car models', '["G-Class", "Cullinan", "Urus", "Escalade", "Range Rover LWB", "GLS", "Phantom"]'::jsonb),
  ('whatsapp_aftercare_template', 'WhatsApp: after-care check', to_jsonb('Good day! Your car is due for its complimentary 10-day after-care check on [date]. It takes about half an hour - we check the film edges and polish anything that needs it. When would suit you?'::text)),
  ('payment_waiting_hours', 'Payment waiting long after (hours)', to_jsonb(24)),
  ('supplier_lpo_from_email', 'Supplier LPO email: from', to_jsonb('peter@ofjauto.com'::text)),
  ('supplier_lpo_email_text', 'Supplier LPO email: text', to_jsonb(E'Dear [supplier],\n\nPlease find attached our purchase order [number]. Kindly confirm availability and the delivery date.\n\nThank you,\nOFJ Automotive, Parts'::text)),
  ('stock_count_reminded_for', 'Stock count reminded for (month)', to_jsonb(''::text)),
  ('payment_gateway_domains', 'Payment gateway domains', '["paypage.ngenius-payments.com", "paypage.sandbox.ngenius-payments.com"]'::jsonb),
  ('workshop_hours_text', 'Workshop hours (payment page)', to_jsonb('Monday to Saturday, 8:00–17:00'::text)),
  ('whatsapp_deposit_request_template', 'WhatsApp: deposit request', to_jsonb(E'Dear [name],\n\nTo order the parts for your *[make model]* ([plate]), an advance payment of *AED [amount]* is required.\n\nPay here:\n[link]\n\nOFJ Automotive'::text)),
  ('order_now_amber_minutes', 'Order-now amber (minutes)', to_jsonb(30)),
  ('order_now_red_minutes', 'Order-now red (minutes)', to_jsonb(60))
on conflict (key) do nothing;
