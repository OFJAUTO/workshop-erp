-- 26 October 2026, Zoho phase 1 review fix: a worked-on outbox row is CLAIMED (claimed_at), so a second drain that
-- starts mid-handler (the five-minute cron next to a Sync now) can never run the same row twice. A claim older than
-- ten minutes counts as dead (a worker that was killed) and the row may be taken again.
alter table public.zoho_outbox add column if not exists claimed_at timestamptz;
notify pgrst, 'reload schema';
