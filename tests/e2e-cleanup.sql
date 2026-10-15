-- Removes every test row made by the e2e routes (fixed ids 22222222-0000-4000-8000-00000000e2xx and e3xx). Bypasses the no-delete triggers.
set session_replication_role = replica;
do $$
declare
  job_ids uuid[];
  cust_ids uuid[];
  veh_ids uuid[];
  t text;
begin
  select coalesce(array_agg(id), '{}') into cust_ids from public.customers where id::text like '22222222-0000-4000-8000-00000000e%';
  select coalesce(array_agg(id), '{}') into veh_ids from public.vehicles where id::text like '22222222-0000-4000-8000-00000000e%' or customer_id = any(cust_ids);
  select coalesce(array_agg(id), '{}') into job_ids from public.jobs where id::text like '22222222-0000-4000-8000-00000000e%' or customer_id = any(cust_ids) or vehicle_id = any(veh_ids);
  delete from public.bodyshop_clockings where job_id = any(job_ids);
  delete from public.bodyshop_assignments where job_id = any(job_ids);
  delete from public.bodyshop_signoffs where job_id = any(job_ids);
  delete from public.bodyshop_removed_items where job_id = any(job_ids);
  delete from public.bodyshop_updates where job_id = any(job_ids);
  delete from public.bodyshop_stages where job_id = any(job_ids);
  update public.jobs set final_check_appointment_id = null, bodyshop_after_photo_id = null where id = any(job_ids);
  delete from public.quotation_lines where quotation_id in (select id from public.quotations where job_id = any(job_ids) or customer_id = any(cust_ids) or vehicle_id = any(veh_ids));
  delete from public.quotation_events where quotation_id in (select id from public.quotations where job_id = any(job_ids) or customer_id = any(cust_ids) or vehicle_id = any(veh_ids));
  delete from public.quotations where job_id is null and (customer_id = any(cust_ids) or vehicle_id = any(veh_ids));
  delete from public.invoice_lines where invoice_id in (select id from public.invoices where job_id = any(job_ids));
  delete from public.payments where invoice_id in (select id from public.invoices where job_id = any(job_ids)) or job_id = any(job_ids);
  update public.invoices set converted_to = null, converted_from = null where job_id = any(job_ids);
  delete from public.inspection_items where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_findings where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_media where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_change_requests where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.purchase_order_lines where po_id in (select id from public.purchase_orders where job_id = any(job_ids));
  delete from public.price_import_lines where import_id in (select id from public.price_imports where job_id = any(job_ids));
  for t in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'job_id' and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') and table_name <> 'jobs' loop
    execute format('delete from public.%I where job_id = any($1)', t) using job_ids;
  end loop;
  delete from public.notifications where job_id = any(job_ids);
  delete from public.audit_log where (new_data->>'job_id') = any(job_ids::text[]) or (old_data->>'job_id') = any(job_ids::text[]) or (new_data->>'id') = any(job_ids::text[]) or (old_data->>'id') = any(job_ids::text[]) or record_id = any(job_ids::text[]);
  delete from public.jobs where id = any(job_ids);
  delete from public.declined_work where vehicle_id = any(veh_ids);
  delete from public.vehicles where id = any(veh_ids);
  delete from public.customers where id = any(cust_ids);
end $$;
set session_replication_role = default;
select count(*) as left_over from public.jobs where id::text like '22222222-0000-4000-8000-00000000e%';
-- Rows made through the screens during the tests (customers with a test phone number), and test emails.
set session_replication_role = replica;
do $$
declare
  job_ids uuid[];
  cust_ids uuid[];
  veh_ids uuid[];
  t text;
begin
  select coalesce(array_agg(id), '{}') into cust_ids from public.customers where phone like '+9715000000%' or full_name ilike 'e2e %';
  select coalesce(array_agg(id), '{}') into veh_ids from public.vehicles where customer_id = any(cust_ids);
  select coalesce(array_agg(id), '{}') into job_ids from public.jobs where customer_id = any(cust_ids) or vehicle_id = any(veh_ids);
  delete from public.bodyshop_clockings where job_id = any(job_ids);
  delete from public.bodyshop_assignments where job_id = any(job_ids);
  delete from public.bodyshop_signoffs where job_id = any(job_ids);
  delete from public.bodyshop_removed_items where job_id = any(job_ids);
  delete from public.bodyshop_updates where job_id = any(job_ids);
  delete from public.bodyshop_stages where job_id = any(job_ids);
  update public.jobs set final_check_appointment_id = null, bodyshop_after_photo_id = null where id = any(job_ids);
  delete from public.quotation_lines where quotation_id in (select id from public.quotations where job_id = any(job_ids) or customer_id = any(cust_ids) or vehicle_id = any(veh_ids));
  delete from public.quotation_events where quotation_id in (select id from public.quotations where job_id = any(job_ids) or customer_id = any(cust_ids) or vehicle_id = any(veh_ids));
  delete from public.quotations where job_id is null and (customer_id = any(cust_ids) or vehicle_id = any(veh_ids));
  delete from public.invoice_lines where invoice_id in (select id from public.invoices where job_id = any(job_ids));
  delete from public.payments where invoice_id in (select id from public.invoices where job_id = any(job_ids)) or job_id = any(job_ids);
  update public.invoices set converted_to = null, converted_from = null where job_id = any(job_ids);
  delete from public.inspection_items where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_findings where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_media where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_change_requests where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.purchase_order_lines where po_id in (select id from public.purchase_orders where job_id = any(job_ids));
  delete from public.price_import_lines where import_id in (select id from public.price_imports where job_id = any(job_ids));
  update public.job_items set qr_code = null where job_id = any(job_ids);
  for t in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'job_id' and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') and table_name <> 'jobs' loop
    execute format('delete from public.%I where job_id = any($1)', t) using job_ids;
  end loop;
  delete from public.notifications where job_id = any(job_ids);
  delete from public.audit_log where (new_data->>'job_id') = any(job_ids::text[]) or (old_data->>'job_id') = any(job_ids::text[]) or (new_data->>'id') = any(job_ids::text[]) or (old_data->>'id') = any(job_ids::text[]) or record_id = any(job_ids::text[]);
  delete from public.jobs where id = any(job_ids);
  delete from public.declined_work where vehicle_id = any(veh_ids);
  delete from public.qr_links where vehicle_id = any(veh_ids);
  delete from public.appointments where customer_id = any(cust_ids);
  delete from public.vehicles where id = any(veh_ids);
  delete from public.customer_contacts where customer_id = any(cust_ids);
  delete from public.customers where id = any(cust_ids);
  delete from public.inbound_emails where from_email like 'e2e%' or subject like 'e2e %';
end $$;
set session_replication_role = default;
select count(*) as left_over_ui from public.customers where phone like '+9715000000%';
-- Test services and the test customer's leftovers.
set session_replication_role = replica;
delete from public.quotation_lines where service_id in (select id from public.services where name ilike 'e2e %');
delete from public.services where name ilike 'e2e %';
delete from public.vehicle_models where name ilike 'e2e %' and not exists (select 1 from public.vehicles where model_id = vehicle_models.id);
delete from public.supplier_discount_changes where supplier_id in (select id from public.suppliers where name ilike 'e2e %');
delete from public.suppliers where name ilike 'e2e %' and not exists (select 1 from public.purchase_orders where supplier_id = suppliers.id);
delete from public.service_categories where name ilike 'e2e %';
delete from public.notifications where type in ('owner_report') and job_id is null;
set session_replication_role = default;
select count(*) as left_over_services from public.services where name ilike 'e2e %';

-- The bodyshop seed's people (team leaders and an installer made for the tests) and their logins.
set session_replication_role = replica;
do $$
declare sids uuid[];
begin
  select coalesce(array_agg(id), '{}') into sids from public.staff where display_name ilike 'E2e %';
  delete from public.notifications where staff_id = any(sids);
  delete from public.notification_preferences where staff_id = any(sids);
  delete from public.upload_failures where staff_id = any(sids);
  delete from public.bodyshop_clockings where staff_id = any(sids);
  delete from public.bodyshop_assignments where staff_id = any(sids);
  delete from public.bodyshop_signoffs where staff_id = any(sids);
  update public.devices set last_staff_id = null where last_staff_id = any(sids);
  delete from public.staff_private where staff_id = any(sids);
  delete from public.staff where id = any(sids);
  delete from auth.identities where identity_data->>'email' like 'e2e-%@ofj.test';
  delete from auth.users where email like 'e2e-%@ofj.test';
end $$;
-- Section tablets registered by the tests.
delete from public.devices where name ilike 'E2e %';
set session_replication_role = default;

-- Stock orders, stock items and the notifications the Part C tests make.
set session_replication_role = replica;
delete from public.stock_movements where stock_item_id in (select id from public.stock_items where name ilike 'e2e %') or po_id in (select id from public.purchase_orders where supplier_name ilike 'e2e %');
delete from public.purchase_order_lines where po_id in (select id from public.purchase_orders where supplier_name ilike 'e2e %');
delete from public.notifications where href like '/parts/orders/%' and href in (select '/parts/orders/' || id::text from public.purchase_orders where supplier_name ilike 'e2e %');
delete from public.purchase_orders where supplier_name ilike 'e2e %';
delete from public.notifications where title ilike '%e2e %' and type in ('stock_low', 'supplier_invoice_mismatch', 'po_approval', 'po_decided');
delete from public.stock_items where name ilike 'e2e %';
delete from public.suppliers where name ilike 'e2e %' and not exists (select 1 from public.purchase_orders where supplier_id = suppliers.id);
set session_replication_role = default;
select count(*) as left_over_stock from public.stock_items where name ilike 'e2e %';
