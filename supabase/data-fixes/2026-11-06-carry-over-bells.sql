-- Section 1 (6 November 2026): tell the advisors of the two jobs whose quotation lost the estimate's labour and service
-- lines (the batch insert failed on the empty unit). Bells only - no quotation is changed by this file. Once only.
insert into public.notifications (staff_id, type, title, body, job_id, href)
select j.advisor_id, 'estimate_carry_mismatch',
       'Q-00061 is missing 2 lines from E-00062 (AED 2,800.00)',
       'RIGHT SIDE SKIRT REPLACE AND PAINT and REAR BOTTOM COVER REPLACE AND PAINT did not come over. Open Q-00061 and tap "Add the missing lines from the estimate".',
       j.id, '/jobs/' || j.id || '/quote/' || q.id
  from public.jobs j join public.quotations q on q.job_id = j.id and q.number = 'Q-00061' and q.is_active
 where j.job_number = 'J-00988' and j.advisor_id is not null
   and not exists (select 1 from public.notifications n where n.type = 'estimate_carry_mismatch' and n.job_id = j.id);
insert into public.notifications (staff_id, type, title, body, job_id, href)
select j.advisor_id, 'estimate_carry_mismatch',
       'Q-00050 left out 4 free lines of E-00059 (AED 0.00)',
       'COMPUTER DIAGNOSIS, ALL FLUIDS INSPECTION, TPMS RESET and BASIC CAR WASH (all AED 0.00) were not on Q-00050. It is approved and invoiced (INV-00005), so nothing was changed - for your information.',
       j.id, '/jobs/' || j.id
  from public.jobs j
 where j.job_number = 'J-00978' and j.advisor_id is not null
   and not exists (select 1 from public.notifications n where n.type = 'estimate_carry_mismatch' and n.job_id = j.id);
