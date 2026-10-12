-- Evening list of 12 October 2026, part 1: hours keep two decimals ("10.25" stays 10.25 in every hours box).
alter table public.inspections alter column estimated_hours type numeric(6,2);
alter table public.inspections alter column estimated_hours_manager type numeric(6,2);
alter table public.jobs alter column budget_hours type numeric(6,2);
alter table public.services alter column default_hours type numeric(6,2);
alter table public.services alter column time_allowance_hours type numeric(6,2);
alter table public.work_lines alter column hours_quoted type numeric(6,2);
