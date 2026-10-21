-- Section 6 (21 October 2026): every hands-on person belongs to a Team inside their side.
-- Mechanical: technicians / electricians / helpers. Bodyshop: dismantle_refit / ppf / painting / detailing_cleaning.
alter table public.staff add column if not exists team text;
do $$ begin
  alter table public.staff add constraint staff_team_check check (team is null or team in ('technicians', 'electricians', 'helpers', 'dismantle_refit', 'ppf', 'painting', 'detailing_cleaning'));
exception when duplicate_object then null; end $$;

-- Sensible defaults from what we already know; the Team page can change anyone with one tap.
update public.staff set team = 'technicians' where team is null and role_id = 'technician' and coalesce(department_id, 'mechanical') = 'mechanical';
update public.staff set team = 'ppf' where team is null and role_id in ('technician', 'team_leader') and department_id = 'ppf_tint';
update public.staff set team = 'painting' where team is null and role_id in ('technician', 'team_leader') and department_id = 'paint';
update public.staff set team = 'detailing_cleaning' where team is null and role_id in ('technician', 'team_leader') and department_id = 'detailing';
update public.staff set team = 'dismantle_refit' where team is null and role_id in ('technician', 'team_leader') and department_id = 'bodyshop';

notify pgrst, 'reload schema';
