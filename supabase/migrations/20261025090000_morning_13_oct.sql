-- Morning list of 13 October 2026: the upload failure log, supplier import mappings, part numbers off customer documents.

-- 1. Failed uploads (car picture, gate-in photos and videos, inspection files, job files): device, person, step and error,
--    so the cause of a silent failure can be found. Written by the server only; the owner reads it in Settings.
create table if not exists public.upload_failures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id uuid references public.jobs(id),
  inspection_id uuid references public.inspections(id),
  kind text not null,
  step text not null,
  error text not null,
  staff_id uuid references public.staff(id),
  via text,
  device_id uuid references public.devices(id),
  device_name text,
  user_agent text,
  size_bytes bigint,
  content_type text,
  extra jsonb not null default '{}'::jsonb
);
create index if not exists upload_failures_created_idx on public.upload_failures (created_at desc);
create index if not exists upload_failures_job_idx on public.upload_failures (job_id);
alter table public.upload_failures enable row level security;
drop policy if exists upload_failures_read on public.upload_failures;
create policy upload_failures_read on public.upload_failures for select to authenticated using (public.has_role('owner'));

-- 2. Supplier price files: the column mapping Parts set once for a supplier whose format is not recognised.
alter table public.suppliers add column if not exists import_mapping jsonb;

-- 3. Part numbers are never shown to customers. Quotation part lines used to carry the number in the title
--    ("Front brake pads (A 000 420 12 20)"); the number lives on the part item, so the title keeps the name only.
update public.quotation_lines l
set title = btrim(left(l.title, length(l.title) - length(p.part_number) - 2))
from public.part_items p
where l.part_item_id = p.id
  and p.part_number is not null
  and p.part_number <> ''
  and l.title like '% (' || p.part_number || ')'
  and length(l.title) > length(p.part_number) + 3;
