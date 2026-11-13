-- 13 November 2026 (Section 5, E-00092): the parts desk adds a part to an estimate ("+ Add a part"). The line is tagged
-- "Added by Parts", may name the job it is for (parent_line_id, already there), and waits for the advisor: Accept puts it
-- on the estimate, Decline leaves it off. The desk sees the answer. No new table: five columns on the line.

alter table public.quotation_lines add column if not exists parts_added_at timestamptz;
alter table public.quotation_lines add column if not exists parts_added_by uuid references public.staff(id);
alter table public.quotation_lines add column if not exists parts_add_status text;
alter table public.quotation_lines drop constraint if exists quotation_lines_parts_add_status_check;
alter table public.quotation_lines add constraint quotation_lines_parts_add_status_check
  check (parts_add_status is null or parts_add_status in ('pending', 'accepted', 'declined'));
alter table public.quotation_lines add column if not exists parts_add_decided_at timestamptz;
alter table public.quotation_lines add column if not exists parts_add_decided_by uuid references public.staff(id);

notify pgrst, 'reload schema';
