-- 16 October 2026, evening: the scans mailbox is connected by a one-time Google sign-in as scans@ofjauto.com (OAuth,
-- gmail.readonly) instead of a service account with domain-wide delegation. Google's long-term permission is stored
-- encrypted here; only the server (service role) can read the table: row level security on, no policies.
-- No audit trigger on purpose: the change log would copy the encrypted token. Connect and disconnect are written to
-- the change log by the server without it.

create table if not exists public.google_mailbox_tokens (
  id                 uuid primary key default gen_random_uuid(),
  mailbox            text not null,
  refresh_token_enc  text not null,
  scope              text not null,
  connected_at       timestamptz not null default now(),
  connected_by       uuid references public.staff (id),
  revoked_at         timestamptz,
  last_error         text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);
create index if not exists google_mailbox_tokens_active_idx on public.google_mailbox_tokens (is_active, connected_at desc);
alter table public.google_mailbox_tokens enable row level security;
revoke all on public.google_mailbox_tokens from anon, authenticated;
drop trigger if exists google_mailbox_tokens_audit_columns on public.google_mailbox_tokens;
create trigger google_mailbox_tokens_audit_columns before insert or update on public.google_mailbox_tokens for each row execute function public.set_audit_columns();
