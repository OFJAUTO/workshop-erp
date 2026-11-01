-- Departments per line (1 November 2026, J-00969). Each line of work has a team: Mechanical, Electrical (programming,
-- coding, resets), Dismantle & refit, Paint, PPF, Detailing & cleaning, or Outside work (another company, e.g. PDR).
-- Empty = the default the code works out from the service and the line's words (src/lib/line-teams.ts). The team is
-- who does the work, not money, so it may change on an approved quotation; the line lock lets it through.

alter table public.quotation_lines
  add column if not exists team text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotation_lines_team_check') then
    alter table public.quotation_lines add constraint quotation_lines_team_check
      check (team is null or team in ('mechanical', 'electrical', 'dismantle_refit', 'paint', 'ppf', 'detailing', 'outside'));
  end if;
end $$;

comment on column public.quotation_lines.team is 'Who does this line: mechanical, electrical, dismantle_refit, paint, ppf, detailing or outside. Null = the default from the service and the words (1 Nov 2026).';

-- The line lock (approved or superseded quotations): the team may change, nothing else.
create or replace function public.erp_lock_quotation_lines()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    if public.erp_quote_locked_status(old.quotation_id) then
      raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; its lines cannot be deleted. Make a new version.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if public.erp_quote_locked_status(new.quotation_id) then
      raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; lines cannot be added. Make a new version.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if public.erp_quote_locked_status(old.quotation_id) or public.erp_quote_locked_status(new.quotation_id) then
    v_old := to_jsonb(old) - 'updated_at' - 'updated_by' - 'line_total' - 'customer_approved' - 'price_checked_at' - 'price_checked_by' - 'team';
    v_new := to_jsonb(new) - 'updated_at' - 'updated_by' - 'line_total' - 'customer_approved' - 'price_checked_at' - 'price_checked_by' - 'team';
    if v_old is distinct from v_new then
      raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; its lines cannot be changed. Make a new version.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- J-00969 (MERCEDES-BENZ S 580, Q-00039): bodywork, paint and coding on a car gated in as mechanical. Department Both
-- (it already was), each line on its team. PDR goes to Outside work; the advisor can move it to the bodyshop.
-- Live only: on any other database these lines do not exist and nothing happens.
do $$
declare
  v_job uuid := 'ae4e1371-f50a-425f-8406-48a28070baaa';
  v_owner uuid;
  v_n int := 0;
begin
  if not exists (select 1 from public.jobs where id = v_job) then return; end if;
  select id into v_owner from public.staff where role_id = 'owner' and is_active order by created_at limit 1;
  update public.jobs set department = 'both', updated_by = v_owner where id = v_job and department is distinct from 'both';
  update public.quotation_lines set team = 'paint', updated_by = v_owner where id in ('fb873f0a-2e0c-4d5b-848d-a3c7cdb52150', 'fe2707fb-84fb-402e-90fc-6fffaca14721') and team is null;
  get diagnostics v_n = row_count;
  update public.quotation_lines set team = 'outside', updated_by = v_owner where id = 'd0f2dee3-5b6c-47a3-9962-8f9a4258dba4' and team is null;
  update public.quotation_lines set team = 'dismantle_refit', updated_by = v_owner where id = '486c3bfa-1fa4-443c-a18e-6e04e76b5b87' and team is null;
  update public.quotation_lines set team = 'electrical', updated_by = v_owner where id = 'f892cf68-6dfd-4d77-b5a8-fa23cb391e5f' and team is null;
  if v_n > 0 then
    insert into public.job_events (job_id, event_type, note, created_by)
      values (v_job, 'line_team', 'Department Both; teams set (1 November 2026): paint lines → Paint, remove and refit → Dismantle & refit, programming and coding → Electrical, PDR → Outside work (the advisor can move it to the bodyshop).', v_owner);
  end if;
end $$;

notify pgrst, 'reload schema';
