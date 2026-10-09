-- One work line per quotation line. Two requests that build the work order at the same moment can
-- no longer leave duplicates; any that already exist are retired first (the earliest one stays).
update public.work_lines w set is_active = false
from (select id, row_number() over (partition by job_id, quotation_line_id order by created_at) as rn from public.work_lines where quotation_line_id is not null and is_active) d
where w.id = d.id and d.rn > 1;
create unique index if not exists work_lines_one_per_quotation_line on public.work_lines (job_id, quotation_line_id) where quotation_line_id is not null and is_active;
