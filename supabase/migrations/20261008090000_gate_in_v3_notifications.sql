-- =============================================================================
-- Gate-in v3 (owner feedback, 8 October 2026) and notifications
-- =============================================================================

-- 1. Makes and models added during gate-in go on a review list
alter table public.vehicle_makes add column if not exists needs_review boolean not null default false;
alter table public.vehicle_models add column if not exists needs_review boolean not null default false;
create policy vehicle_makes_review on public.vehicle_makes for update to authenticated
  using (public.has_role('owner', 'workshop_manager')) with check (public.has_role('owner', 'workshop_manager'));
create policy vehicle_models_review on public.vehicle_models for update to authenticated
  using (public.has_role('owner', 'workshop_manager')) with check (public.has_role('owner', 'workshop_manager'));

-- 2. Time in the current stage: remembered whenever the stage changes
alter table public.jobs add column if not exists stage_entered_at timestamptz not null default now();
create or replace function public.track_stage_entry()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage or new.status is distinct from old.status then
    new.stage_entered_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists jobs_stage_entry on public.jobs;
create trigger jobs_stage_entry before update on public.jobs
  for each row execute function public.track_stage_entry();

-- 3. Gate-in location, locked with the gate-in time
alter table public.gate_ins
  add column if not exists location_type text not null default 'branch'
    check (location_type in ('branch', 'customer', 'other')),
  add column if not exists location_name text,
  add column if not exists location_address text,
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision;

create or replace function public.protect_gate_in_location()
returns trigger
language plpgsql
as $$
begin
  if new.location_type is distinct from old.location_type
     or new.location_name is distinct from old.location_name
     or new.location_address is distinct from old.location_address
     or new.location_lat is distinct from old.location_lat
     or new.location_lng is distinct from old.location_lng then
    raise exception 'The gate-in location is recorded at gate-in and cannot be changed.' using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists gate_ins_protect_location on public.gate_ins;
create trigger gate_ins_protect_location before update on public.gate_ins
  for each row execute function public.protect_gate_in_location();

-- 4. Approval links: created, sent, opened, approved; terms saved in both languages
alter table public.approval_requests
  alter column sent_at drop not null,
  alter column sent_at drop default,
  add column if not exists sent_method text check (sent_method is null or sent_method in ('whatsapp', 'copy', 'tablet')),
  add column if not exists terms_text_ar text,
  add column if not exists declaration_text text,
  add column if not exists declaration_text_ar text,
  add column if not exists reminded_at timestamptz;
alter table public.approval_requests drop constraint if exists approval_requests_status_check;
alter table public.approval_requests add constraint approval_requests_status_check
  check (status in ('created', 'sent', 'opened', 'approved', 'cancelled'));
alter table public.approval_requests alter column status set default 'created';

-- 5. Notifications
create table public.notifications (
  id          bigint generated always as identity primary key,
  staff_id    uuid not null references public.staff (id),
  type        text not null,
  title       text not null,
  body        text,
  job_id      uuid references public.jobs (id),
  href        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_staff_idx on public.notifications (staff_id, read_at, created_at desc);

create table public.notification_preferences (
  staff_id    uuid not null references public.staff (id),
  type        text not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (staff_id, type)
);

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
revoke all on public.notifications from anon;
revoke all on public.notification_preferences from anon;
create policy notifications_own_read on public.notifications for select to authenticated using (staff_id = auth.uid());
create policy notifications_own_update on public.notifications for update to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid());
create policy notification_prefs_own on public.notification_preferences for all to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid());

-- 6. Live updates: let the browser listen for changes on these tables
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.gate_in_media;
alter publication supabase_realtime add table public.gate_ins;
alter publication supabase_realtime add table public.approval_requests;
alter publication supabase_realtime add table public.notifications;

-- 7. Bigger video files (phone camera recordings), 500 MB
update storage.buckets set file_size_limit = 524288000 where id = 'gate-in-media';

-- 8. Settings
update public.settings set value = '12', label = 'Video retention (months)',
  description = 'Gate-in videos are deleted automatically after this. Photos are kept forever.'
  where key = 'video_retention_months';

insert into public.settings (key, value, label, description, visibility) values
  ('stage_target_hours', '{"gate_in": 2, "inspection": 4, "quote": 4, "approval": 24, "parts": 48, "work": 24, "qc": 2, "wash": 2, "ready": 24}',
     'Target hours per stage', 'Without a promised date, a car turns amber past the target and red at double.', 'all'),
  ('branches', '[{"name": "OFJ Al Quoz", "address": "Al Quoz Industrial Area, Dubai"}]',
     'Branches', 'Workshop locations offered at gate-in. The first is the default.', 'all'),
  ('approval_reminder_hours', '4', 'Approval link reminder (hours)',
     'Remind the advisor if a sent approval link has not been opened within this many hours.', 'all'),
  ('whatsapp_approval_template',
     '"Dear [name], your [make model] ([plate]) has been received at OFJ Automotive. Please review the check-in video and job card, and approve so we can begin the inspection: [link]. Thank you, [advisor], OFJ Automotive"',
     'WhatsApp approval message', 'Placeholders: [name], [make model], [plate], [link], [advisor].', 'all'),
  ('terms_and_conditions_ar', '""', 'Terms and conditions (Arabic)', 'Shown right to left under the English terms.', 'all'),
  ('declaration_text',
     '"I agree to the terms and conditions and confirm I am the owner of the vehicle or a legal representative authorised to act on the owner''s behalf."',
     'Approval declaration (English)', 'The tick-box text on the customer approval page.', 'all'),
  ('declaration_text_ar',
     '"أوافق على الشروط والأحكام وأقر بأنني مالك المركبة أو ممثل قانوني مفوّض بالتصرف نيابةً عن المالك."',
     'Approval declaration (Arabic)', 'The tick-box text on the customer approval page, in Arabic.', 'all')
on conflict (key) do nothing;
