-- 26 October 2026, Zoho Books phase 1 (docs/zoho-plan.md): customers, tax invoices, payments and deposits post to
-- OFJ TEST through an outbox. One row per document to post; the screens only insert here, and the worker (the
-- five-minute Zoho cron and the Sync now button on the live site) talks to Zoho. Nothing posts twice: the Zoho id
-- lands on the ERP record and the outbox row, and a retry adopts what already exists in Zoho instead of creating
-- it again. Server-only like zoho_tokens and background_jobs: no policies, no anon/authenticated grants, the sync
-- page reads it through the server as owner or accounts.
create table if not exists public.zoho_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('contact', 'deposit', 'invoice', 'payment')),
  record_id uuid not null,
  job_id uuid,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
  attempts integer not null default 0,
  last_error text,
  zoho_id text,
  -- The compact comparison written at sync time: Zoho's own figures next to the ERP's (totals, VAT, balance,
  -- credits applied), so the sync page and the tests prove the match without reading Zoho again.
  zoho_result jsonb,
  enqueued_at timestamptz not null default now(),
  synced_at timestamptz,
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  unique (kind, record_id)
);
alter table public.zoho_outbox enable row level security;
revoke all on public.zoho_outbox from anon, authenticated;
grant all on public.zoho_outbox to service_role;
create index if not exists zoho_outbox_status_idx on public.zoho_outbox (status, enqueued_at);

-- The Zoho id on every synced record (one-way: ids and status are the only things ever read back from Zoho).
alter table public.customers add column if not exists zoho_contact_id text;
alter table public.invoices add column if not exists zoho_invoice_id text;
alter table public.payments add column if not exists zoho_payment_id text;

-- The account mapping (Settings > Zoho Books > Mapping): Zoho account NAMES, not ids, so the mapping made against
-- OFJ TEST today still reads in the REAL organization at go-live (the worker resolves names to ids in whichever
-- organization it writes to). Seeded empty; the screen pre-fills suggestions and the owner or accounts save.
insert into public.settings (key, label, value) values
  ('zoho_account_map', 'Zoho Books: account mapping (names)', '{}'::jsonb)
on conflict (key) do nothing;

-- The sync worker joins the background-jobs box (Settings): every run recorded, late over 20 minutes rings once.
insert into public.background_jobs (key, label, schedule_label, late_after_minutes) values
  ('zoho', 'Zoho sync', 'every 5 minutes', 20)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
