-- Section 4 (8 November 2026): open jobs with NO advisor get the service advisor who made their quotation or estimate
-- (the same rule the code now applies by itself: fillMissingAdvisor in src/lib/job-advisor.ts). Only these five jobs;
-- a job that has an advisor, or whose quotation was made by the owner, is not touched. Once only (advisor_id is null).
with pick(job_number, advisor) as (values
  ('J-00343', 'Adarsh'), ('J-00470', 'Adarsh'), ('J-00492', 'Adarsh'), ('J-00974', 'Adarsh'), ('J-00992', 'Anas')
), upd as (
  update public.jobs j set advisor_id = s.id, updated_by = s.id
    from pick p join public.staff s on s.display_name = p.advisor and s.role_id = 'service_advisor' and s.is_active
   where j.job_number = p.job_number and j.advisor_id is null
  returning j.id, s.id as staff_id
)
insert into public.job_events (job_id, event_type, note, created_by)
select id, 'advisor_set', 'Advisor set from the quotation or estimate (the job had none)', staff_id from upd;
