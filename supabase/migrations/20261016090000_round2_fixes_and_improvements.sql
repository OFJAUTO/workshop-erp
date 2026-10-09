-- Round two after the owner's live test of 9 October 2026: the Parts desk without the technician's
-- confirmation step, part types and options, the automatic bank-charge line, the quotation
-- "complete" step, the inspection improvements (scan gate, structured parts, leaks, dangerous
-- findings, brake discs, fluids, big-job tags, estimated hours), Autel scan emails, the car picture
-- in the phone checklist, the "Total damage" wheel state, and the owner's "Act as" mode.

-- 1. Parts: no confirmation step; type, brand, options, a question to the workshop manager ---------
alter table public.part_items alter column confirm_status set default 'confirmed';
update public.part_items set confirm_status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), confirmed_quantity = coalesce(confirmed_quantity, quantity) where confirm_status = 'pending';
update public.part_requests set status = 'done' where status = 'listed';
alter table public.part_items add column if not exists part_type text check (part_type is null or part_type in ('genuine', 'oem', 'aftermarket', 'used'));
alter table public.part_items add column if not exists brand text;
alter table public.part_items add column if not exists option_group uuid;
alter table public.part_items add column if not exists question_text text;
alter table public.part_items add column if not exists question_at timestamptz;
alter table public.part_items add column if not exists question_by uuid references public.staff (id);
alter table public.part_items add column if not exists answer_text text;
alter table public.part_items add column if not exists answered_at timestamptz;
alter table public.part_items add column if not exists answered_by uuid references public.staff (id);
alter table public.part_requests add column if not exists quantity numeric(10,2);
alter table public.part_requests add column if not exists unit text;
alter table public.part_requests add column if not exists closed_reason text;

-- 2. Quotation lines: the part's type follows it; options the advisor picks from; the automatic fee; recovery trips
alter table public.quotation_lines add column if not exists part_type text;
alter table public.quotation_lines add column if not exists brand text;
alter table public.quotation_lines add column if not exists option_group uuid;
alter table public.quotation_lines add column if not exists chosen boolean not null default true;
alter table public.quotation_lines add column if not exists fee_kind text check (fee_kind is null or fee_kind in ('bank_charge'));
alter table public.quotation_lines add column if not exists recovery_trips numeric(6,2);
alter table public.quotation_lines add column if not exists recovery_provider text;
alter table public.quotations add column if not exists completed_at timestamptz;
alter table public.quotations add column if not exists completed_by uuid references public.staff (id);
alter table public.quotations add column if not exists parts_reminded_at timestamptz;
alter table public.quotations add column if not exists parts_escalated_at timestamptz;
alter table public.invoice_lines add column if not exists part_type text;
alter table public.invoice_lines add column if not exists brand text;

-- 3. Inspection: the scan gate, the technician's estimate, big-job tags, and per-item detail ---------
alter table public.inspections add column if not exists scan_read_at timestamptz;
alter table public.inspections add column if not exists scan_not_possible_reason text;
alter table public.inspections add column if not exists scan_approved_by uuid references public.staff (id);
alter table public.inspections add column if not exists scan_approved_at timestamptz;
alter table public.inspections add column if not exists estimated_hours numeric(6,1);
alter table public.inspections add column if not exists estimated_hours_manager numeric(6,1);
alter table public.inspections add column if not exists estimate_reason text;
alter table public.inspections add column if not exists big_job_tags text[] not null default '{}';
alter table public.inspection_items add column if not exists dangerous boolean not null default false;
alter table public.inspection_items add column if not exists dangerous_reason text;
alter table public.inspection_items add column if not exists leak_severity text check (leak_severity is null or leak_severity in ('sweating', 'dripping', 'heavy'));
alter table public.inspection_items add column if not exists leak_repair text check (leak_repair is null or leak_repair in ('gasket', 'seal', 'reseal', 'hose', 'replace'));
alter table public.inspection_items add column if not exists fluid_qty numeric(8,2);
alter table public.inspection_items add column if not exists fluid_unit text;
alter table public.inspection_items add column if not exists fluid_grade text;
alter table public.inspection_items add column if not exists fluid_spec text;
alter table public.inspection_items add column if not exists disc_condition text check (disc_condition is null or disc_condition in ('good', 'close_to_minimum', 'below_minimum'));
alter table public.inspection_items add column if not exists disc_action text check (disc_action is null or disc_action in ('none', 'skim', 'replace'));
alter table public.inspection_items add column if not exists disc_thickness numeric(6,2);
alter table public.inspection_items add column if not exists disc_minimum numeric(6,2);
alter table public.inspection_items add column if not exists parts_rows jsonb not null default '[]'::jsonb;

-- Dangerous findings: the quotation line carries it, the customer must acknowledge a decline.
alter table public.quotation_lines add column if not exists dangerous boolean not null default false;
alter table public.quotations add column if not exists danger_acknowledged_at timestamptz;
alter table public.quotations add column if not exists danger_acknowledged_by text;

-- 4. One-minute codes to continue a photo on the phone ------------------------------------------------
create table public.quick_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  job_id      uuid not null references public.jobs (id),
  target      text not null,
  created_by  uuid references public.staff (id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index quick_codes_job_idx on public.quick_codes (job_id, created_at desc);
alter table public.quick_codes enable row level security;
revoke all on public.quick_codes from anon;
create policy quick_codes_read on public.quick_codes for select to authenticated using (true);

-- 5. Autel scan reports arriving by email ---------------------------------------------------------------
create table public.inbound_scans (
  id            uuid primary key default gen_random_uuid(),
  received_at   timestamptz not null default now(),
  from_email    text,
  subject       text,
  vin           text,
  storage_path  text not null,
  content_type  text,
  file_name     text,
  job_id        uuid references public.jobs (id),
  kind          text check (kind is null or kind in ('pre', 'post')),
  status        text not null default 'unmatched' check (status in ('matched', 'unmatched', 'attached', 'ignored')),
  matched_by    text,
  attached_by   uuid references public.staff (id),
  attached_at   timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.staff (id)
);
create index inbound_scans_status_idx on public.inbound_scans (status, received_at desc);
create index inbound_scans_job_idx on public.inbound_scans (job_id);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('scan-reports', 'scan-reports', false, 36700160, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
create policy scan_reports_read on storage.objects for select to authenticated using (bucket_id = 'scan-reports');

-- 6. Gate-in: the car picture through the phone checklist; a sixth wheel state ---------------------------
alter table public.gate_in_media drop constraint if exists gate_in_media_kind_check;
alter table public.gate_in_media add constraint gate_in_media_kind_check
  check (kind in ('video', 'video_exterior', 'video_interior', 'dashboard_photo', 'car_picture',
                  'keys_photo', 'keys_photo_front', 'keys_photo_back', 'damage_photo', 'gate_out_photo',
                  'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'));
alter table public.gate_in_media drop constraint if exists gate_in_media_wheel_condition_check;
alter table public.gate_in_media add constraint gate_in_media_wheel_condition_check
  check (wheel_condition is null or wheel_condition <@ array['none', 'curbed', 'scratched', 'paint_fade', 'bent', 'total']::text[]);

-- 7. Stamps, change log, no deletes ------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['inbound_scans'] loop
    execute format('create trigger %I_audit_columns before insert or update on public.%I for each row execute function public.set_audit_columns()', t, t);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function public.write_audit_log()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.prevent_delete()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
create policy inbound_scans_read on public.inbound_scans for select to authenticated using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'technician', 'qc_inspector'));
create policy inbound_scans_update on public.inbound_scans for update to authenticated using (public.has_role('owner', 'workshop_manager', 'service_advisor')) with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));

-- 8. Settings ----------------------------------------------------------------------------------------------
insert into public.settings (key, value, label, description) values
  ('part_types', '["Genuine", "OEM", "Aftermarket", "Used"]'::jsonb, 'Part types', 'One per line. The first is the default.'),
  ('bank_charge_fee_percent', '1.9'::jsonb, 'Bank charge on quotations (%)', 'The hidden Fee line: total including VAT times this.'),
  ('parts_remind_minutes', '30'::jsonb, 'Remind Parts after (working minutes)', 'The advisor can remind Parts after this long.'),
  ('parts_escalate_minutes', '60'::jsonb, 'Escalate to the owner after (working minutes)', 'The advisor can escalate to the owner after this long.'),
  ('prescan_gate_enabled', 'false'::jsonb, 'Pre-scan gate', 'The technician must read the Autel scan report before the checklist opens. Off until the scan email link is tested.'),
  ('dangerous_customer_text', to_jsonb('SAFETY WARNING: our technician found a fault that makes this vehicle unsafe to drive. We strongly recommend the repair before the vehicle is driven. If you decline it, please consider recovery instead of driving.'::text), 'Dangerous finding: customer warning', 'Shown on the quotation page and PDF. Have the wording checked.'),
  ('dangerous_customer_text_ar', to_jsonb('تحذير سلامة: وجد الفني عطلاً يجعل هذه المركبة غير آمنة للقيادة. ننصح بشدة بإجراء الإصلاح قبل قيادة المركبة. في حال رفض الإصلاح، يُرجى التفكير في نقل المركبة بالشاحنة بدلاً من قيادتها.'::text), 'Dangerous finding: customer warning (Arabic)', 'Shown under the English text.'),
  ('dangerous_acknowledgement_text', to_jsonb('I understand that this vehicle has a fault that makes it unsafe to drive, that OFJ Automotive advised the repair, and that I decline it at my own risk.'::text), 'Dangerous finding: acknowledgement', 'The tick-box text when the customer declines a dangerous repair. Have the wording checked.'),
  ('inspection_limits', '{"tread_max": 12, "pads_max": 20, "battery_max": 16, "vent_min": -5, "vent_max": 40, "fluid_max": 30, "tyre_years": 15}'::jsonb, 'Inspection number limits', 'Sensible limits on typed numbers.'),
  ('item_suggestions', '{}'::jsonb, 'Checklist suggestions', 'Per item: suggested parts and quick remarks to tap. Learns the most common entries.'),
  ('fluid_grades', '["0W-20", "0W-30", "0W-40", "5W-30", "5W-40", "5W-50", "10W-40", "ATF", "CVT", "DCT", "75W-90", "80W-90", "DOT 4", "DOT 5.1", "G12", "G13", "R134a", "R1234yf"]'::jsonb, 'Fluid grades', 'One-tap suggestions for fluid grades.'),
  ('labour_actions', '["Remove and replace", "Remove and refit", "Remove and clean", "Remove and inspect", "Repair", "Reseal", "Overhaul", "Adjust", "Tighten", "Lubricate", "Skim", "Bleed", "Flush", "Drain and refill", "Top up", "Recharge", "Balance", "Align", "Calibrate", "Program or code", "Reset", "Diagnose", "Test", "Road test"]'::jsonb, 'Labour actions', 'The pick-list for labour descriptions.'),
  ('labour_positions', '["Front", "Rear", "Left", "Right", "Front left", "Front right", "Rear left", "Rear right", "Upper", "Lower", "Inner", "Outer"]'::jsonb, 'Labour positions', 'The pick-list for labour descriptions.'),
  ('big_job_tags', '["Engine removal", "Transmission removal", "Subframe down", "Special tool", "Outside work"]'::jsonb, 'Big-job tags', 'One-tap tags by the technician notes.'),
  ('labour_hours_memory', '{}'::jsonb, 'Remembered labour hours', 'Hours per job and car model, filled in automatically.'),
  ('inbound_scan_token', to_jsonb(encode(gen_random_bytes(18), 'hex')), 'Scan email webhook token', 'Part of the address the email service calls. Shown on the Settings page only.')
on conflict (key) do nothing;

-- The split checklist lines and the new fuel item replace the starting checklist.
update public.settings set value = '[
 {"key":"engine_bay","title":"Engine bay","items":[
  {"key":"engine_bay.bonnet_shocks_lever_cable","label":"Bonnet shocks + lever/cable"},
  {"key":"engine_bay.engine_covers","label":"Engine covers"},
  {"key":"engine_bay.engine_oil_cap","label":"Engine oil cap"},
  {"key":"engine_bay.engine_oil_level_and_condition","label":"Engine oil level and condition"},
  {"key":"engine_bay.engine_oil_filter","label":"Engine oil filter"},
  {"key":"engine_bay.engine_air_filter_housing_pipes_connector_hoses","label":"Engine air filter + housing/pipes/connector/hoses"},
  {"key":"engine_bay.serpentine_belt_auxiliary_belts","label":"Serpentine belt + auxiliary belts"},
  {"key":"engine_bay.idler_tensioner_pulley","label":"Idler / tensioner / pulley"},
  {"key":"engine_bay.spark_plugs","label":"Spark plugs"},
  {"key":"engine_bay.ignition_coil_wiring","label":"Ignition coil + wiring"},
  {"key":"engine_bay.valve_cover","label":"Valve cover"},
  {"key":"engine_bay.wiper_tank_pipes_connector_hoses_wiper_blades","label":"Wiper tank + pipes/connector/hoses + wiper blades"},
  {"key":"engine_bay.brake_fluid","label":"Brake fluid"},
  {"key":"engine_bay.supercharger","label":"Supercharger"},
  {"key":"engine_bay.turbocharger","label":"Turbocharger"},
  {"key":"engine_bay.brake_vacuum_pump","label":"Brake vacuum pump"},
  {"key":"engine_bay.engine_oil_cooler","label":"Engine oil cooler"},
  {"key":"engine_bay.transmission_oil_cooler","label":"Transmission oil cooler"},
  {"key":"engine_bay.engine_mounts","label":"Engine mounts"},
  {"key":"engine_bay.fuel_lines_fuel_pump_and_fuel_leaks","label":"Fuel lines, fuel pump and fuel leaks"}]},
 {"key":"cooling","title":"Cooling","items":[
  {"key":"cooling.coolant_tank","label":"Coolant tank"},
  {"key":"cooling.coolant_hoses","label":"Coolant hoses"},
  {"key":"cooling.water_pump","label":"Water pump"},
  {"key":"cooling.thermostat","label":"Thermostat"},
  {"key":"cooling.radiator_pipes_connector_hoses","label":"Radiator + pipes/connector/hoses"}]},
 {"key":"oil_leaks","title":"Oil leaks","items":[
  {"key":"oil_leaks.engine_top_side","label":"Engine top side"},
  {"key":"oil_leaks.engine_front_side","label":"Engine front side"},
  {"key":"oil_leaks.engine_mid_lower_portion","label":"Engine mid/lower portion"},
  {"key":"oil_leaks.engine_rear_side","label":"Engine rear side"}]},
 {"key":"transmission_and_driveline","title":"Transmission and driveline","items":[
  {"key":"transmission_and_driveline.transmission_mounts","label":"Transmission mounts"},
  {"key":"transmission_and_driveline.transmission_mechanical","label":"Transmission mechanical"},
  {"key":"transmission_and_driveline.transmission_electrical","label":"Transmission electrical"},
  {"key":"transmission_and_driveline.transfer_case","label":"Transfer case"},
  {"key":"transmission_and_driveline.drive_shaft_aux_shaft_bushings_coupler_bearing","label":"Drive shaft + aux shaft + bushings/coupler/bearing"},
  {"key":"transmission_and_driveline.differential_bushes","label":"Differential bushes"},
  {"key":"transmission_and_driveline.front_differential_oil_leak","label":"Front differential oil leak"},
  {"key":"transmission_and_driveline.rear_differential","label":"Rear differential"},
  {"key":"transmission_and_driveline.transmission_and_differential_fluid_condition","label":"Transmission and differential fluid condition"}]},
 {"key":"steering_and_suspension","title":"Steering and suspension","items":[
  {"key":"steering_and_suspension.shock_mounts_connectors","label":"Shock mounts + connectors"},
  {"key":"steering_and_suspension.power_steering_rack_bushes_leak_play_boots_tie_rod","label":"Power steering rack bushes/leak/play + boots + tie rod"},
  {"key":"steering_and_suspension.stabilizer_leak_bushes_electrical_fault_link_rod_stabilizer_","label":"Stabilizer leak/bushes/electrical fault + link rod + stabilizer bar bush"},
  {"key":"steering_and_suspension.lower_arms","label":"Lower arms"},
  {"key":"steering_and_suspension.upper_arms","label":"Upper arms"},
  {"key":"steering_and_suspension.front_shock_absorbers_air_hydraulic","label":"Front shock absorbers (air / hydraulic)"},
  {"key":"steering_and_suspension.height_level_sensor","label":"Height level sensor"},
  {"key":"steering_and_suspension.rear_suspension_arms_bushes","label":"Rear suspension arms/bushes"},
  {"key":"steering_and_suspension.rear_shock_absorbers","label":"Rear shock absorbers"},
  {"key":"steering_and_suspension.wheel_alignment","label":"Wheel alignment"}]},
 {"key":"underbody","title":"Underbody","items":[
  {"key":"underbody.undercovers_bolts_fasteners_clips","label":"Undercovers + bolts/fasteners/clips"},
  {"key":"underbody.exhaust","label":"Exhaust"},
  {"key":"underbody.o2_sensors","label":"O2 sensors"},
  {"key":"underbody.catalytic_converter","label":"Catalytic converter"},
  {"key":"underbody.fuel_tank_cover","label":"Fuel tank + cover"},
  {"key":"underbody.fender_liner","label":"Fender liner"}]},
 {"key":"wheels_tyres_and_brakes","title":"Wheels, tyres and brakes","items":[
  {"key":"wheels_tyres_and_brakes.wheel_bearing","label":"Wheel bearing"},
  {"key":"wheels_tyres_and_brakes.wheel_bolts","label":"Wheel bolts"},
  {"key":"wheels_tyres_and_brakes.wheel_condition_centre_cap","label":"Wheel condition + centre cap"},
  {"key":"wheels_tyres_and_brakes.tyres_valve_valve_cover","label":"Tyres + valve + valve cover"},
  {"key":"wheels_tyres_and_brakes.front_brake_discs","label":"Front brake discs"},
  {"key":"wheels_tyres_and_brakes.rear_brake_discs","label":"Rear brake discs"},
  {"key":"wheels_tyres_and_brakes.brake_pads","label":"Brake pads"},
  {"key":"wheels_tyres_and_brakes.brake_fluid_pipes_caliper_leak_piston_jam","label":"Brake fluid pipes / caliper leak / piston jam"},
  {"key":"wheels_tyres_and_brakes.brake_dust_cover","label":"Brake dust cover"}]},
 {"key":"electrical","title":"Electrical","items":[
  {"key":"electrical.main_battery","label":"Main battery"},
  {"key":"electrical.auxiliary_battery","label":"Auxiliary battery"},
  {"key":"electrical.left_headlight","label":"Left headlight"},
  {"key":"electrical.right_headlight","label":"Right headlight"},
  {"key":"electrical.left_tail_lamp_brake_light","label":"Left tail lamp + brake light"},
  {"key":"electrical.right_tail_lamp_brake_light","label":"Right tail lamp + brake light"},
  {"key":"electrical.side_view_mirrors","label":"Side view mirrors"},
  {"key":"electrical.alternator","label":"Alternator"},
  {"key":"electrical.starter_motor","label":"Starter motor"},
  {"key":"electrical.infotainment_system","label":"Infotainment system"},
  {"key":"electrical.parking_sensors","label":"Parking sensors"},
  {"key":"electrical.seats","label":"Seats"},
  {"key":"electrical.gear_shifter","label":"Gear shifter"},
  {"key":"electrical.parking_brakes","label":"Parking brakes"},
  {"key":"electrical.electric_power_steering","label":"Electric power steering"},
  {"key":"electrical.tyre_pressure_sensor","label":"Tyre pressure sensor"},
  {"key":"electrical.dashboard_warning_lights","label":"Dashboard warning lights"},
  {"key":"electrical.horn","label":"Horn"},
  {"key":"electrical.windows_sunroof_and_central_locking","label":"Windows, sunroof and central locking"},
  {"key":"electrical.interior_lights","label":"Interior lights"}]},
 {"key":"air_conditioning","title":"Air conditioning","items":[
  {"key":"air_conditioning.a_c_compressor","label":"A/C compressor"},
  {"key":"air_conditioning.condenser","label":"Condenser"},
  {"key":"air_conditioning.evaporator","label":"Evaporator"},
  {"key":"air_conditioning.expansion_valve","label":"Expansion valve"},
  {"key":"air_conditioning.a_c_pipes_and_hoses","label":"A/C pipes and hoses"},
  {"key":"air_conditioning.a_c_gas_level","label":"A/C gas level"},
  {"key":"air_conditioning.cabin_filter","label":"Cabin filter"}]},
 {"key":"other","title":"Other","items":[{"key":"other.other","label":"Other"}]}
]'::jsonb where key = 'inspection_checklist';
