-- ENTER PRICE MYSELF on a JOB's part (5 November 2026): the owner or an advisor types the cost they
-- already have (a dealer on the phone) straight onto the part, like an estimate's "Priced by advisor".
-- The parts desk sees who priced it and can mark "Price is right" when they look later.
alter table public.part_items add column if not exists priced_by_advisor boolean not null default false;
alter table public.part_items add column if not exists price_checked_at timestamptz;
alter table public.part_items add column if not exists price_checked_by uuid references public.staff(id);

notify pgrst, 'reload schema';
