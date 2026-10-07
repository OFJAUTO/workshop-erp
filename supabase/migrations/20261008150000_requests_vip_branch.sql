-- Customer requests as separate records, VIP logging, branch wording (8 October 2026, evening testing)

-- 1. One record per customer request
create table public.job_requests (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id),
  position    integer not null default 1,
  text        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id)
);
create index job_requests_job_idx on public.job_requests (job_id, position);

create trigger job_requests_stamps before insert or update on public.job_requests
  for each row execute function public.set_audit_columns();
create trigger job_requests_audit after insert or update or delete on public.job_requests
  for each row execute function public.write_audit_log();
create trigger job_requests_no_delete before delete on public.job_requests
  for each row execute function public.prevent_delete();

alter table public.job_requests enable row level security;
revoke all on public.job_requests from anon;
create policy job_requests_read on public.job_requests for select to authenticated using (true);
create policy job_requests_insert on public.job_requests for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
create policy job_requests_update on public.job_requests for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor', 'gate_in'));
alter publication supabase_realtime add table public.job_requests;

-- Split the requests already recorded on existing jobs into separate lines.
insert into public.job_requests (job_id, position, text, created_by)
select g.job_id, row_number() over (partition by g.job_id order by ord), trim(part), g.created_by
from public.gate_ins g
cross join lateral regexp_split_to_table(g.customer_requests, E'\\r?\\n|;\\s*|(?<=[.!?])\\s+(?=[A-Z])') with ordinality as t(part, ord)
where length(trim(part)) > 0
  and not exists (select 1 from public.job_requests r where r.job_id = g.job_id);

-- 2. Branch wording: name only, no street address
update public.settings
set value = '[{"name": "OFJ Automotive (Al Quoz, Dubai)", "address": ""}]'
where key = 'branches';

alter table public.gate_ins disable trigger gate_ins_protect_location;
update public.gate_ins
set location_name = 'OFJ Automotive (Al Quoz, Dubai)', location_address = null
where location_type = 'branch';
alter table public.gate_ins enable trigger gate_ins_protect_location;
