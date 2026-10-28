-- B2 (28 October 2026): team leaders - Sabir (PPF), AKHIL (Painting), AHMAD (Detailing & cleaning); Arsalan, the
-- bodyshop manager, leads Dismantle & refit.

-- 1. The hand-over between teams: a stage is signed off with the leader's PIN and photos (job_files kind
--    bodyshop_photo whose ref_id is the stage).
alter table public.bodyshop_stages
  add column if not exists handover_pin_at timestamptz,
  add column if not exists handover_by uuid references public.staff(id);

-- 2. "Problem - needs manager": raised by a leader with a photo, answered by the bodyshop manager (or the owner).
--    Server only: every screen reads it through the server.
create table if not exists public.bodyshop_problems (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  stage_id uuid references public.bodyshop_stages(id),
  section text,
  text text not null,
  photo_path text,
  raised_by uuid not null references public.staff(id),
  answer text,
  answered_at timestamptz,
  answered_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index if not exists bodyshop_problems_job on public.bodyshop_problems (job_id) where is_active;
alter table public.bodyshop_problems enable row level security;
revoke all on public.bodyshop_problems from anon, authenticated;
grant all on public.bodyshop_problems to service_role;
create trigger bodyshop_problems_audit after insert or update on public.bodyshop_problems for each row execute function write_audit_log();
create trigger bodyshop_problems_nodel before delete on public.bodyshop_problems for each row execute function prevent_delete();

-- 3. Ceramic used on a car (the detailing leader): product and batch, exterior or interior, the bottle share.
--    The cost is the bottle price over the cars a bottle does (Settings); server only.
create table if not exists public.ceramic_usage (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  kind text not null check (kind in ('exterior', 'interior')),
  product text,
  batch text,
  share numeric(6,3) not null default 1,
  cost_aed numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index if not exists ceramic_usage_job on public.ceramic_usage (job_id) where is_active;
alter table public.ceramic_usage enable row level security;
revoke all on public.ceramic_usage from anon, authenticated;
grant all on public.ceramic_usage to service_role;
create trigger ceramic_usage_audit after insert or update on public.ceramic_usage for each row execute function write_audit_log();
create trigger ceramic_usage_nodel before delete on public.ceramic_usage for each row execute function prevent_delete();

-- 4. No prices or costs for team leaders at the database too (their screens read through the server; these rules
--    close the direct API). RESTRICTIVE: they narrow whatever the other read policies allow.
do $$
declare t text;
begin
  foreach t in array array['services', 'stock_movements', 'declined_work', 'gate_outs', 'jobs', 'job_events', 'customers', 'customer_contacts',
                           'advisor_bonus_periods', 'advisor_bonus_overrides', 'price_imports', 'price_import_lines', 'supplier_discount_changes',
                           'approval_requests', 'stock_items']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_no_team_leader', t);
      execute format('create policy %I on public.%I as restrictive for select to authenticated using (not public.has_role(''team_leader''))', t || '_no_team_leader', t);
    end if;
  end loop;
end $$;

-- Settings: a team leader reads only the plain working settings, never a price, rate, cost or target.
drop policy if exists settings_no_team_leader_money on public.settings;
create policy settings_no_team_leader_money on public.settings as restrictive for select to authenticated
  using (not public.has_role('team_leader') or not (key ~* '(price|cost|rate|aed|profit|margin|markup|discount|commission|bonus|target|charge|fee|salary|recovery_rates|film_types|package)'));

-- Job files (supplier invoices, payment proofs, slips): the browser never reads them directly; a team leader gets
-- nothing from the bucket through the API (pictures reach their screens as server-signed addresses).
drop policy if exists job_files_read on storage.objects;
create policy job_files_read on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and not public.has_role('team_leader'));

notify pgrst, 'reload schema';
