-- The clear-out, with every update carrying a WHERE clause (the API connection refuses updates without one).

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
  present text[] := array[]::text[];
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
  foreach t in array tables loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('select count(*) from public.%I', t) into n;
      counts := counts || jsonb_build_object(t, n);
      present := present || t;
    end if;
  end loop;
  execute 'truncate table ' || (select string_agg(format('public.%I', x), ', ') from unnest(present) as x);
  update public.stock_items set quantity = 0 where quantity <> 0;
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
