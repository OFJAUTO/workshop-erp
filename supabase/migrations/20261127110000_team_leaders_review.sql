-- B2 review (28 October 2026): the two new tables get the stamp trigger every business table has, and the
-- recovery truck costs (settings.recovery_types) join the settings a team leader's login cannot read.
create trigger bodyshop_problems_stamp before insert or update on public.bodyshop_problems for each row execute function set_audit_columns();
create trigger ceramic_usage_stamp before insert or update on public.ceramic_usage for each row execute function set_audit_columns();

drop policy if exists settings_no_team_leader_money on public.settings;
create policy settings_no_team_leader_money on public.settings as restrictive for select to authenticated
  using (not public.has_role('team_leader') or not (key ~* '(price|cost|rate|aed|profit|margin|markup|discount|commission|bonus|target|charge|fee|salary|recovery_rates|recovery_types|film_types|package)'));

notify pgrst, 'reload schema';
