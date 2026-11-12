-- 13 November 2026, Section 3: change a part's supplier or price IN PLACE (never remove and add it again).
-- One row per change: what it was, what it became, why, who; a change that needs the owner (cost up or a different
-- part type) waits here (status pending) until he decides. Server-only: the screens read it through the server.

create table if not exists public.part_changes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  part_item_id uuid not null references public.part_items(id),
  before jsonb not null,
  after jsonb not null,
  reason text not null,
  -- 'keep' = the customer's price stays and we absorb the difference; 'revise' = the quotation is revised.
  price_choice text check (price_choice in ('keep', 'revise')),
  absorb_aed numeric(12,2),
  status text not null default 'applied' check (status in ('pending', 'applied', 'refused')),
  words text not null,
  decided_by uuid references public.staff(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index if not exists part_changes_part_idx on public.part_changes (part_item_id, created_at desc);
create index if not exists part_changes_pending_idx on public.part_changes (status) where status = 'pending';

alter table public.part_changes enable row level security;
revoke all on public.part_changes from anon, authenticated;
grant all on public.part_changes to service_role;

drop trigger if exists part_changes_audit on public.part_changes;
create trigger part_changes_audit after insert or update on public.part_changes for each row execute function public.write_audit_log();
drop trigger if exists part_changes_stamp on public.part_changes;
create trigger part_changes_stamp before insert or update on public.part_changes for each row execute function public.set_audit_columns();
drop trigger if exists part_changes_no_delete on public.part_changes;
create trigger part_changes_no_delete before delete on public.part_changes for each row execute function public.prevent_delete();

notify pgrst, 'reload schema';
