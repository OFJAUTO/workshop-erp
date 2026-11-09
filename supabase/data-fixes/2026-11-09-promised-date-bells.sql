-- Promised date on every approved job (9 November 2026): ONE bell per advisor listing their open approved jobs with no
-- promised date (approved, in planning, in work, QC or wash). A job with no advisor goes to the owner. No date is set
-- by this file - the advisor sets each one on the job card ("No promised date yet: set it now"). Once only.
with missing as (
  select j.id, j.job_number, j.advisor_id
    from public.jobs j
   where j.is_open and j.promised_at is null
     and j.status in ('approved', 'waiting_parts', 'in_work', 'pending_qc', 'pending_wash')
), owner as (
  select s.id from public.staff s where s.role_id = 'owner' and s.is_active order by s.created_at limit 1
), per as (
  select coalesce(m.advisor_id, (select id from owner)) as staff_id,
         count(*) as n,
         string_agg(m.job_number, ', ' order by m.job_number) as jobs,
         (array_agg(m.id order by m.job_number))[1] as first_job
    from missing m
   group by 1
)
insert into public.notifications (staff_id, type, title, body, job_id, href)
select p.staff_id, 'promised_missing',
       p.n || ' approved car' || case when p.n = 1 then '' else 's' end || ' with no promised date',
       'Set the promised date on each job card (the day the customer is told): ' || p.jobs || '.',
       p.first_job, '/jobs/' || p.first_job || '#planning'
  from per p
 where p.staff_id is not null
   and not exists (select 1 from public.notifications n where n.type = 'promised_missing' and n.staff_id = p.staff_id);
