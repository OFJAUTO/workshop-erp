-- Section 8 (21 October 2026): the inspection fee is chosen per car at gate-in.
-- 750 / 1,000 / 1,500 / 2,000 or typed; premium brands default higher; lowering below 750 or waiving
-- needs the owner (stored as a request he approves); locked once the customer approves the job card.
alter table public.jobs add column if not exists inspection_fee_aed numeric(10, 2);
alter table public.jobs add column if not exists inspection_fee_request_aed numeric(10, 2);
alter table public.jobs add column if not exists inspection_fee_request_by uuid references public.staff(id);

insert into public.settings (key, value, label) values
  ('premium_brands', '["Lamborghini", "Ferrari", "Rolls-Royce", "McLaren", "Bentley", "Bugatti", "Aston Martin"]'::jsonb, 'Premium brands (higher inspection fee)')
  on conflict (key) do nothing;
insert into public.settings (key, value, label) values
  ('premium_brand_fee_aed', to_jsonb(1500), 'Inspection fee for premium brands (AED)')
  on conflict (key) do nothing;

notify pgrst, 'reload schema';
