-- The bell only counts what is still open (9 November 2026): a notice whose task is done is CLEARED for everyone who
-- got it (cleared_at, with read_at), and read or cleared notices are ARCHIVED after 30 days (archived_at: they leave
-- the bell panel; nothing is deleted). The server writes both through the admin client.
alter table public.notifications add column if not exists cleared_at timestamptz;
alter table public.notifications add column if not exists archived_at timestamptz;

create index if not exists notifications_open_idx on public.notifications (staff_id, created_at desc) where archived_at is null;

notify pgrst, 'reload schema';
