-- 16 October 2026, sections G1 and H: workshop orders by type (stock parts, consumables, tools and equipment with the
-- fixed-asset flag for accounts), stock items as parts or consumables, the battery warranty period chosen per part,
-- the sticker sizes (part 40 × 30, battery and oil service 50 × 100 portrait), printer names and the WhatsApp booking
-- link behind the oil service sticker's QR.
alter table public.purchase_orders
  add column if not exists order_type text,
  add column if not exists fixed_asset boolean not null default false;
alter table public.purchase_orders drop constraint if exists purchase_orders_order_type_check;
alter table public.purchase_orders add constraint purchase_orders_order_type_check check (order_type is null or order_type in ('stock_parts', 'consumables', 'tools'));

alter table public.stock_items add column if not exists item_type text not null default 'part';
alter table public.stock_items drop constraint if exists stock_items_item_type_check;
alter table public.stock_items add constraint stock_items_item_type_check check (item_type in ('part', 'consumable'));

alter table public.part_items add column if not exists warranty_months integer;

insert into public.settings (key, value, label, description) values
  ('fixed_asset_threshold_aed', '2000'::jsonb, 'Fixed asset threshold (AED)', 'Tools and equipment orders at or above this amount are flagged for accounts as a fixed asset.'),
  ('sticker_battery_w_mm', '50'::jsonb, 'Battery sticker width (mm)', 'Portrait sticker, 50 × 100 mm by default.'),
  ('sticker_battery_h_mm', '100'::jsonb, 'Battery sticker height (mm)', 'Portrait sticker, 50 × 100 mm by default.'),
  ('sticker_service_w_mm', '50'::jsonb, 'Oil service sticker width (mm)', 'Portrait sticker, 50 × 100 mm by default.'),
  ('sticker_service_h_mm', '100'::jsonb, 'Oil service sticker height (mm)', 'Portrait sticker, 50 × 100 mm by default.'),
  ('sticker_printer_part', '"Printer 1 (40 × 30 mm)"'::jsonb, 'Printer for part stickers', 'Shown on the print page so the right printer is picked.'),
  ('sticker_printer_large', '"Printer 2 (50 × 100 mm)"'::jsonb, 'Printer for battery and service stickers', 'Shown on the print page so the right printer is picked.'),
  ('sticker_service_whatsapp_number', '""'::jsonb, 'WhatsApp number behind the service sticker QR', 'The number the customer reaches when scanning the oil service sticker; empty uses the company phone.'),
  ('sticker_service_whatsapp_text', '"Hi, I''d like to book a service for [PLATE]"'::jsonb, 'WhatsApp message behind the service sticker QR', '[PLATE] is replaced by the car''s plate.')
on conflict (key) do nothing;

-- The part sticker is now 40 × 30 mm: rows still at the old standard 20 × 20 move with it.
update public.settings set value = '40'::jsonb where key = 'sticker_part_width_mm' and value::text in ('20', '"20"');
update public.settings set value = '30'::jsonb where key = 'sticker_part_height_mm' and value::text in ('20', '"20"');
