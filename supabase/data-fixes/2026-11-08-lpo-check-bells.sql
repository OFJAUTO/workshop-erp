-- Section 3 (8 November 2026): tell the parts desk about open jobs whose parts cannot go on an LPO as they are (the
-- new "Send LPO for selected" rule). Bells only - no part, LPO or job is changed by this file. Once only.
-- The list was read on live (read-only) on 8 November 2026; see docs/lpo-selected-8-nov-note.md.
insert into public.notifications (staff_id, type, title, body, job_id, href)
select s.id, 'lpo_check', x.title, x.body, j.id, '/parts/' || j.id || '#lpo'
  from (values
    ('J-00990', 'J-00990: part number 124AA is on AIR FILTER and DRIVE BELT', 'Both are on LPO-00062. Check the supplier''s paper: give each part its own number, or set "No part number".'),
    ('J-00016', 'J-00016: 30 parts at AED 1.00 from "OFJ Additional"', 'They are not approved yet. A cost under AED 5 cannot go on an LPO: price them with the real supplier and cost before the customer approves.'),
    ('J-00343', 'J-00343: WINDSHIELD MOULDING STRIP at AED 1.00 from "OFJ Additional"', 'A cost under AED 5 cannot go on an LPO: price it with the real supplier and cost.')
  ) as x(job_number, title, body)
  join public.jobs j on j.job_number = x.job_number and j.is_open
  cross join public.staff s
 where s.role_id = 'parts' and s.is_active
   and not exists (select 1 from public.notifications n where n.type = 'lpo_check' and n.job_id = j.id and n.staff_id = s.id);
