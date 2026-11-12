-- Files still on a device (12 November 2026, the inspection uploads fix). The moment a photo or video is saved on a
-- tablet, the tablet tells the server about it (its own id, the place, the item, who took it, which tablet, its size),
-- and the upload door marks it arrived when it is recorded. So the report can say "4 files still uploading from Mech 3",
-- the report cannot go to the customer while its media is still on the way, the advisor is told after 15 minutes, and
-- a file that never arrives is never lost quietly: it stays listed here.
-- Server only: written and read by the server (the upload door, the cron, the pages through the admin client).

create table public.upload_pending (
  id uuid primary key,                 -- the file's own id on the device (the same id it is stored and recorded under)
  target text not null,                -- inspection, gate_in, job_file, …
  scope_id text not null,              -- the place: the inspection, the job, …
  inspection_id uuid references public.inspections(id),
  job_id uuid references public.jobs(id),
  item_key text,
  kind text,
  content_type text,
  size_bytes bigint,
  staff_id uuid references public.staff(id),
  device_id uuid references public.devices(id),
  device_name text,
  taken_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  state text not null default 'waiting' check (state in ('waiting', 'sending', 'stopped', 'arrived', 'removed')),
  progress numeric(5, 2),
  attempts integer not null default 0,
  last_error text,
  arrived_at timestamptz,
  removed_at timestamptz,
  alerted_at timestamptz,
  storage_quota_mb integer,
  storage_used_mb integer,
  storage_persisted boolean
);

create index upload_pending_open on public.upload_pending (inspection_id) where arrived_at is null and removed_at is null;
create index upload_pending_job_open on public.upload_pending (job_id) where arrived_at is null and removed_at is null;

alter table public.upload_pending enable row level security;
revoke all on public.upload_pending from anon, authenticated;
grant all on public.upload_pending to service_role;

notify pgrst, 'reload schema';
