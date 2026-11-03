-- "Pricing done – send to advisor" on an estimate (section 10 of 2 November 2026, built 3 November).
--
-- A job already keeps its send on jobs.parts_pricing_done_at; an estimate has no job yet, so the send is kept on the
-- estimate itself: when the parts desk pressed the button and who. The estimate then leaves the parts desk's to-do
-- list (and Parts' "Waiting on you"); a part the advisor sends to the desk afterwards, or a price changed after it,
-- puts it back (the line's own stamps are newer than the send). The advisor hears it ONCE ("All parts priced on
-- E-00058") instead of once per part.
--
-- Plain columns on public.quotations, which keeps its RLS, policies and grants (no column grant needed). The
-- approved-quote lock (quotations_lock) freezes money and header choices only; these two are written while an estimate
-- is being prepared (draft or waiting for the owner).

alter table public.quotations add column if not exists parts_priced_at timestamptz;
alter table public.quotations add column if not exists parts_priced_by uuid references public.staff (id);
comment on column public.quotations.parts_priced_at is 'An estimate: when the parts desk pressed "Pricing done – send to advisor" (3 November 2026).';
comment on column public.quotations.parts_priced_by is 'An estimate: who pressed "Pricing done – send to advisor".';

notify pgrst, 'reload schema';
