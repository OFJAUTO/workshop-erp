-- 14 October 2026, evening: the bodyshop path. A quotation before the car arrives (a booked job), pick-list packages
-- with typed prices, stages with due dates per section, team leaders and loose clocking, the release sign-off,
-- customer progress updates, the handover page and the PPF warranty.

-- People: the team leader role (PPF, Painting, Detailing) and the detailing department.
insert into public.roles (id, label, home_path, sort_order) values ('team_leader', 'Team leader', '/home', 3) on conflict (id) do nothing;
insert into public.departments (id, label, sort_order) values ('detailing', 'Detailing and cleaning', 5) on conflict (id) do nothing;

-- Jobs: a bodyshop quotation before arrival lives on a booked job (closed until the car is gated in).
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('booked','gate_in_pending','pending_approval','pending_road_test','pending_inspection','in_inspection','pending_quote','pending_customer_approval','approved','waiting_parts','in_work','pending_qc','pending_wash','ready','pending_payment','in_delivery','closed'));
alter table public.jobs add column if not exists booked_at timestamptz;
alter table public.jobs add column if not exists booked_arrival_at timestamptz;
alter table public.jobs add column if not exists bodyshop_started_at timestamptz;
alter table public.jobs add column if not exists bodyshop_handover_token text;
alter table public.jobs add column if not exists bodyshop_after_photo_id uuid;
alter table public.jobs add column if not exists bodyshop_due_out_notified_at timestamptz;
alter table public.jobs add column if not exists final_check_appointment_id uuid references public.appointments (id);
create unique index if not exists jobs_bodyshop_handover_token_idx on public.jobs (bodyshop_handover_token) where bodyshop_handover_token is not null;

-- Packages: services of the bodyshop with no fixed price (the advisor types it every time) and a kind that builds the stages.
alter table public.services add column if not exists bodyshop_kind text
  check (bodyshop_kind is null or bodyshop_kind in ('ppf','coloured_ppf','tint','peelable_jambs','peelable_full','respray','ppf_removal','wash','accident','other'));
insert into public.service_categories (name, position)
  select 'Bodyshop', 90 where not exists (select 1 from public.service_categories where lower(name) = 'bodyshop');
insert into public.services (category_id, name, department, price_aed, bodyshop_kind, position)
  select c.id, v.name, 'bodyshop', null, v.kind, v.pos
  from public.service_categories c
  cross join (values ('Full PPF','ppf',1),('Coloured PPF','coloured_ppf',2),('Window tint','tint',3),('Peelable door jambs','peelable_jambs',4),('Full peelable colour change','peelable_full',5),('Full respray','respray',6),('Old PPF removal','ppf_removal',7),('Wash','wash',8),('Accident repair','accident',9),('Other','other',10)) as v(name, kind, pos)
  where lower(c.name) = 'bodyshop' and not exists (select 1 from public.services s where s.bodyshop_kind = v.kind);

-- Quotation lines carry the film colour and code, or the tint shade; the quotation carries the old-film acknowledgement and the materials cost.
alter table public.quotation_lines add column if not exists film_colour text;
alter table public.quotation_lines add column if not exists film_code text;
alter table public.quotation_lines add column if not exists tint_percent integer check (tint_percent is null or (tint_percent between 1 and 100));
alter table public.quotations add column if not exists removal_ack_at timestamptz;
alter table public.quotations add column if not exists removal_ack_name text;
alter table public.quotations add column if not exists materials_cost_aed numeric(12,2) not null default 0;
-- A deposit proforma points at its quotation; it is folded into the final proforma later.
alter table public.invoices add column if not exists deposit_for_quotation_id uuid references public.quotations (id);
-- Shared section tablets.
alter table public.devices add column if not exists section text check (section is null or section in ('ppf','paint','detailing','strip_refit'));

-- Stages per job, built from the quotation's packages; the bodyshop manager adds, removes, reorders and dates them.
create table if not exists public.bodyshop_stages (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs (id),
  position         integer not null default 0,
  key              text not null,
  label            text not null,
  section          text not null check (section in ('strip_refit','ppf','paint','detailing','electrical','qc','handover')),
  est_hours        numeric(6,2) not null default 2,
  due_date         date,
  status           text not null default 'pending' check (status in ('pending','active','done','skipped')),
  started_at       timestamptz,
  done_at          timestamptz,
  done_by          uuid references public.staff (id),
  heads_up_sent_at timestamptz,
  late_notified_at timestamptz,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.staff (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.staff (id)
);
create index if not exists bodyshop_stages_job_idx on public.bodyshop_stages (job_id, position);

-- What came off the car at Strip, with a photo; everything must be ticked back on before Refit is done.
create table if not exists public.bodyshop_removed_items (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id),
  label       text not null,
  photo_path  text,
  removed_at  timestamptz not null default now(),
  removed_by  uuid references public.staff (id),
  refitted_at timestamptz,
  refitted_by uuid references public.staff (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id)
);
create index if not exists bodyshop_removed_items_job_idx on public.bodyshop_removed_items (job_id);

-- Who is on each car (one tap per person by the team leader, "Need help" from any team).
create table if not exists public.bodyshop_assignments (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id),
  staff_id    uuid not null references public.staff (id),
  section     text not null,
  assigned_by uuid references public.staff (id),
  assigned_at timestamptz not null default now(),
  removed_at  timestamptz,
  removed_by  uuid references public.staff (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id)
);
create index if not exists bodyshop_assignments_job_idx on public.bodyshop_assignments (job_id) where removed_at is null;

-- Loose clocking on a car from the section tablet (PIN) or by the leader; labour cost = minutes × the hourly rate.
create table if not exists public.bodyshop_clockings (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id),
  stage_id    uuid references public.bodyshop_stages (id),
  staff_id    uuid not null references public.staff (id),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  minutes     integer,
  source      text not null default 'tablet',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id)
);
create index if not exists bodyshop_clockings_job_idx on public.bodyshop_clockings (job_id);
create index if not exists bodyshop_clockings_open_idx on public.bodyshop_clockings (staff_id) where ended_at is null;

-- The release sign-off: one tap with a PIN from the bodyshop manager and the leaders whose sections touched the car.
create table if not exists public.bodyshop_signoffs (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs (id),
  role_key   text not null check (role_key in ('manager','ppf','detailing','paint')),
  staff_id   uuid references public.staff (id),
  signed_at  timestamptz not null default now(),
  on_behalf  boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create unique index if not exists bodyshop_signoffs_one_idx on public.bodyshop_signoffs (job_id, role_key) where is_active;

-- The three customer updates (arrived, film going on, ready), each with one photo and its own link.
create table if not exists public.bodyshop_updates (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs (id),
  kind       text not null check (kind in ('arrived','film','ready')),
  photo_id   uuid references public.job_files (id),
  token      text not null unique default encode(gen_random_bytes(18), 'hex'),
  sent_at    timestamptz,
  sent_by    uuid references public.staff (id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create index if not exists bodyshop_updates_job_idx on public.bodyshop_updates (job_id);

do $$
declare t text;
begin
  foreach t in array array['bodyshop_stages','bodyshop_removed_items','bodyshop_assignments','bodyshop_clockings','bodyshop_signoffs','bodyshop_updates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop trigger if exists %I_audit_columns on public.%I', t, t);
    execute format('create trigger %I_audit_columns before insert or update on public.%I for each row execute function public.set_audit_columns()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_log()', t, t);
    execute format('drop trigger if exists %I_no_delete on public.%I', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.prevent_delete()', t, t);
  end loop;
end $$;

-- Live screens (the board, the leader lists, the tablets) listen to these.
alter publication supabase_realtime add table public.bodyshop_stages, public.bodyshop_clockings, public.bodyshop_assignments, public.bodyshop_signoffs;
