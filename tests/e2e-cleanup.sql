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
  delete from public.bodyshop_problems where job_id = any(job_ids);
  delete from public.ceramic_usage where job_id = any(job_ids);
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
  delete from public.zoho_outbox where job_id = any(job_ids) or record_id = any(cust_ids) or record_id in (select id from public.invoices where job_id = any(job_ids)) or record_id in (select id from public.payments where job_id = any(job_ids) or customer_id = any(cust_ids) or invoice_id in (select id from public.invoices where job_id = any(job_ids))) or record_id in (select id from public.suppliers where name ilike 'e2e %') or record_id in (select id from public.purchase_orders where supplier_name ilike 'e2e %' or number like 'LPO-E2E%' or job_id = any(job_ids)) or record_id in (select id from public.commission_payments where recipient ilike 'e2e %') or record_id in (select id from public.recovery_payouts where who ilike 'e2e %');
  delete from public.zoho_outbox_archive where job_id = any(job_ids) or record_id = any(cust_ids) or record_id in (select id from public.invoices where job_id = any(job_ids)) or record_id in (select id from public.payments where job_id = any(job_ids) or customer_id = any(cust_ids) or invoice_id in (select id from public.invoices where job_id = any(job_ids))) or record_id in (select id from public.suppliers where name ilike 'e2e %') or record_id in (select id from public.purchase_orders where supplier_name ilike 'e2e %' or number like 'LPO-E2E%' or job_id = any(job_ids)) or record_id in (select id from public.commission_payments where recipient ilike 'e2e %') or record_id in (select id from public.recovery_payouts where who ilike 'e2e %');
  delete from public.zoho_outbox where kind = 'settlement' and record_id in (select id from public.card_settlements where statement_ref ilike 'e2e%');
  update public.payments set settlement_id = null, actual_fee_aed = null, actual_msf_aed = null, actual_txn_fee_aed = null, actual_vat_aed = null where settlement_id in (select id from public.card_settlements where statement_ref ilike 'e2e%');
  delete from public.card_settlements where statement_ref ilike 'e2e%';
  delete from public.invoice_lines where invoice_id in (select id from public.invoices where job_id = any(job_ids));
  delete from public.payments where invoice_id in (select id from public.invoices where job_id = any(job_ids)) or job_id = any(job_ids) or customer_id = any(cust_ids);
  update public.invoices set converted_to = null, converted_from = null where job_id = any(job_ids);
  delete from public.inspection_items where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_findings where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_media where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_change_requests where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.purchase_order_lines where po_id in (select id from public.purchase_orders where job_id = any(job_ids));
  delete from public.price_import_lines where import_id in (select id from public.price_imports where job_id = any(job_ids));
  delete from public.supplier_charges where job_id = any(job_ids);
  for t in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'job_id' and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') and table_name <> 'jobs' loop
    execute format('delete from public.%I where job_id = any($1)', t) using job_ids;
  end loop;
  delete from public.purchase_order_lines where po_id in (select id from public.purchase_orders where number like 'LPO-E2E-%');
  delete from public.purchase_orders where number like 'LPO-E2E-%';
  delete from public.recovery_trips where driver_name like 'E2e %' or location_details like 'E2e%';
  delete from public.recovery_drivers where name like 'E2e %';
  delete from public.inbound_scans where storage_path like 'e2e/%' or from_email like '%@e2e.test';
  update public.settings set value = coalesce((select jsonb_agg(x) from jsonb_array_elements_text(value) x where x not ilike 'e2e %'), '[]'::jsonb) where key = 'commission_people';
  delete from public.film_usage where roll_id in (select id from public.film_rolls where name ilike 'e2e %');
  delete from public.film_rolls where name ilike 'e2e %';
  update public.settings set value = coalesce((select jsonb_agg(x) from jsonb_array_elements(value) x where coalesce(x->>'name', '') not ilike 'e2e %'), '[]'::jsonb) where key = 'tint_presets' and jsonb_typeof(value) = 'array';
  update public.settings set value = coalesce((select jsonb_agg(x) from jsonb_array_elements_text(value) x where x not ilike 'e2e %'), '[]'::jsonb) where key = 'ceramic_products_used' and jsonb_typeof(value) = 'array';
  update public.quotations set commission_payment_id = null where commission_payment_id in (select id from public.commission_payments where recipient ilike 'e2e %');
  delete from public.commission_payments where recipient ilike 'e2e %';
  delete from public.notifications where job_id = any(job_ids);
  delete from public.audit_log where (new_data->>'job_id') = any(job_ids::text[]) or (old_data->>'job_id') = any(job_ids::text[]) or (new_data->>'id') = any(job_ids::text[]) or (old_data->>'id') = any(job_ids::text[]) or record_id = any(job_ids::text[]);
  delete from public.jobs where id = any(job_ids);
  delete from public.declined_work where vehicle_id = any(veh_ids);
  delete from public.vehicles where id = any(veh_ids);
  delete from public.customer_contacts where customer_id = any(cust_ids);
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
  delete from public.bodyshop_problems where job_id = any(job_ids);
  delete from public.ceramic_usage where job_id = any(job_ids);
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
  delete from public.zoho_outbox where job_id = any(job_ids) or record_id = any(cust_ids) or record_id in (select id from public.invoices where job_id = any(job_ids)) or record_id in (select id from public.payments where job_id = any(job_ids) or customer_id = any(cust_ids) or invoice_id in (select id from public.invoices where job_id = any(job_ids))) or record_id in (select id from public.suppliers where name ilike 'e2e %') or record_id in (select id from public.purchase_orders where supplier_name ilike 'e2e %' or number like 'LPO-E2E%' or job_id = any(job_ids)) or record_id in (select id from public.commission_payments where recipient ilike 'e2e %') or record_id in (select id from public.recovery_payouts where who ilike 'e2e %');
  delete from public.zoho_outbox_archive where job_id = any(job_ids) or record_id = any(cust_ids) or record_id in (select id from public.invoices where job_id = any(job_ids)) or record_id in (select id from public.payments where job_id = any(job_ids) or customer_id = any(cust_ids) or invoice_id in (select id from public.invoices where job_id = any(job_ids))) or record_id in (select id from public.suppliers where name ilike 'e2e %') or record_id in (select id from public.purchase_orders where supplier_name ilike 'e2e %' or number like 'LPO-E2E%' or job_id = any(job_ids)) or record_id in (select id from public.commission_payments where recipient ilike 'e2e %') or record_id in (select id from public.recovery_payouts where who ilike 'e2e %');
  delete from public.zoho_outbox where kind = 'settlement' and record_id in (select id from public.card_settlements where statement_ref ilike 'e2e%');
  update public.payments set settlement_id = null, actual_fee_aed = null, actual_msf_aed = null, actual_txn_fee_aed = null, actual_vat_aed = null where settlement_id in (select id from public.card_settlements where statement_ref ilike 'e2e%');
  delete from public.card_settlements where statement_ref ilike 'e2e%';
  delete from public.invoice_lines where invoice_id in (select id from public.invoices where job_id = any(job_ids));
  delete from public.payments where invoice_id in (select id from public.invoices where job_id = any(job_ids)) or job_id = any(job_ids) or customer_id = any(cust_ids);
  update public.invoices set converted_to = null, converted_from = null where job_id = any(job_ids);
  delete from public.inspection_items where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_findings where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_media where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.inspection_change_requests where inspection_id in (select id from public.inspections where job_id = any(job_ids));
  delete from public.purchase_order_lines where po_id in (select id from public.purchase_orders where job_id = any(job_ids));
  delete from public.price_import_lines where import_id in (select id from public.price_imports where job_id = any(job_ids));
  delete from public.supplier_charges where job_id = any(job_ids);
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
  delete from public.customer_contacts where customer_id = any(cust_ids);
  delete from public.customers where id = any(cust_ids);
  delete from public.inbound_emails where from_email like 'e2e%' or subject like 'e2e %';
  delete from public.google_mailbox_tokens where mailbox like 'e2e%';
end $$;
set session_replication_role = default;
-- Services saved from a quotation during the tests.
set session_replication_role = replica;
delete from public.services where name ilike 'E2e custom job%';
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
  delete from public.bodyshop_problems where raised_by = any(sids) or answered_by = any(sids);
  delete from public.ceramic_usage where created_by = any(sids);
  update public.bodyshop_stages set handover_by = null where handover_by = any(sids);
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

-- Short links left behind by tests: anything marked e2e, and anything whose target row is gone.
delete from public.short_links where url ilike '%e2e%';
delete from public.short_links sl where sl.url like '%/quote/%' and not exists (select 1 from public.quotations q where q.token is not null and sl.url = 'https://erp.ofjauto.com/quote/' || q.token);
delete from public.short_links sl where sl.url like '%/proforma/%' and not exists (select 1 from public.invoices i where i.token is not null and sl.url = 'https://erp.ofjauto.com/proforma/' || i.token);
delete from public.short_links sl where sl.url like 'https://erp.ofjauto.com/invoice/%' and not exists (select 1 from public.invoices i where i.token is not null and sl.url = 'https://erp.ofjauto.com/invoice/' || i.token);
delete from public.short_links sl where sl.url like '%/report/%' and not exists (select 1 from public.report_links r where sl.url = 'https://erp.ofjauto.com/report/' || r.token);
delete from public.short_links sl where sl.url like '%/approve/%' and not exists (select 1 from public.approval_requests a where sl.url = 'https://erp.ofjauto.com/approve/' || a.token);
delete from public.short_links sl where sl.url like '%/drive/%' and not exists (select 1 from public.recovery_trips t where t.token is not null and sl.url = 'https://erp.ofjauto.com/drive/' || t.token);
delete from public.short_links sl where sl.url like '%/api/pdf/receipt/%' and not exists (select 1 from public.payments p where sl.url like '%/api/pdf/receipt/' || p.id || '%');
delete from public.short_links where url like '%25.1812,55.2807%'; -- the D test's fixed pin

-- Recovery rows made by the 18 October tests (no job attached, so they carry an E2e marker).
set session_replication_role = replica;
delete from public.recovery_payouts where who ilike 'e2e %';
delete from public.recovery_trips where location_details ilike 'e2e %' or company ilike 'e2e %';
delete from public.recovery_companies where name ilike 'e2e %';
set session_replication_role = default;

-- Advisor-bonus rows made by tests (snapshots that mention E2E invoices, and overrides on test invoices).
set session_replication_role = replica;
delete from public.advisor_bonus_periods where rows::text ilike '%E2E%';
delete from public.advisor_bonus_overrides where invoice_id::text like '22222222%';
set session_replication_role = default;
