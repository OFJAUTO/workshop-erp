-- "Clear test data": one function the owner's button calls during the testing phase. It empties every
-- table that holds jobs, cars, customers and what hangs off them, zeroes the stock, and restarts the
-- numbering so the next job is J-00001. Staff, settings, lists, suppliers, devices and the system's own
-- change log are untouched. Runs as the database owner so the no-delete triggers step aside for it.

create or replace function public.clear_test_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  n bigint;
  counts jsonb := '{}'::jsonb;
  tables text[] := array[
    'work_pauses', 'work_sessions', 'work_lines', 'job_technicians', 'part_handovers', 'stock_issues',
    'purchase_order_lines', 'purchase_orders', 'part_items', 'part_requests', 'additional_work',
    'qc_checks', 'washes', 'payments', 'invoice_lines', 'invoices', 'quotation_lines', 'quotation_events',
    'quotations', 'declined_work', 'inspection_change_requests', 'inspection_media', 'inspection_findings',
    'inspection_items', 'inspections', 'road_tests', 'report_links', 'approval_requests', 'gate_in_media',
    'upload_links', 'gate_outs', 'gate_ins', 'job_requests', 'job_files', 'job_events', 'move_requests',
    'inbound_scans', 'quick_codes', 'notifications', 'appointments', 'shifts', 'jobs', 'vehicle_photos',
    'vehicles', 'customer_contacts', 'customers'
  ];
begin
  -- The no-delete and change-log triggers are skipped for this one transaction.
  perform set_config('session_replication_role', 'replica', true);
  foreach t in array tables loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('select count(*) from public.%I', t) into n;
      execute format('delete from public.%I', t);
      counts := counts || jsonb_build_object(t, n);
    end if;
  end loop;
  update public.stock_items set quantity = 0;
  -- The numbering starts again.
  alter sequence public.customer_number_seq restart with 1;
  alter sequence public.job_number_seq restart with 1;
  alter sequence public.quotation_number_seq restart with 1;
  alter sequence public.estimate_number_seq restart with 1;
  alter sequence public.po_number_seq restart with 1;
  alter sequence public.invoice_number_seq restart with 1;
  alter sequence public.proforma_number_seq restart with 1;
  alter sequence public.credit_note_number_seq restart with 1;
  alter sequence public.receipt_number_seq restart with 1;
  update public.settings set value = '1'::jsonb where key = 'next_invoice_number';
  return counts;
end $$;
revoke all on function public.clear_test_data() from public, anon, authenticated;

-- Backups the button makes before it clears anything (private; the owner's key only).
insert into storage.buckets (id, name, public, file_size_limit) values ('backups', 'backups', false, 524288000) on conflict (id) do nothing;

-- The button exists while this is on; switch it off at go-live.
insert into public.settings (key, value, label, description) values
  ('test_mode_enabled', 'true'::jsonb, 'Testing phase', 'While on, Settings shows the owner''s "Clear test data" button. Switch off at go-live.')
on conflict (key) do nothing;

-- The table list the backup needs, readable with the service key only.
create or replace function public.list_public_tables()
returns table (table_name text)
language sql
stable
security definer
set search_path = public
as $$
  select t.table_name::text from information_schema.tables t where t.table_schema = 'public' and t.table_type = 'BASE TABLE' order by t.table_name
$$;
revoke all on function public.list_public_tables() from public, anon, authenticated;
