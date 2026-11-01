-- Supplier invoice price different from the approved LPO (1 November 2026, LPO-00035-2).
-- 1. The limit of an automatic acceptance per LPO: the higher of 5% of the LPO and AED 100 (Settings).
-- 2. LPO-00035-2 (SPARE HUB SPARE PARTS): the supplier invoiced the four wishbone links at AED 260.00 each against
--    250.00 approved. Peter typed 260 on the receiving panel, which had no box for it, so it was never saved. The
--    invoice price is set (+AED 40.00 on a 1,000.00 LPO: within the limit, accepted) and the parts' cost on the job
--    follows it. The approved price stays on the LPO. Live only: elsewhere these rows do not exist.

insert into public.settings (key, value, label) values
  ('supplier_price_auto_percent', to_jsonb(5), 'Supplier price up after approval: accepted at once up to this percent of the LPO'),
  ('supplier_price_auto_aed', to_jsonb(100), 'Supplier price up after approval: or up to this amount (AED), whichever is higher')
on conflict (key) do nothing;

do $$
declare
  v_po uuid := '590e7edc-1e6f-4716-9f7c-e9e175c98580';
  v_owner uuid;
  v_job uuid;
begin
  select job_id into v_job from public.purchase_orders where id = v_po and number = 'LPO-00035-2';
  if v_job is null then return; end if;
  select id into v_owner from public.staff where role_id = 'owner' and is_active order by created_at limit 1;
  update public.purchase_order_lines set invoice_unit_cost = 260, invoice_check = 'accepted', invoice_check_at = now(), invoice_check_by = v_owner, updated_by = v_owner
   where po_id = v_po and is_active and unit_cost = 250 and invoice_unit_cost is null;
  update public.part_items set final_cost_aed = 260, updated_by = v_owner
   where id in (select part_item_id from public.purchase_order_lines where po_id = v_po and is_active and invoice_unit_cost = 260) and final_cost_aed is null;
  update public.purchase_orders set supplier_invoice_amount = 1040, updated_by = v_owner where id = v_po and supplier_invoice_amount is null;
  insert into public.job_events (job_id, event_type, note, created_by)
    values (v_job, 'supplier_price_change', 'LPO-00035-2 (SPARE HUB SPARE PARTS): the supplier''s invoice 2374 prices the wishbone links at AED 260.00 each against 250.00 approved (+10.00 each, +40.00 total for four). Within the limit: accepted; the job''s cost follows the invoice, the customer''s price stays as approved (1 November 2026).', v_owner);
end $$;
