-- =============================================================================
-- Phase 2: gate-in, job cards, customer approval, floor board, gate-out
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Job cards
-- -----------------------------------------------------------------------------
create sequence public.job_number_seq start 1;

create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  job_number       text not null unique
                   default ('J-' || lpad(nextval('public.job_number_seq')::text, 5, '0')),
  vehicle_id       uuid not null references public.vehicles (id),
  customer_id      uuid not null references public.customers (id),
  -- The nine-step track shown on every card
  stage            text not null default 'gate_in'
                   check (stage in ('gate_in','inspection','quote','approval','parts','work','qc','wash','ready')),
  -- Status in plain words is derived from these
  status           text not null default 'gate_in_pending'
                   check (status in ('gate_in_pending','pending_approval','pending_inspection','in_inspection',
                                     'pending_quote','pending_customer_approval','approved','waiting_parts',
                                     'in_work','pending_qc','pending_wash','ready','pending_payment','closed')),
  priority         text not null default 'normal' check (priority in ('high','normal','low')),
  promised_at      date,
  assigned_to      uuid references public.staff (id),
  assigned_at      timestamptz,
  gated_in_at      timestamptz not null default now(),
  gated_in_by      uuid not null references public.staff (id),
  gated_out_at     timestamptz,
  gated_out_by     uuid references public.staff (id),
  first_approval_at timestamptz,
  is_open          boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.staff (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.staff (id)
);

create index jobs_open_idx on public.jobs (is_open, priority, promised_at);
create index jobs_vehicle_idx on public.jobs (vehicle_id);
create index jobs_customer_idx on public.jobs (customer_id);

-- Gate-in and gate-out stamps can never be changed by anyone, including the owner.
create or replace function public.protect_job_stamps()
returns trigger
language plpgsql
as $$
begin
  if new.gated_in_at is distinct from old.gated_in_at or new.gated_in_by is distinct from old.gated_in_by then
    raise exception 'Gate-in time and user are set automatically and cannot be changed.' using errcode = 'P0001';
  end if;
  if old.gated_out_at is not null and
     (new.gated_out_at is distinct from old.gated_out_at or new.gated_out_by is distinct from old.gated_out_by) then
    raise exception 'Gate-out time and user are set automatically and cannot be changed.' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger jobs_protect_stamps before update on public.jobs
  for each row execute function public.protect_job_stamps();

-- -----------------------------------------------------------------------------
-- 2. Gate-in record (one per job)
-- -----------------------------------------------------------------------------
create table public.gate_ins (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null unique references public.jobs (id),
  arrived_by         text not null check (arrived_by in ('our_recovery','customer_drove','customer_driver','outside_recovery')),
  condition          text not null check (condition in ('runs_drives','needs_assistance','does_not_run')),
  fuel_level         text check (fuel_level in ('empty','quarter','half','three_quarters','full')),
  battery_percent    integer check (battery_percent is null or (battery_percent between 0 and 100)),
  cleanliness        text not null check (cleanliness in ('clean','average','dirty','very_dirty')),
  dash_cam           boolean not null default false,
  mileage            integer not null check (mileage >= 0),
  keys_count         integer not null check (keys_count between 0 and 10),
  keys_keychain      boolean not null default false,
  customer_requests  text not null,
  notes              text,
  old_parts_return   boolean not null default false,
  is_complete        boolean not null default false,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);

-- Photos and the walk-around video. Rows can be added but never changed or removed.
create table public.gate_in_media (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id),
  kind          text not null check (kind in ('video','dashboard_photo','keys_photo','damage_photo','gate_out_photo')),
  storage_path  text not null unique,
  duration_s    integer,
  caption       text,
  taken_at      timestamptz not null default now(),
  uploaded_by   uuid references public.staff (id),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.staff (id)
);

create index gate_in_media_job_idx on public.gate_in_media (job_id, kind);

-- A gate-in is complete once the video, dashboard photo and keys photo exist.
create or replace function public.refresh_gate_in_completion()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_job uuid := new.job_id;
  v_done boolean;
begin
  select exists (select 1 from public.gate_in_media where job_id = v_job and kind = 'video')
     and exists (select 1 from public.gate_in_media where job_id = v_job and kind = 'dashboard_photo')
     and exists (select 1 from public.gate_in_media where job_id = v_job and kind = 'keys_photo')
  into v_done;
  if v_done then
    update public.gate_ins set is_complete = true, completed_at = coalesce(completed_at, now())
      where job_id = v_job and is_complete = false;
    update public.jobs set status = 'pending_approval'
      where id = v_job and status = 'gate_in_pending';
  end if;
  return new;
end
$$;

create trigger gate_in_media_completion after insert on public.gate_in_media
  for each row execute function public.refresh_gate_in_completion();

-- -----------------------------------------------------------------------------
-- 3. Job events: every handover and status change, with who and when
-- -----------------------------------------------------------------------------
create table public.job_events (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs (id),
  event_type   text not null,
  from_status  text,
  to_status    text,
  from_stage   text,
  to_stage     text,
  from_staff   uuid references public.staff (id),
  to_staff     uuid references public.staff (id),
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.staff (id)
);

create index job_events_job_idx on public.job_events (job_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. Customer approval links and phone upload links
-- -----------------------------------------------------------------------------
create table public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id),
  kind            text not null default 'job_card' check (kind in ('job_card','quote')),
  token           text not null unique,
  sent_to_name    text,
  sent_to_phone   text not null,
  sent_at         timestamptz not null default now(),
  sent_by         uuid references public.staff (id),
  opened_at       timestamptz,
  approved_at     timestamptz,
  approver_name   text,
  terms_text      text not null,
  status          text not null default 'sent' check (status in ('sent','opened','approved','cancelled')),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id)
);

create index approval_requests_job_idx on public.approval_requests (job_id, sent_at desc);

create table public.upload_links (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id),
  token       text not null unique,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id),
  last_used_at timestamptz
);

-- -----------------------------------------------------------------------------
-- 5. Gate-out record (one per job)
-- -----------------------------------------------------------------------------
create table public.gate_outs (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null unique references public.jobs (id),
  keys_returned         integer not null check (keys_returned between 0 and 10),
  keychain_returned     boolean not null default false,
  keys_match            boolean not null,
  keys_override_by      uuid references public.staff (id),
  keys_override_reason  text,
  dash_cam_reconnected  boolean,
  balance_due_aed       numeric(12,2) not null default 0,
  release_approved_by   uuid references public.staff (id),
  release_reason        text,
  notes                 text,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.staff (id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.staff (id)
);

-- -----------------------------------------------------------------------------
-- 6. Stamps, change log, no deletes
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'gate_ins', 'gate_in_media', 'approval_requests', 'gate_outs']
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

create trigger job_events_no_delete before delete on public.job_events
  for each row execute function public.prevent_delete();

-- -----------------------------------------------------------------------------
-- 7. Access rules
-- -----------------------------------------------------------------------------
alter table public.jobs              enable row level security;
alter table public.gate_ins          enable row level security;
alter table public.gate_in_media     enable row level security;
alter table public.job_events        enable row level security;
alter table public.approval_requests enable row level security;
alter table public.upload_links      enable row level security;
alter table public.gate_outs         enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Jobs: everyone logged in can see them. Gate-in roles create; gate-in roles and the manager change.
create policy jobs_read on public.jobs for select to authenticated using (true);
create policy jobs_insert on public.jobs for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
create policy jobs_update on public.jobs for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in', 'accounts'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in', 'accounts'));

create policy gate_ins_read on public.gate_ins for select to authenticated using (true);
create policy gate_ins_insert on public.gate_ins for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
create policy gate_ins_update on public.gate_ins for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));

create policy gate_in_media_read on public.gate_in_media for select to authenticated using (true);
create policy gate_in_media_insert on public.gate_in_media for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
-- No update or delete policy: media is never changed or removed.

create policy job_events_read on public.job_events for select to authenticated using (true);
create policy job_events_insert on public.job_events for insert to authenticated with check (true);

create policy approval_requests_read on public.approval_requests for select to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in', 'accounts'));
create policy approval_requests_insert on public.approval_requests for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
create policy approval_requests_update on public.approval_requests for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));

-- Upload links are handled by the server only (master key); nobody reads them directly.
create policy upload_links_owner_read on public.upload_links for select to authenticated
  using (public.is_owner());

create policy gate_outs_read on public.gate_outs for select to authenticated using (true);
create policy gate_outs_insert on public.gate_outs for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in', 'accounts'));

-- Amendments to a gate-in are visible to the people who work with job cards.
create view public.gate_in_amendments
  with (security_invoker = false) as
  select a.id, a.record_id, a.action, a.old_data, a.new_data, a.changed_by, a.changed_at, s.display_name as changed_by_name
  from public.audit_log a
  left join public.staff s on s.id = a.changed_by
  where a.table_name in ('gate_ins', 'jobs') and a.action = 'UPDATE';
revoke all on public.gate_in_amendments from public, anon;
grant select on public.gate_in_amendments to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Storage for gate-in media (video up to 200 MB, photos up to 15 MB)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('gate-in-media', 'gate-in-media', false, 209715200,
   array['image/jpeg', 'image/png', 'image/webp', 'video/webm', 'video/mp4', 'video/quicktime'])
on conflict (id) do nothing;

create policy gate_in_media_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'gate-in-media');
create policy gate_in_media_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'gate-in-media'
              and public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
