-- Mechanical path: department at gate-in, inspections with report items, findings, media and change requests.

-- 1. Department chosen at gate-in. Cars gated in before this have none and show for every manager.
alter table public.jobs add column if not exists department text
  check (department is null or department in ('mechanical', 'bodyshop', 'both'));

-- 2. Inspections (one per job and path; the bodyshop path comes later).
create table public.inspections (
  id                        uuid primary key default gen_random_uuid(),
  job_id                    uuid not null references public.jobs (id),
  path                      text not null default 'mechanical' check (path in ('mechanical', 'bodyshop')),
  technician_id             uuid references public.staff (id),
  status                    text not null default 'not_started'
                            check (status in ('not_started', 'in_progress', 'submitted', 'returned', 'approved')),
  started_at                timestamptz,
  submitted_at              timestamptz,
  returned_at               timestamptz,
  return_reason             text,
  approved_at               timestamptz,
  approved_by               uuid references public.staff (id),
  technician_notes          text,
  manager_note              text,
  checklist                 jsonb not null default '[]'::jsonb,   -- the checklist version this report was done with
  measurements              jsonb not null default '{}'::jsonb,   -- tyre tread and year, pad thickness, battery test, vent temperature
  target_minutes            integer,
  elapsed_minutes           integer,                              -- working minutes from start to submit; counts as labour
  overrun_minutes           integer,                              -- how far over the target it ran (0 when within target)
  overdue_warned_at         timestamptz,
  show_prescan_to_customer  boolean not null default false,
  unlocked_until            timestamptz,                          -- after the owner approves a change request
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  created_by                uuid references public.staff (id),
  updated_at                timestamptz not null default now(),
  updated_by                uuid references public.staff (id)
);
create unique index inspections_job_path_idx on public.inspections (job_id, path);
create index inspections_technician_idx on public.inspections (technician_id, status);

create table public.inspection_items (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references public.inspections (id),
  section_key     text not null,
  section_title   text not null,
  item_key        text not null,
  item_label      text not null,
  position        integer not null default 0,
  status          text check (status is null or status in ('good', 'average', 'bad')),
  remarks         text,
  parts_needed    text,
  labour_hours    numeric(6,2),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id),
  unique (inspection_id, item_key)
);

create table public.inspection_findings (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references public.inspections (id),
  job_request_id  uuid not null references public.job_requests (id),
  found           text,
  needs           text,
  status          text check (status is null or status in ('good', 'average', 'bad')),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id),
  unique (inspection_id, job_request_id)
);

create table public.inspection_media (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references public.inspections (id),
  item_key        text,                                   -- a checklist item, or null
  job_request_id  uuid references public.job_requests (id), -- a customer request, or null
  kind            text not null check (kind in ('photo', 'video', 'pdf')),
  is_prescan      boolean not null default false,          -- the Autel fault code scan report
  storage_path    text not null,
  caption         text,
  duration_s      integer,
  taken_at        timestamptz not null default now(),
  uploaded_by     uuid references public.staff (id),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id)
);
create index inspection_media_inspection_idx on public.inspection_media (inspection_id);

create table public.inspection_change_requests (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references public.inspections (id),
  requested_by    uuid references public.staff (id),
  reason          text not null,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  decided_by      uuid references public.staff (id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id)
);

do $$
declare t text;
begin
  foreach t in array array['inspections', 'inspection_items', 'inspection_findings', 'inspection_media', 'inspection_change_requests'] loop
    execute format('create trigger %I_audit_columns before insert or update on public.%I for each row execute function public.set_audit_columns()', t, t);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function public.write_audit_log()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.prevent_delete()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.has_role(''owner'', ''workshop_manager'', ''technician'', ''service_advisor''))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.has_role(''owner'', ''workshop_manager'', ''technician'', ''service_advisor'')) with check (public.has_role(''owner'', ''workshop_manager'', ''technician'', ''service_advisor''))', t, t);
  end loop;
end $$;

alter publication supabase_realtime add table public.inspections;

-- 3. Files: photos, short videos and the pre-scan PDFs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('inspection-media', 'inspection-media', false, 524288000, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'])
on conflict (id) do nothing;
create policy inspection_media_read on storage.objects for select to authenticated using (bucket_id = 'inspection-media');

-- 4. Settings. The checklist itself is saved from the Settings page (the page inserts it when missing).
insert into public.settings (key, value, label, description) values
  ('inspection_target_minutes', '90'::jsonb, 'Inspection target (minutes of working time)', 'Past this the department manager and the owner are warned and the card turns red.')
on conflict (key) do nothing;
