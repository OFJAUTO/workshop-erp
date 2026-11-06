-- Section 9 (6 November 2026): the gate-in login's own database access reads no customer, contact or check-in link
-- and no money setting, and writes none of them. The gate-in screens read and write those rows through the server's
-- key after their own permission check (name and mobile only, on the gate-in form), so nothing on screen changes.
-- Found by the gate-in role check (tests/browser/test-gatein-role.mjs): before this, a gate-in login could read all
-- customers' details and the money settings, and change another customer's phone, straight through the database API.

do $$
declare t text;
begin
  foreach t in array array['customers', 'customer_contacts', 'approval_requests'] loop
    execute format('drop policy if exists %I on public.%I', t || '_no_gate_in', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (not public.has_role(''gate_in'')) with check (not public.has_role(''gate_in''))', t || '_no_gate_in', t);
  end loop;
end $$;

drop policy if exists settings_no_gate_in_money on public.settings;
create policy settings_no_gate_in_money on public.settings as restrictive for select to authenticated
  using (not public.has_role('gate_in') or not (key ~* '(price|cost|rate|aed|profit|margin|markup|discount|commission|bonus|target|charge|fee|salary|recovery_rates|film_types|package)'));

notify pgrst, 'reload schema';
