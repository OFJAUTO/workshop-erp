-- Password setup links: valid 24 hours, used up only when a password is saved.
-- Opening the link (for example by a WhatsApp preview) changes nothing.
create table public.setup_links (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff (id),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id)
);
create index setup_links_staff_idx on public.setup_links (staff_id, created_at desc);
alter table public.setup_links enable row level security;
revoke all on public.setup_links from anon;
create policy setup_links_owner_read on public.setup_links for select to authenticated using (public.is_owner());
