-- Plate can be added (6 November 2026, the AL TAMIMI Audi A8): the old plates of a car as searchable text
-- (a changed plate still finds the same car), and where a merged duplicate record went.
-- The CORE fix (a typed plate saves at all) needs no database change; these two columns only switch on the
-- old-plate search and the merge pointer. vehicles already has RLS and its grants; new columns inherit them.

alter table public.vehicles add column if not exists old_plates text;
alter table public.vehicles add column if not exists merged_into uuid references public.vehicles (id);

comment on column public.vehicles.old_plates is 'Earlier plates as search text ("Dubai DD 23864 DD23864 · ..."), appended on every plate change or merge; the detail (who, when, remark) is in audit_log.';
comment on column public.vehicles.merged_into is 'Set on a duplicate record merged into another car; the keeper carries everything.';
