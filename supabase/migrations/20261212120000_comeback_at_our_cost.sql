-- COMEBACK AT OUR COST (10 November 2026, Section 9). A car back because of our mistake: marked on the job card with a
-- compulsory reason (what went wrong, who did the original work) and the ORIGINAL job (from this car's earlier jobs by
-- VIN), or "original job not in the ERP" with the old invoice number; the owner approves. Its cost comes off the
-- original job's profit and its advisor bonus by default (the owner can switch that off per comeback).

alter table public.jobs add column if not exists comeback_reason text;
alter table public.jobs add column if not exists comeback_original_ref text;
alter table public.jobs add column if not exists comeback_deduct_original boolean not null default true;
alter table public.jobs add column if not exists comeback_marked_by uuid references public.staff(id);
alter table public.jobs add column if not exists comeback_marked_at timestamptz;

-- The login reads jobs column by column (customer privacy, 29 October 2026): the new columns are granted on their own.
grant select (comeback_reason, comeback_original_ref, comeback_deduct_original, comeback_marked_by, comeback_marked_at) on public.jobs to authenticated;

-- VAT on a warranty repair: "no_vat" (default, the free lines carry no VAT) until accounts confirm.
insert into public.settings (key, label, value) values
  ('comeback_vat_mode', 'Comeback at our cost: VAT handling (no_vat = warranty repair, no VAT)', to_jsonb('no_vat'::text))
on conflict (key) do nothing;

notify pgrst, 'reload schema';
