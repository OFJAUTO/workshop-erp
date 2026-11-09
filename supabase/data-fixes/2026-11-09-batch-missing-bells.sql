-- Warranty batch (9 November 2026, Section 6): the one certificate issued with a PPF and a tint line but no roll/batch
-- (read on live 9 Nov): J-00974, Land Rover Range Rover 2026, handover 9 Nov, advisor Adarsh. One bell to the advisor in
-- charge and one to each bodyshop-side manager. No data is changed; once the batch is entered on the car's Warranty
-- details, the certificate shows it with the same number (W-00974) and the same dates. Once only.
with job as (
  select id, job_number, advisor_id from public.jobs where job_number = 'J-00974'
), who as (
  select advisor_id as staff_id from job where advisor_id is not null
  union
  select s.id from public.staff s where s.role_id = 'workshop_manager' and s.is_active and s.department_id in ('bodyshop', 'paint', 'ppf_tint', 'detailing')
)
insert into public.notifications (staff_id, type, title, body, job_id, href)
select w.staff_id, 'batch_missing',
       'Batch number missing for: OFJ Bespoke PPF, window tint · ' || j.job_number,
       'The warranty certificate of the 9 November handover shows no roll/batch for the PPF and the tint. Pick the rolls on the car''s Warranty details (or type them): the certificate then shows them, same number and dates. Send the customer the link again.',
       j.id, '/bodyshop/' || j.id || '#warranty'
  from who w cross join job j
 where not exists (select 1 from public.notifications n where n.type = 'batch_missing' and n.job_id = j.id and n.staff_id = w.staff_id);
