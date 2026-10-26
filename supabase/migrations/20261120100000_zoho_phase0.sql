-- 26 October 2026, Zoho Books phase 0 (docs/zoho-plan.md): the connection only, nothing posts yet.
-- zoho_tokens holds the owner's one OAuth permission, encrypted. Server-only: RLS on, NO policies, no anon or
-- authenticated grants, only service_role (the security test's SERVER_ONLY list enforces it). No audit trigger:
-- the token refresh writes last_error, and connect/disconnect are logged to audit_log by hand without the token.
create table if not exists public.zoho_tokens (
  id uuid primary key default gen_random_uuid(),
  dc text not null default 'com',
  scope text,
  refresh_token_enc text not null,
  connected_by uuid references public.staff(id),
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_error text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);
alter table public.zoho_tokens enable row level security;
revoke all on public.zoho_tokens from anon, authenticated;
grant all on public.zoho_tokens to service_role;

-- The organizations and the go-live switch. The REAL organization is read-only in code until the switch is on.
insert into public.settings (key, label, value) values
  ('zoho_org_real', 'Zoho: REAL organization id (read-only until go-live)', to_jsonb('942979945'::text)),
  ('zoho_org_test', 'Zoho: TEST organization id (writes go here)', to_jsonb(''::text)),
  ('zoho_live_enabled', 'Zoho: go-live switch', to_jsonb(false))
on conflict (key) do nothing;

notify pgrst, 'reload schema';
