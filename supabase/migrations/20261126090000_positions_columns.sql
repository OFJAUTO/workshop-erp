-- 28 October 2026, A1: positions travel with the line onto invoices and work orders, so every document and the
-- technician's screen print them on their own small line in the short form (ALL 4, FRONT PAIR, ...).
alter table public.invoice_lines add column if not exists positions text[];
alter table public.work_lines add column if not exists positions text[];

-- Fill the work lines of open jobs from the quotation line they came from.
update public.work_lines w set positions = l.positions
from public.quotation_lines l
where w.quotation_line_id = l.id and w.positions is null and l.positions is not null and array_length(l.positions, 1) > 0;

notify pgrst, 'reload schema';
