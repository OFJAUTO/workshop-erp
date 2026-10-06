-- =============================================================================
-- Workshop ERP - Phase 1: Foundation
-- Tables: roles, departments, staff, staff_private, devices, customers,
--         customer_contacts, vehicle_makes, vehicle_models, vehicles,
--         vehicle_photos, audit_log, settings
-- Rules: row level security per role, automatic change log, no deletes,
--        created/updated stamps that cannot be forged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Reference tables
-- -----------------------------------------------------------------------------
create table public.roles (
  id          text primary key,
  label       text not null,
  home_path   text not null,
  sort_order  integer not null
);

insert into public.roles (id, label, home_path, sort_order) values
  ('owner',            'Owner',            '/home', 1),
  ('workshop_manager', 'Workshop manager', '/home', 2),
  ('service_advisor',  'Service advisor',  '/home', 3),
  ('technician',       'Technician',       '/home', 4),
  ('parts',            'Parts',            '/home', 5),
  ('qc_inspector',     'QC inspector',     '/home', 6),
  ('accounts',         'Accounts',         '/home', 7);

create table public.departments (
  id          text primary key,
  label       text not null,
  sort_order  integer not null
);

insert into public.departments (id, label, sort_order) values
  ('mechanical', 'Mechanical',   1),
  ('bodyshop',   'Bodyshop',     2),
  ('paint',      'Paint',        3),
  ('ppf_tint',   'PPF and tint', 4),
  ('office',     'Office',       5);

-- -----------------------------------------------------------------------------
-- 2. Staff
-- -----------------------------------------------------------------------------
create table public.staff (
  id                  uuid primary key references auth.users (id) on delete restrict,
  full_name           text not null,
  display_name        text not null,
  role_id             text not null references public.roles (id),
  department_id       text references public.departments (id),
  employee_number     text unique,
  login_type          text not null check (login_type in ('password', 'pin')),
  is_head_accountant  boolean not null default false,
  photo_path          text,
  is_active           boolean not null default true,
  disabled_at         timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.staff (id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.staff (id)
);

-- Sensitive staff data lives apart so ordinary roles can never read it.
create table public.staff_private (
  staff_id             uuid primary key references public.staff (id) on delete cascade,
  phone                text,
  email                text,
  pin_hash             text,
  pin_failed_attempts  integer not null default 0,
  pin_locked_until     timestamptz,
  pin_updated_at       timestamptz,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.staff (id)
);

-- -----------------------------------------------------------------------------
-- 3. Registered tablets
-- -----------------------------------------------------------------------------
create table public.devices (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  location       text not null check (location in ('workshop', 'bodyshop', 'office')),
  token_hash     text not null unique,
  is_active      boolean not null default true,
  registered_at  timestamptz not null default now(),
  registered_by  uuid references public.staff (id),
  last_seen_at   timestamptz,
  last_staff_id  uuid references public.staff (id),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);

-- -----------------------------------------------------------------------------
-- 4. Customers
-- -----------------------------------------------------------------------------
create sequence public.customer_number_seq start 1;

create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  customer_number  text not null unique
                   default ('C-' || lpad(nextval('public.customer_number_seq')::text, 5, '0')),
  customer_type    text not null check (customer_type in ('individual', 'company')),
  full_name        text not null,
  company_name     text,
  phone            text not null,
  phone2           text,
  email            text,
  area             text,
  trn              text,
  is_vip           boolean not null default false,
  vip_note         text,
  notes            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.staff (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.staff (id),
  constraint customers_company_name_required
    check (customer_type <> 'company' or company_name is not null)
);

create index customers_phone_idx on public.customers (phone);
create index customers_name_idx on public.customers (lower(full_name));
create index customers_company_idx on public.customers (lower(company_name));

create table public.customer_contacts (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id),
  name          text not null,
  phone         text not null,
  relationship  text,
  can_approve   boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.staff (id)
);

create index customer_contacts_customer_idx on public.customer_contacts (customer_id);

-- -----------------------------------------------------------------------------
-- 5. Vehicles
-- -----------------------------------------------------------------------------
create table public.vehicle_makes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);

create table public.vehicle_models (
  id         uuid primary key default gen_random_uuid(),
  make_id    uuid not null references public.vehicle_makes (id),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id),
  unique (make_id, name)
);

create table public.vehicles (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers (id),
  plate_country  text not null default 'UAE',
  plate_emirate  text check (plate_emirate is null or plate_emirate in
                   ('Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah')),
  plate_code     text,
  plate_number   text not null,
  vin            text unique check (vin is null or char_length(vin) = 17),
  make_id        uuid not null references public.vehicle_makes (id),
  model_id       uuid references public.vehicle_models (id),
  variant        text,
  model_year     integer check (model_year is null or (model_year between 1950 and 2100)),
  colour         text,
  fuel_type      text check (fuel_type is null or fuel_type in ('petrol', 'diesel', 'hybrid', 'electric')),
  last_mileage   integer check (last_mileage is null or last_mileage >= 0),
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id),
  constraint vehicles_uae_plate_needs_emirate
    check (plate_country <> 'UAE' or plate_emirate is not null)
);

-- One active car per plate. An inactive (sold or scrapped) car frees the plate.
create unique index vehicles_active_plate_idx on public.vehicles
  (plate_country, coalesce(plate_emirate, ''), coalesce(plate_code, ''), plate_number)
  where is_active;

create index vehicles_customer_idx on public.vehicles (customer_id);
create index vehicles_plate_number_idx on public.vehicles (plate_number);

create table public.vehicle_photos (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references public.vehicles (id),
  storage_path  text not null unique,
  caption       text,
  taken_at      timestamptz not null default now(),
  uploaded_by   uuid references public.staff (id),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.staff (id)
);

create index vehicle_photos_vehicle_idx on public.vehicle_photos (vehicle_id);

-- -----------------------------------------------------------------------------
-- 6. Change log and settings
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_changed_at_idx on public.audit_log (changed_at desc);

create table public.settings (
  key          text primary key,
  value        jsonb not null,
  label        text not null,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff (id)
);

insert into public.settings (key, value, label, description) values
  ('company_name',             '"Your workshop"', 'Company name',                   'Shown on screens and documents.'),
  ('company_trn',              '""',              'Company TRN',                    'Tax registration number for tax invoices.'),
  ('tablet_idle_lock_seconds', '120',             'Tablet idle lock (seconds)',     'A shared tablet locks after this much inactivity.'),
  ('pin_max_attempts',         '5',               'Wrong PIN attempts before lock', 'After this many wrong PINs the name is locked for a while.'),
  ('pin_lock_minutes',         '5',               'PIN lock time (minutes)',        'How long a name stays locked after too many wrong PINs.'),
  ('discount_limit_percent',   '25',              'Advisor discount limit (%)',     'Discounts above this go to the owner.'),
  ('video_retention_months',   '6',               'Gate-in video retention (months)', 'Gate-in videos are deleted automatically after this.'),
  ('terms_and_conditions',     '""',              'Terms and conditions',           'Text the customer agrees to when approving a job.');

-- -----------------------------------------------------------------------------
-- 7. Helper functions used by the access rules
-- -----------------------------------------------------------------------------
create or replace function public.current_staff_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role_id from public.staff where id = auth.uid() and is_active = true
$$;

create or replace function public.has_role(variadic wanted text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role() = any (wanted), false)
$$;

create or replace function public.is_owner()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.has_role('owner')
$$;

revoke all on function public.current_staff_role() from public, anon;
revoke all on function public.has_role(text[]) from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.current_staff_role() to authenticated, service_role;
grant execute on function public.has_role(text[]) to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Triggers: stamps, change log, no deletes
-- -----------------------------------------------------------------------------
create or replace function public.set_audit_columns()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_at := now();
    new.updated_by := coalesce(new.updated_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end
$$;

create or replace function public.set_updated_columns()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id  text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - 'pin_hash' - 'token_hash';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - 'pin_hash' - 'token_hash';
  end if;
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id',
                   v_new ->> 'staff_id', v_old ->> 'staff_id',
                   v_new ->> 'key', v_old ->> 'key');
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name, v_id, tg_op, v_old, v_new, auth.uid());
  return coalesce(new, old);
end
$$;

create or replace function public.prevent_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Records in % are never deleted. Mark them inactive instead.', tg_table_name
    using errcode = 'P0001';
end
$$;

-- Apply to every business table.
do $$
declare
  t text;
begin
  foreach t in array array['staff', 'devices', 'customers', 'customer_contacts',
                           'vehicle_makes', 'vehicle_models', 'vehicles', 'vehicle_photos']
  loop
    execute format('create trigger %I_stamps before insert or update on public.%I
                    for each row execute function public.set_audit_columns()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.write_audit_log()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I
                    for each row execute function public.prevent_delete()', t, t);
  end loop;
end
$$;

create trigger staff_private_stamps before update on public.staff_private
  for each row execute function public.set_updated_columns();
create trigger staff_private_audit after insert or update or delete on public.staff_private
  for each row execute function public.write_audit_log();
create trigger staff_private_no_delete before delete on public.staff_private
  for each row execute function public.prevent_delete();

create trigger settings_stamps before update on public.settings
  for each row execute function public.set_updated_columns();
create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function public.write_audit_log();

create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.prevent_delete();

-- -----------------------------------------------------------------------------
-- 9. Access rules (row level security)
-- -----------------------------------------------------------------------------
alter table public.roles             enable row level security;
alter table public.departments       enable row level security;
alter table public.staff             enable row level security;
alter table public.staff_private     enable row level security;
alter table public.devices           enable row level security;
alter table public.customers         enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.vehicle_makes     enable row level security;
alter table public.vehicle_models    enable row level security;
alter table public.vehicles          enable row level security;
alter table public.vehicle_photos    enable row level security;
alter table public.audit_log         enable row level security;
alter table public.settings          enable row level security;

-- The public (not logged in) role gets nothing.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Reference lists: everyone who is logged in can read.
create policy roles_read on public.roles for select to authenticated using (true);
create policy departments_read on public.departments for select to authenticated using (true);

-- Staff directory: names, roles and photos are visible to all staff.
create policy staff_read on public.staff for select to authenticated
  using (is_active or public.is_owner() or id = auth.uid());
create policy staff_insert on public.staff for insert to authenticated
  with check (public.is_owner());
create policy staff_update on public.staff for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Private staff data: owner only.
create policy staff_private_owner_read on public.staff_private for select to authenticated
  using (public.is_owner());
create policy staff_private_owner_insert on public.staff_private for insert to authenticated
  with check (public.is_owner());
create policy staff_private_owner_update on public.staff_private for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Tablets: owner and workshop manager can see; owner can change.
create policy devices_read on public.devices for select to authenticated
  using (public.has_role('owner', 'workshop_manager'));
create policy devices_insert on public.devices for insert to authenticated
  with check (public.is_owner());
create policy devices_update on public.devices for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Customers: everyone except technicians can read; owner, manager, advisor can write.
create policy customers_read on public.customers for select to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'parts', 'qc_inspector', 'accounts'));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy customers_update on public.customers for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));

create policy customer_contacts_read on public.customer_contacts for select to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'parts', 'qc_inspector', 'accounts'));
create policy customer_contacts_insert on public.customer_contacts for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy customer_contacts_update on public.customer_contacts for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));

-- Technicians only ever see the VIP badge and handling note, never name or phone.
create view public.customer_vip_flags
  with (security_invoker = false) as
  select id, is_vip, vip_note from public.customers where is_active;
revoke all on public.customer_vip_flags from public, anon;
grant select on public.customer_vip_flags to authenticated, service_role;

-- Cars: all staff can read; owner, manager, advisor can write.
create policy vehicles_read on public.vehicles for select to authenticated using (true);
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));

create policy vehicle_photos_read on public.vehicle_photos for select to authenticated using (true);
create policy vehicle_photos_insert on public.vehicle_photos for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
-- No update or delete policy: photos can be added but never changed or removed.

create policy vehicle_makes_read on public.vehicle_makes for select to authenticated using (true);
create policy vehicle_makes_insert on public.vehicle_makes for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy vehicle_makes_update on public.vehicle_makes for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy vehicle_models_read on public.vehicle_models for select to authenticated using (true);
create policy vehicle_models_insert on public.vehicle_models for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy vehicle_models_update on public.vehicle_models for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Change log: owner reads; only the trigger writes.
create policy audit_log_owner_read on public.audit_log for select to authenticated
  using (public.is_owner());

-- Settings: all staff read; owner changes.
create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy settings_insert on public.settings for insert to authenticated
  with check (public.is_owner());

-- -----------------------------------------------------------------------------
-- 10. Photo storage (private buckets; files can be added, never deleted)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('staff-photos',   'staff-photos',   false,  5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('vehicle-photos', 'vehicle-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy staff_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'staff-photos');
create policy staff_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-photos' and public.is_owner());

create policy vehicle_photos_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-photos');
create policy vehicle_photos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-photos'
              and public.has_role('owner', 'workshop_manager', 'service_advisor'));

-- -----------------------------------------------------------------------------
-- 11. Starting lists of makes and models (the owner can add more)
-- -----------------------------------------------------------------------------
insert into public.vehicle_makes (name) values
  ('Porsche'), ('Bentley'), ('Rolls-Royce'), ('Lamborghini'), ('Ferrari'),
  ('Aston Martin'), ('Maserati'), ('McLaren'), ('Mercedes-Benz'), ('BMW'),
  ('Audi'), ('Land Rover'), ('Lexus'), ('Toyota'), ('Nissan');

insert into public.vehicle_models (make_id, name)
select m.id, x.model
from public.vehicle_makes m
join (values
  ('Porsche', '911'), ('Porsche', 'Taycan'), ('Porsche', 'Panamera'), ('Porsche', 'Cayenne'),
  ('Porsche', 'Macan'), ('Porsche', '718 Boxster'), ('Porsche', '718 Cayman'),
  ('Bentley', 'Continental GT'), ('Bentley', 'Continental GTC'), ('Bentley', 'Flying Spur'),
  ('Bentley', 'Bentayga'), ('Bentley', 'Mulsanne'),
  ('Rolls-Royce', 'Ghost'), ('Rolls-Royce', 'Cullinan'), ('Rolls-Royce', 'Phantom'),
  ('Rolls-Royce', 'Wraith'), ('Rolls-Royce', 'Dawn'), ('Rolls-Royce', 'Spectre'),
  ('Lamborghini', 'Urus'), ('Lamborghini', 'Huracan'), ('Lamborghini', 'Aventador'), ('Lamborghini', 'Revuelto'),
  ('Ferrari', 'Roma'), ('Ferrari', 'Purosangue'), ('Ferrari', '296'), ('Ferrari', 'SF90'), ('Ferrari', 'F8'),
  ('Aston Martin', 'DB12'), ('Aston Martin', 'DBX'), ('Aston Martin', 'Vantage'),
  ('Maserati', 'Levante'), ('Maserati', 'Ghibli'), ('Maserati', 'Grecale'), ('Maserati', 'MC20'),
  ('McLaren', '720S'), ('McLaren', '750S'), ('McLaren', 'GT'), ('McLaren', 'Artura'),
  ('Mercedes-Benz', 'G-Class'), ('Mercedes-Benz', 'S-Class'), ('Mercedes-Benz', 'AMG GT'),
  ('BMW', 'X7'), ('BMW', '7 Series'), ('BMW', 'M5'),
  ('Audi', 'RS6'), ('Audi', 'Q8'), ('Audi', 'R8'),
  ('Land Rover', 'Range Rover'), ('Land Rover', 'Range Rover Sport'), ('Land Rover', 'Defender'),
  ('Lexus', 'LX'), ('Toyota', 'Land Cruiser'), ('Nissan', 'Patrol')
) as x(make, model) on x.make = m.name;
