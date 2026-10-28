-- B1 review (28 October 2026): jobs released before the bodyshop stamp existed get it, so their Planning card never
-- waits for a bodyshop release that already happened.
-- 1. A bodyshop job released the old way (one release for the whole job).
update public.jobs
   set plan_bodyshop_released_at = plan_released_at,
       plan_bodyshop_released_by = plan_released_by,
       plan_bodyshop_start_date = plan_start_date
 where department = 'bodyshop' and plan_released_at is not null and plan_bodyshop_released_at is null;
-- 2. Any job whose bodyshop stages already started (from the gate-in or by hand): released when they started.
update public.jobs
   set plan_bodyshop_released_at = bodyshop_started_at,
       plan_bodyshop_start_date = (bodyshop_started_at at time zone 'Asia/Dubai')::date
 where bodyshop_started_at is not null and plan_bodyshop_released_at is null;
-- 3. A mixed job released the old way before its bodyshop side could be released separately: the one release covered it.
update public.jobs
   set plan_bodyshop_released_at = plan_released_at,
       plan_bodyshop_released_by = plan_released_by,
       plan_bodyshop_start_date = plan_start_date
 where department = 'both' and plan_released_at is not null and plan_bodyshop_released_at is null and plan_released_at < '2026-10-28T12:00:00+04:00';
