-- Overnight batch 22 to 23 October 2026, section 7: bodyshop findings inside the inspection (opens only when
-- needed), on a car outline shared with the gate-in damage marking and the bodyshop pre-work check.

-- One finding per panel of a car's inspection: what is damaged, how badly, what to do, the internal hours.
-- Photos are inspection_media rows with item_key 'body.<panel>'; parts are inspection parts-list entries with the
-- same item key.
create table if not exists public.bodyshop_findings (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id),
  job_id uuid not null references public.jobs(id),
  panel text not null,
  damage text[] not null default '{}',
  severity text check (severity is null or severity in ('minor', 'moderate', 'severe')),
  action text check (action is null or action in ('polish', 'paint', 'repair_paint', 'replace', 'ppf_wrap')),
  remark text,
  labour_hours numeric(6,2),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create unique index if not exists bodyshop_findings_one_per_panel on public.bodyshop_findings (inspection_id, panel) where is_active;
create index if not exists bodyshop_findings_job on public.bodyshop_findings (job_id) where is_active;

-- 1. RLS on; 2. staff who work on cars may read; writes go through the server only;
-- 3. grants: the server (service_role) only - every screen reads it through the server.
alter table public.bodyshop_findings enable row level security;
create policy bodyshop_findings_read on public.bodyshop_findings
  for select to authenticated using (has_role('owner', 'service_advisor', 'workshop_manager', 'technician', 'team_leader', 'qc_inspector'));
grant all on public.bodyshop_findings to service_role;

create trigger bodyshop_findings_audit after insert or update on public.bodyshop_findings for each row execute function write_audit_log();
create trigger bodyshop_findings_nodel before delete on public.bodyshop_findings for each row execute function prevent_delete();
create trigger bodyshop_findings_stamp before insert or update on public.bodyshop_findings for each row execute function set_audit_columns();

-- The accident questions and who opened and checked the bodyshop part of the inspection.
alter table public.inspections add column if not exists bodyshop_opened_at timestamptz;
alter table public.inspections add column if not exists bodyshop_opened_by uuid references public.staff(id);
alter table public.inspections add column if not exists airbags_deployed boolean;
alter table public.inspections add column if not exists structural_damage boolean;
alter table public.inspections add column if not exists bodyshop_notified_at timestamptz;
alter table public.inspections add column if not exists bodyshop_checked_at timestamptz;
alter table public.inspections add column if not exists bodyshop_checked_by uuid references public.staff(id);

-- A quotation line can belong to the bodyshop side on a mixed job (bodyshop findings arrive as bodyshop lines).
alter table public.quotation_lines add column if not exists side text check (side is null or side in ('mechanical', 'bodyshop'));

-- The same car outline marks damage seen at gate-in and the bodyshop pre-work check before PPF:
-- { "<panel>": { "damage": ["scratch", ...], "note": "..." } }.
alter table public.gate_ins add column if not exists damage_panels jsonb not null default '{}'::jsonb;
alter table public.jobs add column if not exists prework_panels jsonb not null default '{}'::jsonb;
alter table public.jobs add column if not exists prework_checked_at timestamptz;
alter table public.jobs add column if not exists prework_checked_by uuid references public.staff(id);

notify pgrst, 'reload schema';
