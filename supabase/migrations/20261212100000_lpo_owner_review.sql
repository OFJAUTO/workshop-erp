-- LPO "SEND FOR OWNER APPROVAL" (10 November 2026, Section 4).
-- When accounts are unsure about an LPO (or one supplier of a request) they send it to the owner with a compulsory note.
-- The owner approves, refuses or replies to accounts. One row per question; the whole history stays.
-- An optional accounts approval limit (off by default): LPOs above it (incl. VAT) wait for the owner by themselves.

create table if not exists public.lpo_owner_reviews (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id),
  -- null = the whole LPO; otherwise one supplier block of a request with several suppliers.
  supplier text,
  -- waiting = with the owner; replied = the owner answered accounts; decided = approved or refused.
  status text not null default 'waiting' check (status in ('waiting', 'replied', 'decided')),
  -- true = sent by the accounts approval limit, not by a person.
  auto boolean not null default false,
  note text not null,
  reply text,
  replied_at timestamptz,
  replied_by uuid references public.staff(id),
  decision text check (decision is null or decision in ('approved', 'refused')),
  decision_note text,
  decided_at timestamptz,
  decided_by uuid references public.staff(id),
  reminded_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);
create index if not exists lpo_owner_reviews_po_idx on public.lpo_owner_reviews (po_id) where is_active;
create index if not exists lpo_owner_reviews_waiting_idx on public.lpo_owner_reviews (status) where is_active and status = 'waiting';

alter table public.lpo_owner_reviews enable row level security;
revoke all on public.lpo_owner_reviews from anon, authenticated;
grant all on public.lpo_owner_reviews to service_role;
drop trigger if exists lpo_owner_reviews_audit on public.lpo_owner_reviews;
create trigger lpo_owner_reviews_audit after insert or update on public.lpo_owner_reviews for each row execute function public.write_audit_log();
drop trigger if exists lpo_owner_reviews_no_delete on public.lpo_owner_reviews;
create trigger lpo_owner_reviews_no_delete before delete on public.lpo_owner_reviews for each row execute function public.prevent_delete();

insert into public.settings (key, label, value) values
  ('lpo_accounts_limit_aed', 'Accounts approve LPOs up to this amount incl. VAT (0 = no limit)', to_jsonb(0))
on conflict (key) do nothing;

notify pgrst, 'reload schema';
