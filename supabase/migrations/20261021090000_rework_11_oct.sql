-- Rework of 11 October 2026: the parts pool and parts list, the road test status, tyre sizes on the car,
-- the manager's note presets, item answer styles, positions on quotation lines, and sentence case for lists.

-- C2. "Pending road test" is a status of its own.
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('gate_in_pending','pending_approval','pending_road_test','pending_inspection','in_inspection','pending_quote','pending_customer_approval','approved','waiting_parts','in_work','pending_qc','pending_wash','ready','pending_payment','in_delivery','closed'));

-- D5. Tyre sizes remembered on the car.
alter table public.vehicles add column if not exists tyre_size_front text;
alter table public.vehicles add column if not exists tyre_size_rear text;

-- D1, D7, E2, E4. The technician's note about the requests, the manager's internal note, the gathered parts list and its confirmation.
alter table public.inspections add column if not exists requests_note text;
alter table public.inspections add column if not exists manager_note_internal text;
alter table public.inspections add column if not exists parts_list jsonb not null default '[]'::jsonb;
alter table public.inspections add column if not exists parts_list_confirmed_at timestamptz;
alter table public.inspections add column if not exists parts_list_confirmed_by uuid references public.staff (id);
-- D2. Each checklist item answers Good / Average / Bad (grade) or OK / Required (job).
alter table public.inspection_items add column if not exists style text not null default 'grade' check (style in ('grade', 'job'));
-- A12. The reason a tyre with tread left is marked for replacement lives in the measurements (tyre_<pos>_reason); no column needed.

-- E1. The shared pool of part names.
create table if not exists public.part_catalogue (
  id              uuid primary key default gen_random_uuid(),
  category        text not null,
  name            text not null,
  needs_position  boolean not null default false,
  position        integer not null default 0,
  is_active       boolean not null default true,
  /** A suggestion from Parts staff waits for the owner (is_active false, suggested_by set). */
  suggested_by    uuid references public.staff (id),
  usage_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id)
);
create unique index if not exists part_catalogue_name_idx on public.part_catalogue (lower(name));
alter table public.part_catalogue enable row level security;
drop policy if exists part_catalogue_read on public.part_catalogue;
create policy part_catalogue_read on public.part_catalogue for select to authenticated using (true);
drop trigger if exists part_catalogue_audit on public.part_catalogue;
create trigger part_catalogue_audit after insert or update on public.part_catalogue for each row execute function public.write_audit_log();
drop trigger if exists part_catalogue_no_delete on public.part_catalogue;
create trigger part_catalogue_no_delete before delete on public.part_catalogue for each row execute function public.prevent_delete();

-- E2, E3. A part on the list carries its positions and an optional short note; a quotation job line carries its positions too.
alter table public.part_requests add column if not exists positions text[] not null default '{}';
alter table public.part_requests add column if not exists note text;
alter table public.part_requests add column if not exists catalogue_id uuid references public.part_catalogue (id);
alter table public.part_items add column if not exists positions text[] not null default '{}';
alter table public.quotation_lines add column if not exists positions text[] not null default '{}';

-- F4, F5. One list of jobs and services: a job can ask for the position, and can be suggested by findings or parts.
alter table public.services add column if not exists position_ask boolean not null default false;
alter table public.services add column if not exists suggest_for text[] not null default '{}';

-- A8. Lists in sentence case: services and the pool get the same tidy as parts.
create or replace function public.erp_tidy_services() returns trigger language plpgsql as $$
begin
  new.name := public.erp_sentence_case(new.name);
  return new;
end $$;
drop trigger if exists services_tidy on public.services;
create trigger services_tidy before insert or update on public.services for each row execute function public.erp_tidy_services();
create or replace function public.erp_tidy_part_catalogue() returns trigger language plpgsql as $$
begin
  new.name := public.erp_sentence_case(new.name);
  new.category := public.erp_sentence_case(new.category);
  return new;
end $$;
drop trigger if exists part_catalogue_tidy on public.part_catalogue;
create trigger part_catalogue_tidy before insert or update on public.part_catalogue for each row execute function public.erp_tidy_part_catalogue();
-- Existing rows typed in capitals get the same treatment once.
update public.services set name = name where name = upper(name) and name <> lower(name);
update public.part_requests set label = label where label = upper(label) and label <> lower(label);
update public.part_items set description = description where description = upper(description) and description <> lower(description);

-- The starter pool.
insert into public.part_catalogue (category, name, needs_position, position) values
  ('Servicing', 'Engine oil', false, 1), ('Servicing', 'Oil filter', false, 2), ('Servicing', 'Air filter', false, 3), ('Servicing', 'Cabin filter', false, 4), ('Servicing', 'Fuel filter', false, 5), ('Servicing', 'Spark plug', false, 6), ('Servicing', 'Ignition coil', true, 7), ('Servicing', 'Drain plug and washer', false, 8), ('Servicing', 'Wiper blade', true, 9),
  ('Brakes', 'Brake pads', true, 1), ('Brakes', 'Brake disc', true, 2), ('Brakes', 'Brake pad wear sensor', true, 3), ('Brakes', 'Brake caliper', true, 4), ('Brakes', 'Brake hose', true, 5), ('Brakes', 'Brake fluid', false, 6), ('Brakes', 'Parking brake shoe', true, 7), ('Brakes', 'Parking brake motor', true, 8), ('Brakes', 'ABS sensor', true, 9),
  ('Wheels and tyres', 'Tyre', true, 1), ('Wheels and tyres', 'Wheel bolt or nut', false, 2), ('Wheels and tyres', 'Locking wheel nut set', false, 3), ('Wheels and tyres', 'Centre cap', true, 4), ('Wheels and tyres', 'TPMS sensor', true, 5), ('Wheels and tyres', 'Valve', true, 6), ('Wheels and tyres', 'Wheel bearing', true, 7), ('Wheels and tyres', 'Wheel hub', true, 8),
  ('Suspension and steering', 'Air suspension strut', true, 1), ('Suspension and steering', 'Shock absorber', true, 2), ('Suspension and steering', 'Coil spring', true, 3), ('Suspension and steering', 'Air spring', true, 4), ('Suspension and steering', 'Shock mount', true, 5), ('Suspension and steering', 'Upper control arm', true, 6), ('Suspension and steering', 'Lower control arm', true, 7), ('Suspension and steering', 'Control arm bushing', true, 8), ('Suspension and steering', 'Ball joint', true, 9), ('Suspension and steering', 'Tension rod', true, 10), ('Suspension and steering', 'Stabiliser link', true, 11), ('Suspension and steering', 'Stabiliser bar bushing', true, 12), ('Suspension and steering', 'Tie rod end', true, 13), ('Suspension and steering', 'Inner tie rod', true, 14), ('Suspension and steering', 'Steering rack', false, 15), ('Suspension and steering', 'Steering rack boot', true, 16), ('Suspension and steering', 'Power steering pump', false, 17), ('Suspension and steering', 'Power steering hose', false, 18), ('Suspension and steering', 'Air suspension compressor', false, 19), ('Suspension and steering', 'Air suspension valve block', false, 20), ('Suspension and steering', 'Height sensor', true, 21),
  ('Engine', 'Valve cover gasket', false, 1), ('Engine', 'Oil pan gasket', false, 2), ('Engine', 'Oil filter housing gasket', false, 3), ('Engine', 'Front crankshaft seal', false, 4), ('Engine', 'Rear main seal', false, 5), ('Engine', 'Timing chain kit', false, 6), ('Engine', 'Chain tensioner', false, 7), ('Engine', 'Drive belt', false, 8), ('Engine', 'Belt tensioner', false, 9), ('Engine', 'Idler pulley', false, 10), ('Engine', 'Engine mount', true, 11), ('Engine', 'Oil cooler', false, 12), ('Engine', 'Oil separator (PCV)', false, 13), ('Engine', 'Vacuum pump', false, 14), ('Engine', 'Intake manifold gasket', false, 15), ('Engine', 'Turbocharger', true, 16), ('Engine', 'Turbo oil line', true, 17), ('Engine', 'Intercooler', true, 18), ('Engine', 'Intercooler hose', true, 19), ('Engine', 'Supercharger belt', false, 20),
  ('Fuel and exhaust', 'Fuel injector', true, 1), ('Fuel and exhaust', 'Fuel pump', false, 2), ('Fuel and exhaust', 'High pressure fuel pump', false, 3), ('Fuel and exhaust', 'Fuel line', false, 4), ('Fuel and exhaust', 'Throttle body', false, 5), ('Fuel and exhaust', 'O2 sensor', true, 6), ('Fuel and exhaust', 'Catalytic converter', true, 7), ('Fuel and exhaust', 'Exhaust gasket', false, 8), ('Fuel and exhaust', 'Exhaust clamp', false, 9),
  ('Cooling', 'Radiator', false, 1), ('Cooling', 'Water pump', false, 2), ('Cooling', 'Thermostat', false, 3), ('Cooling', 'Coolant hose', false, 4), ('Cooling', 'Coolant pipe', false, 5), ('Cooling', 'Expansion tank', false, 6), ('Cooling', 'Expansion tank cap', false, 7), ('Cooling', 'Radiator fan', false, 8), ('Cooling', 'Coolant', false, 9),
  ('Air conditioning', 'A/C compressor', false, 1), ('Air conditioning', 'Condenser', false, 2), ('Air conditioning', 'Evaporator', false, 3), ('Air conditioning', 'Expansion valve', false, 4), ('Air conditioning', 'A/C pipe', false, 5), ('Air conditioning', 'Receiver drier', false, 6), ('Air conditioning', 'Blower motor', false, 7), ('Air conditioning', 'A/C gas', false, 8), ('Air conditioning', 'Compressor oil', false, 9),
  ('Transmission and driveline', 'Transmission oil', false, 1), ('Transmission and driveline', 'Transmission filter', false, 2), ('Transmission and driveline', 'Transmission pan and gasket', false, 3), ('Transmission and driveline', 'Mechatronic unit', false, 4), ('Transmission and driveline', 'Transmission mount', false, 5), ('Transmission and driveline', 'Clutch kit', false, 6), ('Transmission and driveline', 'Differential oil', true, 7), ('Transmission and driveline', 'Transfer case oil', false, 8), ('Transmission and driveline', 'Driveshaft', true, 9), ('Transmission and driveline', 'CV boot', true, 10), ('Transmission and driveline', 'Propeller shaft coupling', false, 11),
  ('Electrical', 'Main battery', false, 1), ('Electrical', 'Auxiliary battery', false, 2), ('Electrical', 'Alternator', false, 3), ('Electrical', 'Starter motor', false, 4), ('Electrical', 'Sensor', false, 5), ('Electrical', 'Fuse', false, 6), ('Electrical', 'Relay', false, 7), ('Electrical', 'Bulb', true, 8), ('Electrical', 'Headlight', true, 9), ('Electrical', 'Tail light', true, 10), ('Electrical', 'Window regulator', true, 11), ('Electrical', 'Door lock actuator', true, 12), ('Electrical', 'Wiring harness section', false, 13),
  ('Other', 'Gasket', false, 1), ('Other', 'Seal', false, 2), ('Other', 'O-ring', false, 3), ('Other', 'Clip', false, 4), ('Other', 'Bolt', false, 5), ('Other', 'Bracket', false, 6), ('Other', 'Hose clamp', false, 7)
on conflict do nothing;

-- Settings: the manager's one-tap notes, their usage, the complaint tags, and plain sentence case on customer pages.
insert into public.settings (key, value, label, description) values
  ('manager_note_presets', '["Report checked and accurate.", "Report checked. Findings confirmed on the car.", "Report corrected by the workshop manager.", "All listed items should be done together.", "Urgent items should be done before the car is driven further.", "Recommended items can wait until the next service.", "Vehicle is safe to drive. No urgent work found.", "Vehicle is not safe to drive until the urgent items are repaired.", "Further diagnosis is needed to confirm the cause.", "Parts must be ordered. Timing depends on delivery.", "Engine or transmission removal is required for this repair.", "Outside work is required for part of this job.", "Additional faults may be found once work starts.", "Vehicle is in good overall condition.", "Vehicle shows signs of previous repair work.", "Vehicle shows signs of poor previous maintenance."]'::jsonb, 'Manager note presets', 'One-tap notes on the report approval. Most used come first.'),
  ('manager_note_usage', '{}'::jsonb, 'Manager note usage', 'How often each preset was tapped.'),
  ('complaint_keywords', '{"air_conditioning": ["a/c", "ac ", "aircon", "cooling", "smell", "cold"], "wheels_tyres_and_brakes": ["vibration", "shake", "wobble", "brake", "squeal", "grind", "pull", "tyre", "wheel"], "steering_and_suspension": ["steering", "knock", "bump", "clunk", "suspension", "ride height"], "engine_bay": ["engine", "misfire", "start", "power", "rough", "idle"], "electrical": ["light", "warning", "window", "lock", "battery", "screen", "sensor", "horn"], "transmission_and_driveline": ["gear", "shift", "clutch", "transmission", "jerk"], "cooling": ["overheat", "coolant", "temperature"], "oil_leaks": ["leak", "oil", "drip"]}'::jsonb, 'Complaint keywords', 'Words in a customer request that tag a checklist section with "Customer complaint".'),
  ('part_pool_custom', '{}'::jsonb, 'Custom parts used', 'Custom part names typed by staff, with counts, offered to the owner to add to the pool.'),
  ('custom_jobs_used', '{}'::jsonb, 'Custom jobs used', 'Custom job names typed on quotations, with counts, offered to the owner to add to the list.')
on conflict (key) do nothing;
update public.settings set value = 'false'::jsonb where key = 'customer_documents_uppercase';
