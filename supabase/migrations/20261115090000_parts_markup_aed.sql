-- 22 October 2026 (urgent): a part's markup as a percentage of the cost OR as a fixed amount in AED added on top of
-- the cost (cost 955.80 + AED 300 = selling 1,255.80); the selling price can also be typed and the markup is worked
-- out. No upper limit for now (testing): the percent column stopped at 9,999.99%, so it is widened, and it carries six
-- decimals so a typed selling price lands exactly. The minimum (5%) stays, enforced by the save route.
-- No new table: no RLS or grant changes needed.

alter table public.quotation_lines add column if not exists markup_mode text not null default 'percent';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotation_lines_markup_mode_check') then
    alter table public.quotation_lines add constraint quotation_lines_markup_mode_check check (markup_mode in ('percent', 'aed'));
  end if;
end $$;
alter table public.quotation_lines add column if not exists markup_aed numeric(12,2);
alter table public.quotation_lines alter column markup_percent type numeric(14,6);

notify pgrst, 'reload schema';
