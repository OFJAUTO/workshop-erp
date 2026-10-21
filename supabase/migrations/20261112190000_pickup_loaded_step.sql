-- Section 7 (21 October 2026): pick-ups run the same procedure as deliveries. The driver's page gets
-- a first step for pick-ups - "Car loaded" with a photo - before "Delivered to OFJ" with the price.
alter table public.recovery_trips add column if not exists loaded_photo_path text;
notify pgrst, 'reload schema';
