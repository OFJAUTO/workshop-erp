-- Every refusal written down (30 October 2026, batch 2 section 3.4). When a page refuses someone - the record does not
-- exist, it was cancelled, the car has left, the person has no access to customer details or to that page - the reason
-- is logged here and the person sees it in plain words (/not-here). The owner reads the list at Settings > Refusals.
-- Server-only (written and read through the master key): RLS on, no policies, nothing granted to anon or authenticated.
create table if not exists public.access_refusals (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid references public.staff (id),
  role_id     text,
  code        text not null,
  path        text,
  record_kind text,
  record_id   text,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists access_refusals_created_idx on public.access_refusals (created_at desc);
alter table public.access_refusals enable row level security;
revoke all on public.access_refusals from anon, authenticated;
grant all on public.access_refusals to service_role;
comment on table public.access_refusals is 'Pages that refused someone, with the reason (30 Oct 2026). Server-only; the owner reads it at Settings > Refusals.';
