-- Batch 29 October 2026 (2), section 1: customer details are for the owner, the advisors and accounts only (and the
-- gate-in role on the gate-in form). The screens already show the car only to everyone else; this makes the DATABASE
-- refuse it too, so nothing personal reaches a workshop tablet through the API or the live feed.
-- Apply AFTER the code that stops reading these columns as the logged-in user is live (the job card, the calendar).

-- 1. Approval requests (who the job card went to, who approved it, their phone): owner, advisors, accounts and the
--    gate-in role. Workshop managers, Parts, QC, technicians and team leaders read none.
drop policy if exists approval_requests_customer_roles_only on public.approval_requests;
create policy approval_requests_customer_roles_only on public.approval_requests
  as restrictive for select to authenticated
  using (public.has_role('owner', 'service_advisor', 'accounts', 'gate_in'));

-- 2. Personal columns the login role may not read at all (any role): the pickup address at gate-in, who brought loose
--    items, the stored owner report (customer and money), the collector at gate-out, the collector of a loose item and a
--    booking's collection address. The server reads them with the master key for the customer roles only.
--    Every other column stays readable exactly as before. A NEW column on these five tables needs its own
--    `grant select (col) on public.<table> to authenticated` in its migration (test:security lists these tables).
do $$
declare
  t record;
  cols text;
begin
  for t in
    select * from (values
      ('gate_ins', array['location_name', 'location_address', 'location_lat', 'location_lng']),
      ('jobs', array['brought_by', 'owner_report']),
      ('gate_outs', array['collector_name', 'collector_phone', 'delivered_to', 'delivery_address']),
      ('job_items', array['collector_name']),
      ('appointments', array['collect_address'])
    ) as x(tbl, hidden)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = t.tbl and column_name <> all (t.hidden);
    execute format('revoke select on public.%I from authenticated', t.tbl);
    execute format('grant select (%s) on public.%I to authenticated', cols, t.tbl);
  end loop;
end $$;

notify pgrst, 'reload schema';
