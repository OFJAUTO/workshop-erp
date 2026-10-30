-- Additional estimates (30 October 2026).
--
-- 1. quotations.additional_to_id: an estimate made with "Make an additional estimate" names the open estimate of
--    the same car it adds to. The customer's copy is then titled "ADDITIONAL ESTIMATE – in addition to E-00035".
--    New versions of it keep the link.
-- 2. quotations.carried_job_id: an estimate carried over to a job at gate-in. Every open estimate of the car
--    carries over (the original as jobs.estimate_id, as before); each becomes its own quotation on the job when
--    the quotation starts.
--
-- Both are plain uuid columns WITHOUT a foreign key on purpose: another relation between quotations and jobs
-- would make PostgREST embeds ambiguous (quotations.job_id and jobs.estimate_id already exist).
-- quotations keeps its table-level grants and policies; no new table, so nothing else to grant.

alter table public.quotations add column if not exists additional_to_id uuid;
alter table public.quotations add column if not exists carried_job_id uuid;

create index if not exists quotations_additional_to_idx on public.quotations (additional_to_id) where additional_to_id is not null;
create index if not exists quotations_carried_job_idx on public.quotations (carried_job_id) where carried_job_id is not null;

-- Additional estimates made before this column existed (the fix went live first) logged the estimate they add to:
-- "Additional estimate E-00040, in addition to E-00035, started by Anas". Their link is filled in from that note.
update public.quotations q
set additional_to_id = (
  select b.id from public.quotations b
  where b.kind = 'estimate' and b.number = substring(e.note from 'in addition to (E-[0-9]+)')
  order by b.version limit 1
)
from public.quotation_events e
where e.quotation_id = q.id and e.event_type = 'estimate_additional' and q.additional_to_id is null;
-- Their later versions follow the first one.
update public.quotations v set additional_to_id = f.additional_to_id
from public.quotations f
where v.kind = 'estimate' and v.number = f.number and v.version > 1 and f.version = 1 and f.additional_to_id is not null and v.additional_to_id is null;

comment on column public.quotations.additional_to_id is 'An additional estimate: the open estimate of the same car it adds to (30 Oct 2026).';
comment on column public.quotations.carried_job_id is 'An estimate carried over to this job at gate-in (30 Oct 2026); it becomes its own quotation on the job.';

notify pgrst, 'reload schema';
