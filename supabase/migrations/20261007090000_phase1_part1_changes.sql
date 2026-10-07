-- =============================================================================
-- Phase 1, Part 1 changes (7 October 2026)
-- Gate-in role, car profile picture, new settings, sensitive settings visibility
-- =============================================================================

-- 1. New role: Gate-in
insert into public.roles (id, label, home_path, sort_order)
values ('gate_in', 'Gate-in', '/home', 4)
on conflict (id) do nothing;

-- 2. Car profile picture
alter table public.vehicles add column if not exists photo_path text;

-- 3. Settings visibility: some settings are for owner and accounts only
alter table public.settings
  add column if not exists visibility text not null default 'all'
  check (visibility in ('all', 'owner_accounts'));

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated
  using (visibility = 'all' or public.has_role('owner', 'accounts'));

insert into public.settings (key, value, label, description, visibility) values
  ('keep_signed_in_days_staff',          '30',    'Keep me signed in (days), office staff',       'How long a PC login lasts when "Keep me signed in" is ticked.', 'all'),
  ('keep_signed_in_days_owner_accounts', '1',     'Keep me signed in (days), owner and accounts', 'Shorter because these accounts see money.', 'all'),
  ('parts_min_markup_percent',           '20',    'Minimum parts markup (%)',                     'A quote cannot go out with a part marked up below this.', 'all'),
  ('parts_min_markup_by_make',           '{}',    'Minimum parts markup per brand',               'Overrides per make, for example Porsche 25.', 'all'),
  ('technician_cost_rate_aed',           '90',    'Technician cost rate (AED per hour)',          'Used for profit per job. Owner and accounts only.', 'owner_accounts'),
  ('technician_cost_rate_by_department', '{}',    'Technician cost rate per department',          'Overrides per department. Owner and accounts only.', 'owner_accounts'),
  ('daily_profit_target_aed',            '20000', 'Daily profit target (AED)',                    'Shown on the dashboard panel.', 'all'),
  ('working_days',                       '["mon","tue","wed","thu","fri","sat"]', 'Working days', 'Days that count towards the daily target.', 'all'),
  ('profit_target_yellow_percent',       '80',    'Target yellow threshold (%)',                  'Below this the panel is red; at or above, yellow; at 100, green.', 'all'),
  ('supplier_invoice_pending_red_days',  '7',     'Pending supplier invoice turns red after (days)', 'Used from the parts phase.', 'all')
on conflict (key) do nothing;

-- 4. Give the Gate-in role the same customer and car rights as advisors
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in', 'parts', 'qc_inspector', 'accounts'));
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));

drop policy if exists customer_contacts_read on public.customer_contacts;
create policy customer_contacts_read on public.customer_contacts for select to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in', 'parts', 'qc_inspector', 'accounts'));
drop policy if exists customer_contacts_insert on public.customer_contacts;
create policy customer_contacts_insert on public.customer_contacts for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
drop policy if exists customer_contacts_update on public.customer_contacts;
create policy customer_contacts_update on public.customer_contacts for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));

drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));

drop policy if exists vehicle_photos_insert on public.vehicle_photos;
create policy vehicle_photos_insert on public.vehicle_photos for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));

drop policy if exists vehicle_makes_insert on public.vehicle_makes;
create policy vehicle_makes_insert on public.vehicle_makes for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
drop policy if exists vehicle_models_insert on public.vehicle_models;
create policy vehicle_models_insert on public.vehicle_models for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));

drop policy if exists vehicle_photos_storage_insert on storage.objects;
create policy vehicle_photos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos'
              and public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
