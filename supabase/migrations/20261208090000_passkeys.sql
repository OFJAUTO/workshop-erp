-- Login security upgrade (7 November 2026, the owner's list): passkeys for the office roles, kept by our own server
-- (SimpleWebAuthn), never by Supabase's beta passkeys. Every table here is SERVER ONLY: RLS on, no policies, nothing
-- granted to anon or authenticated (the security test lists them in SERVER_ONLY). Only server code reads or writes
-- them, through the admin client, after its own checks (the owner alone removes a phone).

-- 1. The phones (and PCs) each person approves sign-ins with. The public key is not a secret.
create table if not exists public.staff_passkeys (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean,
  aaguid text,
  name text not null,
  user_agent text,
  last_used_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.staff(id),
  removed_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);
create index if not exists staff_passkeys_staff_idx on public.staff_passkeys (staff_id) where removed_at is null;
alter table public.staff_passkeys enable row level security;
revoke all on public.staff_passkeys from anon, authenticated;
grant all on public.staff_passkeys to service_role;
drop trigger if exists staff_passkeys_audit on public.staff_passkeys;
create trigger staff_passkeys_audit after insert or update on public.staff_passkeys for each row execute function public.write_audit_log();
drop trigger if exists staff_passkeys_stamp on public.staff_passkeys;
create trigger staff_passkeys_stamp before insert or update on public.staff_passkeys for each row execute function public.set_audit_columns();
drop trigger if exists staff_passkeys_no_delete on public.staff_passkeys;
create trigger staff_passkeys_no_delete before delete on public.staff_passkeys for each row execute function public.prevent_delete();

-- 2. One-time challenges for each passkey ceremony (five minutes, used once). Not business data: the hourly
--    clean-up removes old ones, so no audit and no no-delete trigger.
create table if not exists public.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('login', 'register', 'confirm')),
  challenge text not null,
  staff_id uuid references public.staff(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists passkey_challenges_created_idx on public.passkey_challenges (created_at);
alter table public.passkey_challenges enable row level security;
revoke all on public.passkey_challenges from anon, authenticated;
grant all on public.passkey_challenges to service_role;

-- 3. Every sign-in (and refused sign-in) of a named person, by method.
create table if not exists public.sign_in_events (
  id bigint generated always as identity primary key,
  staff_id uuid references public.staff(id),
  method text not null,
  ok boolean not null,
  reason text,
  passkey_id uuid references public.staff_passkeys(id),
  user_agent text,
  at timestamptz not null default now()
);
create index if not exists sign_in_events_staff_idx on public.sign_in_events (staff_id, at desc);
create index if not exists sign_in_events_at_idx on public.sign_in_events (at desc);
alter table public.sign_in_events enable row level security;
revoke all on public.sign_in_events from anon, authenticated;
grant all on public.sign_in_events to service_role;
drop trigger if exists sign_in_events_no_delete on public.sign_in_events;
create trigger sign_in_events_no_delete before delete on public.sign_in_events for each row execute function public.prevent_delete();

-- 4. Every change to how a person signs in: a phone added or removed, passkeys reset, a password chosen or changed,
--    a setup link, a temporary PIN, the login method, a skipped setup, the rollout switch.
create table if not exists public.sign_in_changes (
  id bigint generated always as identity primary key,
  staff_id uuid references public.staff(id),
  kind text not null,
  detail text,
  passkey_id uuid references public.staff_passkeys(id),
  by_staff_id uuid references public.staff(id),
  user_agent text,
  at timestamptz not null default now()
);
create index if not exists sign_in_changes_staff_idx on public.sign_in_changes (staff_id, at desc);
create index if not exists sign_in_changes_at_idx on public.sign_in_changes (at desc);
alter table public.sign_in_changes enable row level security;
revoke all on public.sign_in_changes from anon, authenticated;
grant all on public.sign_in_changes to service_role;
drop trigger if exists sign_in_changes_no_delete on public.sign_in_changes;
create trigger sign_in_changes_no_delete before delete on public.sign_in_changes for each row execute function public.prevent_delete();

-- 5. The rollout switch: the owner alone first, then everyone in the passkey roles.
insert into public.settings (key, value, label)
values ('passkeys_rollout', to_jsonb('owner'::text), 'Passkeys switched on for (owner = only the owner, all = every passkey role)')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
