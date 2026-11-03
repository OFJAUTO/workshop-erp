-- THE CHARGES SECTION SHOWS THE QUOTATION'S CHARGES (3 November 2026, section 8; J-00969, Q-00039).
--
-- The job card's Charges section now lists every recovery, fuel and other charge of the car, also the ones typed on a
-- quotation ("RECOVERY, FULL DOWN, TWO WAYS · AED 400.00 · on Q-00039 · approved"), read-only. The REAL cost of such a
-- quotation charge (from the supplier's bill) and the supplier are typed on the job card. An approved quotation's lines
-- are locked (erp_lock_quotation_lines) and their cost is the quoted ESTIMATE, so the real cost is kept on the charge
-- side: one charge_lines row per quotation charge, origin 'quotation', keyed to the line's FIRST version
-- (quotation_line_id), so it follows every revision. Every existing row is a charge typed on the job card or a pending
-- charge (origin 'charge'). The bill itself is a job file tied to the same first-version line id.
--
-- charge_lines stays server-only (RLS on, no policies, no grants to anon or authenticated): nothing to grant here.
-- No existing row changes: every row takes the default 'charge'.

alter table public.charge_lines add column if not exists origin text not null default 'charge';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'charge_lines_origin_check') then
    alter table public.charge_lines add constraint charge_lines_origin_check check (origin in ('charge', 'quotation'));
  end if;
  -- A quotation charge's cost row always belongs to a job and to a quotation line.
  if not exists (select 1 from pg_constraint where conname = 'charge_lines_quote_cost_home') then
    alter table public.charge_lines add constraint charge_lines_quote_cost_home check (origin <> 'quotation' or (job_id is not null and quotation_line_id is not null and entry_id is null));
  end if;
end $$;

-- One cost row per quotation charge: a repeated save updates it, never makes a second.
create unique index if not exists charge_lines_quote_cost_one on public.charge_lines (quotation_line_id) where origin = 'quotation' and is_active;

-- Readers of the job's charges skip the cost rows (they decorate the quotation's line instead).
create index if not exists charge_lines_job_origin_idx on public.charge_lines (job_id, origin) where is_active;

revoke all on public.charge_lines from anon, authenticated;
grant all on public.charge_lines to service_role;

notify pgrst, 'reload schema';
