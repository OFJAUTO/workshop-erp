-- Evening batch of 21 October 2026, section 10: the PPF cutting method on the line it belongs to.
-- hand = bespoke hand-cut (the default and the recommendation), machine = computer pre-cut, mixed = both
-- with a short note. Copied to the next version, to the invoice line, and approved with the quotation
-- (the approved-quote lock already freezes every line column it does not list as an exception).
-- Optional hand-cut surcharge in Settings, default 0. No new table: no RLS or grant changes needed.

alter table public.quotation_lines add column if not exists cut_method text check (cut_method is null or cut_method in ('hand', 'machine', 'mixed'));
alter table public.quotation_lines add column if not exists cut_note text;
alter table public.invoice_lines add column if not exists cut_method text check (cut_method is null or cut_method in ('hand', 'machine', 'mixed'));
alter table public.invoice_lines add column if not exists cut_note text;

insert into public.settings (key, label, value)
  values ('ppf_handcut_surcharge_aed', 'PPF: bespoke hand-cut surcharge (AED, 0 = none)', to_jsonb(0))
  on conflict (key) do nothing;

notify pgrst, 'reload schema';
