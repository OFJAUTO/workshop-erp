-- HR (11 November 2026, Section 15): the people file under Team, for the owner and the head accountant only.
-- Everyone on the Team page plus people with no ERP login; their details and documents with expiry dates.
-- Every table is SERVER ONLY (no policies, no grants to anon or authenticated): the HR pages read through the server,
-- which checks the person, their phone sign-in, and logs every view and download. Nothing is ever deleted.

create table if not exists public.hr_people (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid unique references public.staff (id),
  passport_name text not null,
  role_title text,
  department text,
  joining_date date,
  phone text,
  emergency_name text,
  emergency_phone text,
  contract_end date,
  probation_end date,
  status text not null default 'active' check (status in ('active', 'left')),
  left_at timestamptz,
  left_reason text,
  left_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id),
  is_active boolean not null default true
);

create table if not exists public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.hr_people (id),
  kind text not null check (kind in ('photo', 'emirates_id', 'passport', 'visa', 'labour_card', 'health_insurance', 'driving_licence')),
  doc_number text,
  expires_on date,
  storage_path text not null,
  file_name text,
  content_type text,
  reminded_stage integer,
  replaced_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id),
  is_active boolean not null default true
);
create index if not exists hr_documents_person_idx on public.hr_documents (person_id);
create index if not exists hr_documents_expiry_idx on public.hr_documents (expires_on) where is_active;

create table if not exists public.hr_access_log (
  id bigint generated always as identity primary key,
  person_id uuid references public.hr_people (id),
  document_id uuid references public.hr_documents (id),
  action text not null,
  detail text,
  by_staff_id uuid references public.staff (id),
  user_agent text,
  at timestamptz not null default now()
);
create index if not exists hr_access_log_person_idx on public.hr_access_log (person_id, at desc);

alter table public.hr_people enable row level security;
alter table public.hr_documents enable row level security;
alter table public.hr_access_log enable row level security;
revoke all on public.hr_people, public.hr_documents, public.hr_access_log from anon, authenticated;
grant all on public.hr_people, public.hr_documents, public.hr_access_log to service_role;
grant usage, select on sequence public.hr_access_log_id_seq to service_role;

drop trigger if exists hr_people_audit on public.hr_people;
create trigger hr_people_audit after insert or update on public.hr_people for each row execute function public.write_audit_log();
drop trigger if exists hr_people_stamp on public.hr_people;
create trigger hr_people_stamp before insert or update on public.hr_people for each row execute function public.set_audit_columns();
drop trigger if exists hr_people_no_delete on public.hr_people;
create trigger hr_people_no_delete before delete on public.hr_people for each row execute function public.prevent_delete();
drop trigger if exists hr_documents_audit on public.hr_documents;
create trigger hr_documents_audit after insert or update on public.hr_documents for each row execute function public.write_audit_log();
drop trigger if exists hr_documents_stamp on public.hr_documents;
create trigger hr_documents_stamp before insert or update on public.hr_documents for each row execute function public.set_audit_columns();
drop trigger if exists hr_documents_no_delete on public.hr_documents;
create trigger hr_documents_no_delete before delete on public.hr_documents for each row execute function public.prevent_delete();
drop trigger if exists hr_access_log_no_delete on public.hr_access_log;
create trigger hr_access_log_no_delete before delete on public.hr_access_log for each row execute function public.prevent_delete();

-- The files: a private bucket, read only through short-lived signed links made by the server.
insert into storage.buckets (id, name, public, file_size_limit) values ('hr-files', 'hr-files', false, 26214400) on conflict (id) do nothing;

notify pgrst, 'reload schema';
