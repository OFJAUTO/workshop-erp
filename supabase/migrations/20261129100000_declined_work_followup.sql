-- Batch 29 October 2026 (2), section 2: declined work saved for later. Every finding or line the customer declined
-- keeps its status (Replace now / Replace / Advisory), and the advisor is reminded to call the customer about it after
-- a set number of days (Settings, default 14). When the work is done on a later visit the row is closed.

alter table public.declined_work add column if not exists severity text
  check (severity is null or severity in ('Replace now', 'Replace', 'Advisory'));
alter table public.declined_work add column if not exists follow_up_due_at timestamptz;
alter table public.declined_work add column if not exists followed_up_at timestamptz;
alter table public.declined_work add column if not exists followed_up_by uuid references public.staff (id);
alter table public.declined_work add column if not exists follow_up_note text;
alter table public.declined_work add column if not exists done_at timestamptz;

comment on column public.declined_work.severity is 'Replace now (dangerous / replace now), Replace (bad / required) or Advisory, from the inspection report.';
comment on column public.declined_work.follow_up_due_at is 'When the advisor should call the customer about it (Settings: declined_followup_days).';

create index if not exists declined_work_follow_up_idx on public.declined_work (follow_up_due_at) where followed_up_at is null and is_active;

insert into public.settings (key, value, label, description) values
  ('declined_followup_days', '14', 'Call about declined work after (days)', 'The advisor is reminded on Waiting on you to call the customer about the work they declined.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
