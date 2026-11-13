-- 13 November 2026 (Section 12): team form with two clean levels - move existing people so Department (Mechanical,
-- Bodyshop, Office) and Team agree. Each update is guarded by the old values, so a person changed meanwhile is left alone.
-- The list with the labour-rate effect is in docs/team-levels-13-nov-note.md. WAITING FOR APPLY.
begin;
-- ABDUL GHANI (technician): bodyshop/painting -> paint/painting = Bodyshop · Painting (cost rate 45 → 42 AED/h)
update public.staff set department_id = 'paint', team = 'painting' where id = 'b67bb17a-2b78-48dc-bf8a-643d60f38473' and department_id = 'bodyshop' and team is not distinct from 'painting';
-- ALEEMATH (accounts): mechanical/- -> office/- = Office · Accounts (cost rate 50 → - AED/h)
update public.staff set department_id = 'office', team = null where id = 'b418bf8f-6194-4dfc-972f-ddff4bb2e316' and department_id = 'mechanical' and team is not distinct from null;
-- ARSLAN AHMAD (technician): bodyshop/painting -> paint/painting = Bodyshop · Painting (cost rate 45 → 42 AED/h)
update public.staff set department_id = 'paint', team = 'painting' where id = '5507e864-740b-4b8c-bbec-278615c576ed' and department_id = 'bodyshop' and team is not distinct from 'painting';
-- DILWAR (technician): bodyshop/ppf -> ppf_tint/ppf = Bodyshop · PPF and tint (cost rate 45 → 50 AED/h)
update public.staff set department_id = 'ppf_tint', team = 'ppf' where id = '08535d59-98de-498b-827c-c0494405978e' and department_id = 'bodyshop' and team is not distinct from 'ppf';
-- JOSHUA (technician): mechanical/- -> mechanical/technicians = Mechanical · Technicians
update public.staff set department_id = 'mechanical', team = 'technicians' where id = 'bf6259aa-aea2-4a84-878c-0542a7667470' and department_id = 'mechanical' and team is not distinct from null;
-- KAMRUL (technician): bodyshop/detailing_cleaning -> detailing/detailing_cleaning = Bodyshop · Detailing & cleaning (cost rate 45 → 40 AED/h)
update public.staff set department_id = 'detailing', team = 'detailing_cleaning' where id = '03e3f41a-b4fa-4980-ab5b-096bb8a96630' and department_id = 'bodyshop' and team is not distinct from 'detailing_cleaning';
-- NAJMUL (technician): bodyshop/detailing_cleaning -> detailing/detailing_cleaning = Bodyshop · Detailing & cleaning (cost rate 45 → 40 AED/h)
update public.staff set department_id = 'detailing', team = 'detailing_cleaning' where id = '2fa20902-97e1-4279-90e3-9d642c9dbf07' and department_id = 'bodyshop' and team is not distinct from 'detailing_cleaning';
-- SHA ALOM (technician): mechanical/ppf -> ppf_tint/ppf = Bodyshop · PPF and tint
update public.staff set department_id = 'ppf_tint', team = 'ppf' where id = 'f1795b7b-1be4-4bde-86a2-0c8231dbf61f' and department_id = 'mechanical' and team is not distinct from 'ppf';
-- SUFIYAN (technician): detailing/technicians -> detailing/detailing_cleaning = Bodyshop · Detailing & cleaning
update public.staff set department_id = 'detailing', team = 'detailing_cleaning' where id = '868b7d2a-9794-4161-bd52-cb6d07030dbb' and department_id = 'detailing' and team is not distinct from 'technicians';
commit;
