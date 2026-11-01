-- LPO approvals (1 November 2026, LPO-00038 on J-00317) and the intake manifold.
--
-- 1. A part line can be refused on its own on an LPO waiting for approval (the owner or the head accountant):
--    the part is greyed with "Refused by <name> – <reason>", never "To order", never on an LPO again. A replacement
--    from another supplier points back at it through the existing replaced_part_id / replacement_part_id pair.
-- 2. J-00317: the Al Tayer TRANSMISSION MOUNT the owner refused (LPO-00034) is marked refused, the Al Futtaim one is
--    its replacement (to order, added to LPO-00038 which still waits for approval), and Peter's request to revise the
--    approved quotation for it is closed (the replacement is covered by the line the customer approved).
-- 3. "Intake manifold" joins ENGINE BAY in the inspection checklist after Valve cover. Reports already done keep
--    the checklist they were done with.

alter table public.part_items
  add column if not exists refused_at timestamptz,
  add column if not exists refused_by uuid references public.staff(id),
  add column if not exists refused_reason text,
  add column if not exists refused_po_id uuid references public.purchase_orders(id);

-- The checklist: Intake manifold after Valve cover (or at the end of Engine bay), once.
do $$
declare
  cl jsonb;
  out jsonb := '[]'::jsonb;
  sec jsonb;
  items jsonb;
  newitems jsonb;
  it jsonb;
  placed boolean;
begin
  select value into cl from public.settings where key = 'inspection_checklist';
  if cl is null or jsonb_typeof(cl) <> 'array' then return; end if;
  if cl::text like '%engine_bay.intake_manifold%' then return; end if;
  for sec in select * from jsonb_array_elements(cl) loop
    if sec->>'key' = 'engine_bay' then
      items := coalesce(sec->'items', '[]'::jsonb);
      newitems := '[]'::jsonb;
      placed := false;
      for it in select * from jsonb_array_elements(items) loop
        newitems := newitems || jsonb_build_array(it);
        if it->>'key' = 'engine_bay.valve_cover' then
          newitems := newitems || jsonb_build_array(jsonb_build_object('key', 'engine_bay.intake_manifold', 'label', 'Intake manifold', 'hint', 'cracks, leaks, gasket, flaps / runner actuator'));
          placed := true;
        end if;
      end loop;
      if not placed then
        newitems := newitems || jsonb_build_array(jsonb_build_object('key', 'engine_bay.intake_manifold', 'label', 'Intake manifold', 'hint', 'cracks, leaks, gasket, flaps / runner actuator'));
      end if;
      sec := jsonb_set(sec, '{items}', newitems);
    end if;
    out := out || jsonb_build_array(sec);
  end loop;
  update public.settings set value = out, updated_at = now() where key = 'inspection_checklist';
end $$;

-- J-00317 (live only: on any other database these rows do not exist and nothing happens).
do $$
declare
  v_job uuid := '8b3af1aa-da5c-44b7-901f-246fb1f8c0b0';
  v_old uuid := 'c15c3414-2104-4159-b4ef-237979e494b4';
  v_new uuid := '3b5adbe0-b0fa-4545-8119-eb5ca72709ea';
  v_lpo uuid := 'bf5e310c-29a4-4f4c-8026-94e1aecbff64';
  v_refused uuid := 'd76ad1d4-578b-42ab-867f-e428262b6d3f';
  v_owner uuid;
  v_owner_name text;
  v_reason text;
  v_when timestamptz;
  v_line uuid;
  v_pos int;
  v_total numeric;
  v_number text;
  v_jobno text;
begin
  if not exists (select 1 from public.part_items where id = v_old and job_id = v_job) then return; end if;
  if not exists (select 1 from public.part_items where id = v_new and job_id = v_job) then return; end if;
  select id, display_name into v_owner, v_owner_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1;
  select created_at, regexp_replace(note, '^LPO-[0-9]+ refused by [^:]+: ', '') into v_when, v_reason
    from public.job_events where job_id = v_job and event_type = 'po_refused' order by created_at desc limit 1;

  update public.part_items
     set refused_at = coalesce(v_when, now()), refused_by = v_owner, refused_reason = coalesce(v_reason, 'Wrong supplier'),
         refused_po_id = v_refused, order_status = 'none', replacement_part_id = v_new, updated_by = v_owner
   where id = v_old and refused_at is null;

  update public.part_items
     set replaced_part_id = v_old, order_status = 'to_order', updated_by = v_owner
   where id = v_new and order_status = 'none' and po_id is null;

  -- On LPO-00038 while it still waits for approval.
  select number into v_number from public.purchase_orders where id = v_lpo and status = 'pending_approval' and is_active;
  if v_number is not null and not exists (select 1 from public.purchase_order_lines where po_id = v_lpo and part_item_id = v_new and is_active) then
    select coalesce(max(position), 0) + 1 into v_pos from public.purchase_order_lines where po_id = v_lpo;
    -- The part number "13" was a line number typed into the part number box: the supplier copy shows none.
    insert into public.purchase_order_lines (po_id, part_item_id, position, description, part_number, quantity, unit_cost, list_price, discount_percent, created_by, updated_by)
      select v_lpo, p.id, v_pos, p.description, null, coalesce(p.confirmed_quantity, p.quantity, 1), coalesce(p.cost_aed, 0), p.list_price_aed, p.discount_percent, v_owner, v_owner
        from public.part_items p where p.id = v_new
      returning id into v_line;
    update public.part_items set po_id = v_lpo, po_line_id = v_line, updated_by = v_owner where id = v_new;
    select round(coalesce((select sum(quantity * unit_cost) from public.purchase_order_lines where po_id = v_lpo and is_active), 0)
                 + coalesce((select sum(amount_aed) from public.supplier_charges where po_id = v_lpo and is_active and removed_at is null), 0), 2)
      into v_total;
    update public.purchase_orders set total_cost_aed = v_total, supplier_name = '2 suppliers', updated_by = v_owner where id = v_lpo;
    select job_number into v_jobno from public.jobs where id = v_job;
    insert into public.job_events (job_id, event_type, note, created_by)
      values (v_job, 'po_part_added', v_number || ': TRANSMISSION MOUNT (Al Futtaim Auto Parts LLC, AED 1,192) added to the LPO waiting for approval. It replaces the refused Al Tayer Motors LLC line. New total AED ' || to_char(v_total, 'FM999,999,990.00') || '.', v_owner);
    insert into public.notifications (staff_id, type, title, body, job_id, href)
      select s.id, 'po_approval', '1 part added to ' || v_number,
             coalesce(v_jobno, '') || ' · TRANSMISSION MOUNT · Al Futtaim Auto Parts LLC · AED 1,192.00 (replaces the refused Al Tayer line). New total AED ' || to_char(v_total, 'FM999,999,990.00') || '. One tap to approve.',
             v_job, '/parts/orders/' || v_lpo
        from public.staff s
       where s.is_active and (s.role_id = 'owner' or (s.role_id = 'accounts' and s.is_head_accountant));
  end if;

  -- Peter's request to revise the approved quotation for the mount is no longer needed.
  update public.quotations
     set revision_declined_at = now(),
         revision_decision_note = 'Not needed: the new TRANSMISSION MOUNT replaces the refused Al Tayer line, which the customer already approved (1 November 2026).'
   where job_id = v_job and kind = 'quotation' and revision_requested_at is not null and revision_declined_at is null and revision_allowed_at is null and revision_request_kind = 'parts';
end $$;

notify pgrst, 'reload schema';
