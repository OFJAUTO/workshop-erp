-- ZOHO BOOKS: MANUAL SYNC (3 November 2026, the 2 November evening batch, section 11).
--
-- The owner asked that nothing goes to Zoho by itself any more. The code switches to MANUAL the moment it is deployed
-- (a missing zoho_sync_mode row reads as manual), so this file only adds what manual mode keeps on record:
--   1. the setting zoho_sync_mode ('manual' | 'automatic'), seeded 'manual' with its label, so the owner's switch on
--      Settings > Zoho Books saves into a real row (the screen upserts with the label anyway);
--   2. zoho_sync_runs: one row per press of "Sync to Zoho" (who, when, which book, the preview that was confirmed, the
--      outbox rows it covered, and each row's outcome), so the results list stays after the window closes ("Last
--      syncs", /zoho?run=<id>) and only one run goes at a time;
--   3. the background job's words: the five-minute run now sends only when the sync is automatic.
--
-- zoho_sync_runs is SERVER-ONLY, like zoho_outbox: RLS on, no policies, nothing for anon or authenticated; the Zoho
-- Books page reads and writes it through the server as the owner or accounts.

-- 1. The switch (Settings > Zoho Books, owner only). jsonb string 'manual'.
insert into public.settings (key, value, label, description)
values ('zoho_sync_mode', to_jsonb('manual'::text), 'Zoho Books: how documents are sent (manual or automatic)',
        'manual = nothing goes to Zoho until the owner or accounts press Sync to Zoho (a preview first, then Yes). automatic = the five-minute run sends by itself. Only the owner switches it.')
on conflict (key) do nothing;

-- 2. The runs.
create table if not exists public.zoho_sync_runs (
  id uuid primary key default gen_random_uuid(),
  org text,                                                   -- the book it sent to (the OFJ TEST id, or the REAL id)
  book_label text,                                            -- "OFJ TEST" / "the REAL book (O F J AUTOMOTIVE WORKS LLC)"
  started_by uuid references public.staff(id),
  started_name text,                                          -- "Omar, on behalf of …" when acting
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),            -- every part of the run moves it; quiet for 2 minutes = the window closed
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'done', 'stopped')),
  stop_reason text,
  preview jsonb not null default '{}'::jsonb,                 -- the groups, counts and totals the person confirmed
  outbox_ids uuid[] not null default '{}',                    -- the confirmed rows, in posting order (nothing else is ever sent)
  posted integer not null default 0,
  removed integer not null default 0,                         -- taken back out of Zoho (voided or reversed after it posted)
  skipped integer not null default 0,                         -- closed with nothing sent (voided or cancelled before it went, internal)
  failed integer not null default 0,
  waiting integer not null default 0,
  items jsonb not null default '[]'::jsonb,                   -- [{ id, kind, record_id, outcome, words, name, amount, at }]
  updated_at timestamptz not null default now()
);
create index if not exists zoho_sync_runs_started_idx on public.zoho_sync_runs (started_at desc);
-- One run at a time (a run whose window closed is marked stopped after two quiet minutes, freeing the next one).
create unique index if not exists zoho_sync_runs_one_running on public.zoho_sync_runs ((true)) where status = 'running';

alter table public.zoho_sync_runs enable row level security;
revoke all on public.zoho_sync_runs from anon, authenticated;
revoke all on public.zoho_sync_runs from public;
grant all on public.zoho_sync_runs to service_role;

-- 3. Settings > Background jobs reads true: the job still runs every five minutes (the reconciliation and the mode
-- check live there, so a stopped job still rings the owner), it just sends only when automatic.
update public.background_jobs
   set label = 'Zoho check', schedule_label = 'every 5 minutes (sends only when the owner set Zoho to automatic)'
 where key = 'zoho' and label = 'Zoho sync';

notify pgrst, 'reload schema';
