-- 23 October 2026: the gate-in role sees only what gate-in needs. Past declined work carries amounts (money), and the
-- gate-in screens read it through the server only, so the gate-in role can no longer read it with its own login.
drop policy if exists declined_work_read on public.declined_work;
create policy declined_work_read on public.declined_work for select to authenticated
  using (not has_role('technician', 'gate_in'));
