-- B1 (28 October 2026): the bodyshop side of a job is released on its own, by the bodyshop manager.
-- plan_released_* stays the mechanical release (on a bodyshop-only job it is written at the bodyshop release too, so
-- everything that reads "the work was released" keeps working).
alter table public.jobs
  add column if not exists plan_bodyshop_released_at timestamptz,
  add column if not exists plan_bodyshop_released_by uuid references public.staff(id),
  add column if not exists plan_bodyshop_start_date date;

-- Arsalan, the bodyshop manager, leads Dismantle & refit (the owner's batch of 28 October).
update public.staff set team = 'dismantle_refit'
 where role_id = 'workshop_manager' and department_id = 'bodyshop' and team is null and display_name ilike 'arsalan%';

notify pgrst, 'reload schema';
