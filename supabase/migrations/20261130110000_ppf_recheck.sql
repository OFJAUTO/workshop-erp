-- PPF recheck as its own visit (30 October 2026).
--
-- 1. jobs.job_kind 'recheck': the FREE 10-day final check after a PPF job. No inspection fee, no quotation, no customer
--    approval, no invoice; it goes straight to the PPF team as one "PPF final check" stage.
-- 2. jobs.recheck_of: the original PPF job it checks. A plain uuid without a foreign key on purpose (jobs already has
--    comeback_of; another self-reference would make PostgREST embeds of jobs ambiguous).
-- 3. aftercare_checks.recheck_job_id / redo: the visit that did the check, and whether something had to be redone
--    (then it also counts as a comeback). The checklist itself goes in the existing findings jsonb.
-- jobs has column-level select grants for the login role (customer privacy, 29 October): the new column gets its own.

alter table public.jobs drop constraint if exists jobs_job_kind_check;
alter table public.jobs add constraint jobs_job_kind_check check (job_kind in ('car', 'loose', 'recheck'));
alter table public.jobs add column if not exists recheck_of uuid;
create index if not exists jobs_recheck_of_idx on public.jobs (recheck_of) where recheck_of is not null;
grant select (recheck_of) on public.jobs to authenticated;

alter table public.aftercare_checks add column if not exists recheck_job_id uuid;
alter table public.aftercare_checks add column if not exists redo boolean not null default false;

comment on column public.jobs.recheck_of is 'A PPF recheck visit (job_kind recheck): the original PPF job it checks (30 Oct 2026).';
comment on column public.aftercare_checks.recheck_job_id is 'The recheck visit that did the 10-day final check (30 Oct 2026).';

notify pgrst, 'reload schema';

-- The day-8 message (30 October 2026): "Your OFJ BESPOKE final check is due", unless the owner already changed it.
update public.settings set value = to_jsonb('Good day! Your OFJ BESPOKE final check is due on [date]. It is free and takes about half an hour: we check the film edges and fix anything that needs it. When would suit you?'::text)
where key = 'whatsapp_aftercare_template' and value = to_jsonb('Good day! Your car is due for its complimentary 10-day after-care check on [date]. It takes about half an hour - we check the film edges and polish anything that needs it. When would suit you?'::text);
