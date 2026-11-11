-- 11 November 2026, Section 10: the inspection's type and "Could not check".
-- jobs.inspection_scope: what the advisor asked for, chosen before the inspection can start (no default):
--   full = full inspection, complaints = customer complaints only, pre_purchase = pre-purchase inspection.
--   Empty = "Type: not set" (cars already in inspection). A downgrade after the start waits for the owner.
-- inspections.car_condition: the technician's first tap - drives / starts_no_drive / no_start / no_power.
-- inspection_items.not_checked_*: an item that could not be checked, why, whether the system marked it from the car's
--   condition, and how it was settled (checked later, customer declined, not applicable).

alter table public.jobs add column if not exists inspection_scope text;
alter table public.jobs drop constraint if exists jobs_inspection_scope_check;
alter table public.jobs add constraint jobs_inspection_scope_check check (inspection_scope is null or inspection_scope in ('full', 'complaints', 'pre_purchase'));
alter table public.jobs add column if not exists inspection_scope_set_by uuid references public.staff(id);
alter table public.jobs add column if not exists inspection_scope_set_at timestamptz;
alter table public.jobs add column if not exists inspection_scope_request text;
alter table public.jobs add column if not exists inspection_scope_request_by uuid references public.staff(id);
alter table public.jobs add column if not exists inspection_scope_request_at timestamptz;
alter table public.jobs add column if not exists inspection_scope_request_reason text;
grant select (inspection_scope, inspection_scope_set_by, inspection_scope_set_at, inspection_scope_request, inspection_scope_request_by, inspection_scope_request_at, inspection_scope_request_reason) on public.jobs to authenticated;

alter table public.inspections add column if not exists car_condition text;
alter table public.inspections drop constraint if exists inspections_car_condition_check;
alter table public.inspections add constraint inspections_car_condition_check check (car_condition is null or car_condition in ('drives', 'starts_no_drive', 'no_start', 'no_power'));

alter table public.inspection_items add column if not exists not_checked_reason text;
alter table public.inspection_items add column if not exists not_checked_auto boolean not null default false;
alter table public.inspection_items add column if not exists not_checked_resolution text;
alter table public.inspection_items drop constraint if exists inspection_items_not_checked_resolution_check;
alter table public.inspection_items add constraint inspection_items_not_checked_resolution_check check (not_checked_resolution is null or not_checked_resolution in ('checked', 'declined', 'not_applicable'));
alter table public.inspection_items add column if not exists not_checked_resolved_by uuid references public.staff(id);
alter table public.inspection_items add column if not exists not_checked_resolved_at timestamptz;

insert into public.settings (key, label, value)
values ('inspection_scope_rules', 'Inspection types: fee (AED, empty = today''s fee rule) and time allowed (minutes) per type', '{"full": {"fee": null, "minutes": null}, "complaints": {"fee": null, "minutes": null}, "pre_purchase": {"fee": null, "minutes": null}}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
