-- STOCK: REVERSE A MISTAKEN ENTRY WITH THE OWNER'S APPROVAL (10 November 2026, Section 8).
-- Parts ask to reverse a stock movement (e.g. "Opening stock +5" entered by mistake) with a compulsory reason, or to move
-- it to the job it was bought for. The owner approves or refuses. Approved: an opposite movement (or an issue to the job)
-- is written; quantity and value are corrected; the history is kept; nothing is deleted. An empty item can be archived.

create table if not exists public.stock_reversals (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.stock_movements(id),
  stock_item_id uuid not null references public.stock_items(id),
  -- reverse = the opposite movement; move_to_job = issued to the job the stock was bought for.
  kind text not null default 'reverse' check (kind in ('reverse', 'move_to_job')),
  job_id uuid references public.jobs(id),
  quantity numeric(12,2) not null check (quantity > 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  decision_note text,
  decided_at timestamptz,
  decided_by uuid references public.staff(id),
  result_movement_id uuid references public.stock_movements(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);
create index if not exists stock_reversals_movement_idx on public.stock_reversals (movement_id) where is_active;
create index if not exists stock_reversals_pending_idx on public.stock_reversals (status) where is_active and status = 'pending';

alter table public.stock_reversals enable row level security;
revoke all on public.stock_reversals from anon, authenticated;
grant all on public.stock_reversals to service_role;
drop trigger if exists stock_reversals_audit on public.stock_reversals;
create trigger stock_reversals_audit after insert or update on public.stock_reversals for each row execute function public.write_audit_log();
drop trigger if exists stock_reversals_no_delete on public.stock_reversals;
create trigger stock_reversals_no_delete before delete on public.stock_reversals for each row execute function public.prevent_delete();

-- An item with no stock left can be archived (hidden from the lists, never deleted).
alter table public.stock_items add column if not exists archived_at timestamptz;
alter table public.stock_items add column if not exists archived_by uuid references public.staff(id);

notify pgrst, 'reload schema';
