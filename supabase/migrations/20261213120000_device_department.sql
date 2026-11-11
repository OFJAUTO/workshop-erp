-- 11 November 2026, Section 8: a shared tablet belongs to a department - Workshop, Bodyshop or Both. Its sign-in screen
-- shows that department's people first and its car list opens on that department's cars. Empty = "Department: not set"
-- (tablets registered before this keep working as now). Only the owner changes it (Settings > Devices).

alter table public.devices add column if not exists department text;
alter table public.devices drop constraint if exists devices_department_check;
alter table public.devices add constraint devices_department_check check (department is null or department in ('workshop', 'bodyshop', 'both'));

notify pgrst, 'reload schema';
