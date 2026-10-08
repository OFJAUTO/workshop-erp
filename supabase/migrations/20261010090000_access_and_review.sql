-- Evening-testing changes: technician and workshop manager access in the database rules, manager review edits,
-- road tests by QC, special move requests, report links for customers, booking departments, owner "view as" log.

-- 1. Helpers --------------------------------------------------------------------------------
create or replace function public.is_technician()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('technician')
$$;
create or replace function public.current_staff_department()
returns text language sql stable security definer set search_path = public as $$
  select department_id from public.staff where id = auth.uid() and is_active = true
$$;
/** mechanical / bodyshop (incl. paint and PPF) / null for office departments. */
create or replace function public.current_side()
returns text language sql stable security definer set search_path = public as $$
  select case public.current_staff_department()
    when 'mechanical' then 'mechanical'
    when 'bodyshop' then 'bodyshop'
    when 'paint' then 'bodyshop'
    when 'ppf_tint' then 'bodyshop'
    else null end
$$;
/** Technicians see only the jobs assigned to them; everyone else sees every job. */
create or replace function public.can_see_job(p_job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_technician()
      or exists (select 1 from public.jobs j where j.id = p_job and j.assigned_to = auth.uid())
$$;
revoke all on function public.is_technician(), public.current_staff_department(), public.current_side(), public.can_see_job(uuid) from public, anon;

-- 2. Views that give limited information to limited roles ----------------------------------
create or replace view public.customer_public with (security_invoker = false) as
  select id, customer_number, full_name, company_name, is_vip, vip_note from public.customers where is_active;
revoke all on public.customer_public from public, anon;
grant select on public.customer_public to authenticated, service_role;

/** The technician's Workshop list: plate, make and model, assigned technician. Nothing else. */
create or replace view public.workshop_board with (security_invoker = false) as
  select j.id as job_id, j.job_number, j.status, j.stage, j.gated_in_at,
         v.has_plate, v.plate_country, v.plate_emirate, v.plate_code, v.plate_number, v.vin,
         mk.name as make, md.name as model,
         s.display_name as technician
  from public.jobs j
  join public.vehicles v on v.id = j.vehicle_id
  left join public.vehicle_makes mk on mk.id = v.make_id
  left join public.vehicle_models md on md.id = v.model_id
  left join public.staff s on s.id = j.assigned_to
  where j.is_open;
revoke all on public.workshop_board from public, anon;
grant select on public.workshop_board to authenticated, service_role;

-- 3. Read rules ----------------------------------------------------------------------------
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
  using (not public.has_role('technician', 'workshop_manager'));
drop policy if exists customer_contacts_read on public.customer_contacts;
create policy customer_contacts_read on public.customer_contacts for select to authenticated
  using (not public.has_role('technician', 'workshop_manager'));

drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select to authenticated
  using (not public.is_technician() or assigned_to = auth.uid());

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated
  using (
    case public.current_staff_role()
      when 'technician' then exists (select 1 from public.jobs j where j.vehicle_id = vehicles.id and j.assigned_to = auth.uid())
      when 'workshop_manager' then exists (select 1 from public.jobs j where j.vehicle_id = vehicles.id and j.is_open)
      else true end
  );
drop policy if exists vehicle_photos_read on public.vehicle_photos;
create policy vehicle_photos_read on public.vehicle_photos for select to authenticated
  using (not public.is_technician() or exists (select 1 from public.jobs j where j.vehicle_id = vehicle_photos.vehicle_id and j.assigned_to = auth.uid()));

drop policy if exists gate_ins_read on public.gate_ins;
create policy gate_ins_read on public.gate_ins for select to authenticated using (public.can_see_job(job_id));
drop policy if exists gate_in_media_read on public.gate_in_media;
create policy gate_in_media_read on public.gate_in_media for select to authenticated using (public.can_see_job(job_id));
drop policy if exists job_requests_read on public.job_requests;
create policy job_requests_read on public.job_requests for select to authenticated using (public.can_see_job(job_id));
drop policy if exists job_events_read on public.job_events;
create policy job_events_read on public.job_events for select to authenticated using (public.can_see_job(job_id));
drop policy if exists gate_outs_read on public.gate_outs;
create policy gate_outs_read on public.gate_outs for select to authenticated using (public.can_see_job(job_id));

drop policy if exists inspections_read on public.inspections;
create policy inspections_read on public.inspections for select to authenticated
  using (not public.is_technician() or technician_id = auth.uid());
do $$
declare t text;
begin
  foreach t in array array['inspection_items', 'inspection_findings', 'inspection_media', 'inspection_change_requests'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (not public.is_technician() or exists (select 1 from public.inspections i where i.id = %I.inspection_id and i.technician_id = auth.uid()))', t, t, t);
  end loop;
end $$;

-- Bookings: technicians none; workshop managers only their department's arrivals.
alter table public.appointments add column if not exists department text
  check (department is null or department in ('mechanical', 'bodyshop', 'both'));
drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments for select to authenticated
  using (
    case public.current_staff_role()
      when 'technician' then false
      when 'workshop_manager' then (department is null or department = 'both' or public.current_side() is null or department = public.current_side())
      else true end
  );

-- 4. Write rules: gate-in and customer/car editing are no longer the workshop manager's ----
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
            and policyname in ('customers_insert', 'customers_update', 'customer_contacts_insert', 'customer_contacts_update',
                               'vehicles_insert', 'vehicles_update', 'vehicle_photos_insert', 'jobs_insert', 'gate_ins_insert',
                               'gate_ins_update', 'gate_in_media_insert', 'job_requests_insert', 'job_requests_update',
                               'approval_requests_insert', 'approval_requests_update', 'gate_outs_insert') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
create policy customers_insert on public.customers for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy customers_update on public.customers for update to authenticated using (public.has_role('owner', 'service_advisor', 'gate_in')) with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy customer_contacts_insert on public.customer_contacts for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy customer_contacts_update on public.customer_contacts for update to authenticated using (public.has_role('owner', 'service_advisor', 'gate_in')) with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy vehicles_insert on public.vehicles for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy vehicles_update on public.vehicles for update to authenticated using (public.has_role('owner', 'service_advisor', 'gate_in')) with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy vehicle_photos_insert on public.vehicle_photos for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy jobs_insert on public.jobs for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy gate_ins_insert on public.gate_ins for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy gate_ins_update on public.gate_ins for update to authenticated using (public.has_role('owner', 'service_advisor', 'gate_in')) with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy gate_in_media_insert on public.gate_in_media for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy job_requests_insert on public.job_requests for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy job_requests_update on public.job_requests for update to authenticated using (public.has_role('owner', 'service_advisor', 'gate_in')) with check (public.has_role('owner', 'service_advisor', 'gate_in'));
create policy approval_requests_insert on public.approval_requests for insert to authenticated with check (public.has_role('owner', 'service_advisor'));
create policy approval_requests_update on public.approval_requests for update to authenticated using (public.has_role('owner', 'service_advisor')) with check (public.has_role('owner', 'service_advisor'));
create policy gate_outs_insert on public.gate_outs for insert to authenticated with check (public.has_role('owner', 'service_advisor', 'accounts'));
-- The workshop manager still updates jobs (assigning); technicians never write jobs directly.
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in', 'accounts'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in', 'accounts'));

-- 5. Manager review edits keep the technician's original --------------------------------------
alter table public.inspection_items
  add column if not exists edited_by uuid references public.staff (id),
  add column if not exists edited_at timestamptz,
  add column if not exists original jsonb;
alter table public.inspection_findings
  add column if not exists edited_by uuid references public.staff (id),
  add column if not exists edited_at timestamptz,
  add column if not exists original jsonb;
alter table public.inspections
  add column if not exists measurements_original jsonb,
  add column if not exists measurements_edited_by uuid references public.staff (id),
  add column if not exists measurements_edited_at timestamptz;

-- 6. Road tests by the QC inspector ------------------------------------------------------------
create table public.road_tests (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs (id) unique,
  inspector_id        uuid references public.staff (id),
  status              text not null default 'not_started' check (status in ('not_started', 'done', 'not_possible')),
  items               jsonb not null default '{}'::jsonb,   -- noises, vibration, pulling, gearbox, braking: {status, remarks}
  not_possible_reason text,
  started_at          timestamptz,
  done_at             timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.staff (id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.staff (id)
);
create trigger road_tests_audit_columns before insert or update on public.road_tests for each row execute function public.set_audit_columns();
create trigger road_tests_audit after insert or update on public.road_tests for each row execute function public.write_audit_log();
create trigger road_tests_no_delete before delete on public.road_tests for each row execute function public.prevent_delete();
alter table public.road_tests enable row level security;
create policy road_tests_read on public.road_tests for select to authenticated using (public.can_see_job(job_id));
create policy road_tests_insert on public.road_tests for insert to authenticated with check (public.has_role('owner', 'workshop_manager', 'qc_inspector'));
create policy road_tests_update on public.road_tests for update to authenticated using (public.has_role('owner', 'workshop_manager', 'qc_inspector')) with check (public.has_role('owner', 'workshop_manager', 'qc_inspector'));
-- Road test photos and videos live with the inspection files, keyed road.<item>.
drop policy if exists inspection_media_insert on public.inspection_media;
create policy inspection_media_insert on public.inspection_media for insert to authenticated with check (public.has_role('owner', 'workshop_manager', 'technician', 'service_advisor', 'qc_inspector'));

-- 7. Special move requests (owner decides) ----------------------------------------------------
create table public.move_requests (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id),
  requested_by    uuid references public.staff (id),
  reason          text not null,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  to_status       text,
  decided_by      uuid references public.staff (id),
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id)
);
create trigger move_requests_audit_columns before insert or update on public.move_requests for each row execute function public.set_audit_columns();
create trigger move_requests_audit after insert or update on public.move_requests for each row execute function public.write_audit_log();
create trigger move_requests_no_delete before delete on public.move_requests for each row execute function public.prevent_delete();
alter table public.move_requests enable row level security;
create policy move_requests_read on public.move_requests for select to authenticated using (public.can_see_job(job_id));
create policy move_requests_insert on public.move_requests for insert to authenticated with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy move_requests_update on public.move_requests for update to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));

-- 8. Inspection report links for customers ---------------------------------------------------
create table public.report_links (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id),
  inspection_id   uuid not null references public.inspections (id),
  token           text not null unique,
  status          text not null default 'created' check (status in ('created', 'sent', 'opened')),
  sent_at         timestamptz,
  sent_method     text,
  opened_at       timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id)
);
create trigger report_links_audit_columns before insert or update on public.report_links for each row execute function public.set_audit_columns();
create trigger report_links_audit after insert or update on public.report_links for each row execute function public.write_audit_log();
create trigger report_links_no_delete before delete on public.report_links for each row execute function public.prevent_delete();
alter table public.report_links enable row level security;
create policy report_links_read on public.report_links for select to authenticated using (not public.has_role('technician'));
create policy report_links_insert on public.report_links for insert to authenticated with check (public.has_role('owner', 'service_advisor'));
create policy report_links_update on public.report_links for update to authenticated using (public.has_role('owner', 'service_advisor')) with check (public.has_role('owner', 'service_advisor'));

alter publication supabase_realtime add table public.road_tests;
alter publication supabase_realtime add table public.move_requests;

-- 9. Settings and the stored checklist ---------------------------------------------------------
insert into public.settings (key, value, label, description) values
  ('inspection_unlock_hours', '1'::jsonb, 'Approved report opens for (hours)', 'After the owner approves a change request, the report can be edited for this long.'),
  ('whatsapp_report_template', to_jsonb('Dear [name], the inspection report for your [make model] ([plate]) is ready: [link]. Please read it and we will follow with the quotation. Thank you, [advisor], OFJ Automotive'::text), 'WhatsApp inspection report message', 'Placeholders: [name], [make model], [plate], [link], [advisor].')
on conflict (key) do nothing;
-- The road test moves to the QC inspector: drop that section from the saved checklist.
update public.settings
  set value = (select coalesce(jsonb_agg(s), '[]'::jsonb) from jsonb_array_elements(value) s where s->>'key' <> 'diagnostics_and_road_test')
  where key = 'inspection_checklist';
