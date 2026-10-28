-- B3 (28 October 2026): who gave the labour discount, and when - the owner's discount needs no approval, an
-- advisor's is named on the screen and in the owner's box.
alter table public.quotations
  add column if not exists discount_set_by uuid references public.staff(id),
  add column if not exists discount_set_at timestamptz;
notify pgrst, 'reload schema';
