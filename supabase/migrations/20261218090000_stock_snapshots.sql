-- 16 November 2026, Section 1: STOCK STAYS IN THE ERP ONLY. The stock report saves one snapshot of the stock count and
-- value on the last day of each month (per item: quantity, cost, value), taken by the hourly job on the 1st. Server-only:
-- the report page reads it through the server (owner and accounts).

create table if not exists public.stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_of date not null unique,
  -- [{ itemId, name, partNumber, itemType, unit, quantity, unitCost, value }]
  rows jsonb not null default '[]'::jsonb,
  total_value numeric(14, 2) not null default 0,
  item_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);

alter table public.stock_snapshots enable row level security;
revoke all on public.stock_snapshots from anon, authenticated;
grant all on public.stock_snapshots to service_role;

drop trigger if exists stock_snapshots_audit on public.stock_snapshots;
create trigger stock_snapshots_audit after insert or update on public.stock_snapshots for each row execute function public.write_audit_log();
drop trigger if exists stock_snapshots_stamp on public.stock_snapshots;
create trigger stock_snapshots_stamp before insert or update on public.stock_snapshots for each row execute function public.set_audit_columns();
drop trigger if exists stock_snapshots_no_delete on public.stock_snapshots;
create trigger stock_snapshots_no_delete before delete on public.stock_snapshots for each row execute function public.prevent_delete();

notify pgrst, 'reload schema';
