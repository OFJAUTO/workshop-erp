-- Fixes from the full test run of 8 October 2026:
-- mileage in km or miles, assignment target with notes and reminders, the road test decision at
-- assignment, N/A as a fourth answer on checklist items, and the QC inspector's narrower access.

-- 1. Mileage: the unit the advisor used, the converted figure, and the car remembers its unit ----
alter table public.vehicles add column if not exists mileage_unit text not null default 'km'
  check (mileage_unit in ('km', 'mi'));
alter table public.gate_ins add column if not exists mileage_unit text not null default 'km'
  check (mileage_unit in ('km', 'mi'));
alter table public.gate_ins add column if not exists mileage_miles integer
  check (mileage_miles is null or mileage_miles >= 0);
update public.gate_ins set mileage_miles = round(mileage / 1.609344) where mileage_miles is null;

-- 2. Assignment: the advisor's note to the manager, reminders, and the owner's overdue warning ---
alter table public.jobs add column if not exists assignment_note text;
alter table public.jobs add column if not exists assignment_note_by uuid references public.staff (id);
alter table public.jobs add column if not exists assignment_note_at timestamptz;
alter table public.jobs add column if not exists assignment_reminded_at timestamptz;
alter table public.jobs add column if not exists assignment_overdue_notified_at timestamptz;

insert into public.settings (key, value, label, description) values
  ('assignment_target_minutes', '30'::jsonb, 'Assignment target (working minutes)', 'How long a car may wait for a technician after the customer approves. Past it the card turns amber, then red, and the owner is told.')
on conflict (key) do nothing;

-- 3. Road test: the workshop manager decides at assignment ----------------------------------------
alter table public.road_tests add column if not exists decision text
  check (decision is null or decision in ('needed', 'not_needed', 'not_possible'));
alter table public.road_tests add column if not exists decision_note text;
alter table public.road_tests add column if not exists decided_by uuid references public.staff (id);
alter table public.road_tests add column if not exists decided_at timestamptz;

-- 4. N/A as a fourth answer on checklist items ---------------------------------------------------
alter table public.inspection_items drop constraint if exists inspection_items_status_check;
alter table public.inspection_items add constraint inspection_items_status_check
  check (status is null or status in ('good', 'average', 'bad', 'na'));

-- 5. QC inspector: customer name only, cars in the workshop only, no bookings ---------------------
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
  using (not public.has_role('technician', 'workshop_manager', 'qc_inspector'));
drop policy if exists customer_contacts_read on public.customer_contacts;
create policy customer_contacts_read on public.customer_contacts for select to authenticated
  using (not public.has_role('technician', 'workshop_manager', 'qc_inspector'));

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated
  using (
    case public.current_staff_role()
      when 'technician' then exists (select 1 from public.jobs j where j.vehicle_id = vehicles.id and j.assigned_to = auth.uid())
      when 'workshop_manager' then exists (select 1 from public.jobs j where j.vehicle_id = vehicles.id and j.is_open)
      when 'qc_inspector' then exists (select 1 from public.jobs j where j.vehicle_id = vehicles.id and j.is_open)
      else true end
  );

drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments for select to authenticated
  using (
    case public.current_staff_role()
      when 'technician' then false
      when 'qc_inspector' then false
      when 'workshop_manager' then (department is null or department = 'both' or public.current_side() is null or department = public.current_side())
      else true end
  );
