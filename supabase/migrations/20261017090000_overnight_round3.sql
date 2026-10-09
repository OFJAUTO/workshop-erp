-- Overnight round 3 (9 to 10 October 2026): the owner's test from quotation to payment.
-- Quotation redesign (findings, parts linked to labour, rounding, recovery provider), planning inside the
-- Parts step, several technicians per car with pauses and "job finished", parts handover with one PIN,
-- payment rules (no doubles, no overpayment, voids, verification), the wash timing, job summaries,
-- comeback jobs, and the settings behind all of it.

-- 1. Quotations ---------------------------------------------------------------------------------------
alter table public.quotations add column if not exists not_quoted jsonb not null default '{}'::jsonb;
alter table public.quotations add column if not exists rounded_total_aed numeric(12,2);
alter table public.quotations add column if not exists estimated_days integer;
alter table public.quotations add column if not exists declined_note text;
alter table public.quotation_lines add column if not exists parent_line_id uuid references public.quotation_lines (id);
alter table public.quotation_lines add column if not exists recovery_provider_kind text check (recovery_provider_kind is null or recovery_provider_kind in ('ours', 'external', 'customer'));
alter table public.quotation_lines add column if not exists markup_confirmed boolean not null default false;
create index if not exists quotation_lines_parent_idx on public.quotation_lines (parent_line_id);
-- "Recommended" is gone: a labour line is Urgent or nothing.
update public.quotation_lines set urgency = null where urgency = 'recommended';
-- Part type and brand on lines priced before those columns existed.
update public.quotation_lines l set part_type = p.part_type, brand = p.brand
  from public.part_items p where l.part_item_id = p.id and l.part_type is null and p.part_type is not null;

-- 2. Jobs: planning (inside the Parts step), job finished, wash timing, comebacks, the summary --------
alter table public.jobs add column if not exists plan_parts_done_at timestamptz;
alter table public.jobs add column if not exists plan_parts_by uuid references public.staff (id);
alter table public.jobs add column if not exists plan_parts_ready_date date;
alter table public.jobs add column if not exists plan_start_date date;
alter table public.jobs add column if not exists plan_released_at timestamptz;
alter table public.jobs add column if not exists plan_released_by uuid references public.staff (id);
alter table public.jobs add column if not exists plan_release_note text;
alter table public.jobs add column if not exists plan_date_confirmed_at timestamptz;
alter table public.jobs add column if not exists plan_date_confirmed_by uuid references public.staff (id);
alter table public.jobs add column if not exists plan_reminded_at timestamptz;
alter table public.jobs add column if not exists work_done_at timestamptz;
alter table public.jobs add column if not exists work_sendbacks integer not null default 0;
alter table public.jobs add column if not exists wash_sent_at timestamptz;
alter table public.jobs add column if not exists wash_sent_by uuid references public.staff (id);
alter table public.jobs add column if not exists comeback_of uuid references public.jobs (id);
alter table public.jobs add column if not exists comeback_cause text check (comeback_cause is null or comeback_cause in ('workmanship', 'faulty_part', 'unrelated', 'customer_caused'));
alter table public.jobs add column if not exists comeback_cause_by uuid references public.staff (id);
alter table public.jobs add column if not exists comeback_cause_at timestamptz;
alter table public.jobs add column if not exists comeback_confirmed_by uuid references public.staff (id);
alter table public.jobs add column if not exists comeback_confirmed_at timestamptz;
alter table public.jobs add column if not exists comeback_free boolean not null default false;
alter table public.jobs add column if not exists comeback_claim_status text not null default 'none' check (comeback_claim_status in ('none', 'to_claim', 'claimed', 'paid'));
alter table public.jobs add column if not exists comeback_claim_amount numeric(12,2);
alter table public.jobs add column if not exists comeback_claim_po uuid references public.purchase_orders (id);
alter table public.jobs add column if not exists comeback_claim_supplier text;
alter table public.jobs add column if not exists summary jsonb;
alter table public.jobs add column if not exists summary_verdict text check (summary_verdict is null or summary_verdict in ('good', 'acceptable', 'talk'));
alter table public.jobs add column if not exists summary_at timestamptz;
alter table public.jobs add column if not exists summary_comment text;
alter table public.jobs add column if not exists summary_comment_by uuid references public.staff (id);
create index if not exists jobs_comeback_of_idx on public.jobs (comeback_of);

-- 3. Several technicians per car, pauses with reasons, the parts handover -----------------------------
create table if not exists public.job_technicians (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id),
  staff_id           uuid not null references public.staff (id),
  added_by           uuid references public.staff (id),
  added_at           timestamptz not null default now(),
  left_at            timestamptz,
  left_reason        text,
  done_at            timestamptz,
  manager_sendbacks  integer not null default 0,
  qc_sendbacks       integer not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);
create index if not exists job_technicians_job_idx on public.job_technicians (job_id);
create index if not exists job_technicians_staff_idx on public.job_technicians (staff_id);

create table if not exists public.work_pauses (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id),
  technician_id  uuid not null references public.staff (id),
  reason         text not null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  minutes        integer,
  accepted       boolean not null default true,
  rejected_by    uuid references public.staff (id),
  rejected_at    timestamptz,
  note           text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);
create index if not exists work_pauses_job_idx on public.work_pauses (job_id);
create index if not exists work_pauses_tech_idx on public.work_pauses (technician_id, started_at desc);

create table if not exists public.part_handovers (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id),
  kind           text not null check (kind in ('handover', 'return')),
  from_staff     uuid references public.staff (id),
  to_staff       uuid references public.staff (id),
  confirmed_by   uuid references public.staff (id),
  pin_used       boolean not null default false,
  signed_for_by  uuid references public.staff (id),
  items          jsonb not null default '[]'::jsonb,
  note           text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);
create index if not exists part_handovers_job_idx on public.part_handovers (job_id, created_at desc);
alter table public.part_items add column if not exists handover_id uuid references public.part_handovers (id);
alter table public.part_items add column if not exists fitted_at timestamptz;

-- 4. Payments: one receipt per payment, no overpayment without the owner, voids, verification ----------
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check check (status in ('recorded', 'reversed', 'voided', 'pending_owner'));
alter table public.payments add column if not exists void_reason text;
alter table public.payments add column if not exists voided_by uuid references public.staff (id);
alter table public.payments add column if not exists voided_at timestamptz;
alter table public.payments add column if not exists verified_at timestamptz;
alter table public.payments add column if not exists verified_by uuid references public.staff (id);
alter table public.payments add column if not exists approval_requested_by uuid references public.staff (id);
alter table public.payments add column if not exists approved_by uuid references public.staff (id);
alter table public.payments add column if not exists approved_at timestamptz;
alter table public.payments add column if not exists client_key text;
create unique index if not exists payments_client_key_idx on public.payments (client_key) where client_key is not null;
alter table public.invoices add column if not exists payment_link_url text;
alter table public.invoices add column if not exists warranty_credit_aed numeric(12,2) not null default 0;
-- The receipt recorded twice tonight (RCT-00002 and RCT-00003, same amount, same minute): the second is voided.
update public.payments set status = 'voided', void_reason = 'Duplicate of RCT-00002: the same payment was recorded twice in one minute', voided_at = now()
  where number = 'RCT-00003' and status = 'recorded';

-- 5. PINs personal: a PIN set by the owner must be changed on first use; the wash board device kind ---
alter table public.staff_private add column if not exists pin_must_change boolean not null default false;
alter table public.devices drop constraint if exists devices_kind_check;
alter table public.devices add constraint devices_kind_check check (kind in ('shared', 'personal', 'board'));

-- 6. Stamps, change log, no deletes, access ----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['job_technicians', 'work_pauses', 'part_handovers'] loop
    execute format('create trigger %I_audit_columns before insert or update on public.%I for each row execute function public.set_audit_columns()', t, t);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function public.write_audit_log()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.prevent_delete()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
  end loop;
end $$;
alter publication supabase_realtime add table public.job_technicians, public.work_pauses, public.part_handovers;

-- 7. Settings -------------------------------------------------------------------------------------------
insert into public.settings (key, value, label, description) values
  ('notification_tone', '"marimba"'::jsonb, 'Notification sound', 'The workshop default: marimba, bell, pop or chord. Each person can pick their own from the bell.'),
  ('notification_tone_owner', '"chord"'::jsonb, 'Owner approval sound', 'The sound for things that need the owner''s approval.'),
  ('notification_remind_minutes', '2'::jsonb, 'Reminder while unread (minutes)', 'A gentle reminder sound every so many minutes while something is unread.'),
  ('markup_warn_percent', '50'::jsonb, 'High markup warning from (%)', 'From this markup a part shows an amber "check before sending".'),
  ('markup_confirm_percent', '100'::jsonb, 'Markup confirmation from (%)', 'From this markup the advisor must confirm the selling price before it saves.'),
  ('pin_needed_above_aed', '100'::jsonb, 'Parts handover PIN needed above (AED)', 'Consumables below this value are handed over without a PIN, only logged.'),
  ('wash_board_show_times', 'false'::jsonb, 'Wash board: show needed-by times', 'Switch on later to show a needed-by time on every tile.'),
  ('wash_board_done_button', 'false'::jsonb, 'Wash board: Done button on tiles', 'Switch on later to let the washer mark a car done from the board.'),
  ('comeback_window_days', '90'::jsonb, 'Comeback window (days)', 'At gate-in, a car that was here within this many days is asked whether it is a comeback.'),
  ('recovery_providers', '[]'::jsonb, 'External recovery companies', 'Names used before, offered again on the recovery line.'),
  ('labour_job_candidates', '{}'::jsonb, 'Labour jobs waiting for approval', 'Descriptions advisors built more than once; the owner adds them to the permanent list.'),
  ('labour_jobs', $j${
    "Service": ["Minor service", "Major service", "Engine oil and filter change", "Air filter replacement", "Cabin filter replacement", "Spark plug replacement", "Ignition coil replacement", "Fuel filter replacement", "Service reset"],
    "Engine": ["Valve cover gasket replacement", "Oil pan gasket replacement", "Oil filter housing gasket replacement", "Front crankshaft seal replacement", "Rear main seal replacement", "Timing chain replacement", "Timing chain tensioner replacement", "Timing cover reseal", "Drive belt replacement", "Belt tensioner and pulley replacement", "Engine mount replacement", "Oil cooler reseal", "Vacuum pump reseal", "PCV / oil separator replacement", "Intake manifold removal and refit", "Carbon cleaning (intake valves)", "Compression test", "Leak-down test", "Engine removal and refit"],
    "Fuel": ["Fuel injector service", "Fuel injector replacement", "Fuel pump replacement", "High pressure fuel pump replacement", "Fuel line replacement", "Throttle body cleaning", "Fuel system cleaning"],
    "Turbo, supercharger, exhaust": ["Turbocharger replacement", "Turbo oil line replacement", "Intercooler replacement", "Intercooler hose replacement", "Supercharger service", "Supercharger belt replacement", "O2 sensor replacement", "Catalytic converter replacement", "Exhaust leak repair"],
    "Cooling": ["Coolant flush", "Radiator replacement", "Water pump replacement", "Thermostat replacement", "Coolant hose replacement", "Coolant expansion tank replacement", "Radiator fan replacement", "Cooling system pressure test"],
    "A/C": ["A/C gas recharge", "A/C leak test", "A/C compressor replacement", "A/C condenser replacement", "A/C evaporator replacement", "Expansion valve replacement", "A/C pipe replacement", "Blower motor replacement", "A/C system flush"],
    "Brakes": ["Brake pad replacement", "Brake disc replacement", "Brake disc skimming", "Brake pad wear sensor replacement", "Brake fluid flush", "Brake caliper service", "Brake caliper replacement", "Brake hose replacement", "Parking brake adjustment", "Parking brake motor replacement"],
    "Suspension and steering": ["Shock absorber replacement", "Air strut replacement", "Air suspension compressor replacement", "Air suspension valve block replacement", "Control arm replacement", "Control arm bushing replacement", "Ball joint replacement", "Stabiliser link replacement", "Stabiliser bar bushing replacement", "Tie rod end replacement", "Steering rack replacement", "Power steering fluid flush", "Power steering pump replacement", "Wheel bearing replacement", "Wheel alignment", "Ride height calibration"],
    "Transmission and driveline": ["Transmission service (oil and filter)", "Transmission pan gasket replacement", "Mechatronic / valve body replacement", "Transmission mount replacement", "Transmission removal and refit", "Clutch replacement", "Differential oil change", "Transfer case oil change", "Driveshaft replacement", "CV boot replacement", "Propeller shaft coupling replacement"],
    "Electrical": ["Battery replacement", "Auxiliary battery replacement", "Battery registration", "Alternator replacement", "Starter motor replacement", "Diagnosis (per hour)", "Wiring repair", "Software update / coding", "Sensor replacement", "Bulb replacement", "Headlight replacement", "Wiper blade replacement", "Window regulator replacement", "Door lock actuator replacement"],
    "Wheels and tyres": ["Tyre replacement", "Wheel balancing", "Puncture repair", "Tyre rotation", "TPMS sensor replacement"],
    "Other": ["Road test", "Pre-purchase inspection", "Outside work"]
  }$j$::jsonb, 'Ready-made labour jobs', 'The pick-list advisors choose labour descriptions from, by group. One job per line under its group on the Settings page.')
on conflict (key) do nothing;
update public.settings set value = '["Remove and replace", "Remove and refit", "Remove and clean", "Remove and inspect", "Repair", "Reseal", "Replace", "Service", "Clean", "Inspect", "Install", "Refill", "Overhaul", "Adjust", "Tighten", "Lubricate", "Skim", "Bleed", "Flush", "Drain and refill", "Top up", "Recharge", "Balance", "Align", "Calibrate", "Program or code", "Reset", "Diagnose", "Test", "Road test"]'::jsonb
  where key = 'labour_actions';
