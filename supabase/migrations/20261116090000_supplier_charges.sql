-- 22 October 2026: supplier charges and the import safety lock.
-- A supplier's quotation can carry a line that is not a part ("COURIER CHARGE 1.00 7,500.00"). It is kept here,
-- never as a parts line: it rides on that supplier's LPO as an "Other charges" row and counts as an internal cost
-- of the job (profit, the quotation's internal box, the target). The customer never sees it.

create table if not exists public.supplier_charges (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  supplier_id uuid references public.suppliers(id),
  supplier_name text not null,
  description text not null,
  amount_aed numeric(12,2) not null check (amount_aed >= 0),
  -- The price import that made it ("Undo last import" takes it away again), or null when typed by hand.
  import_id uuid references public.price_imports(id),
  -- The LPO it rides on once one is raised (the main LPO first, then the supplier's own LPO at approval).
  po_id uuid references public.purchase_orders(id),
  removed_at timestamptz,
  removed_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index if not exists supplier_charges_job on public.supplier_charges (job_id) where is_active;
create index if not exists supplier_charges_po on public.supplier_charges (po_id) where is_active;

-- 1. RLS on; 2. the people who see parts costs may read; writes go through server actions only;
-- 3. grants: the server (service_role) only - every screen reads it through the server.
alter table public.supplier_charges enable row level security;
create policy supplier_charges_read on public.supplier_charges
  for select to authenticated using (has_role('owner', 'parts', 'accounts', 'service_advisor'));
grant all on public.supplier_charges to service_role;

create trigger supplier_charges_audit after insert or update on public.supplier_charges for each row execute function write_audit_log();
create trigger supplier_charges_nodel before delete on public.supplier_charges for each row execute function prevent_delete();
create trigger supplier_charges_stamp before insert or update on public.supplier_charges for each row execute function set_audit_columns();

-- The safety lock's override on a price import (the totals did not match and Parts typed why) is written down.
alter table public.price_imports add column if not exists totals_override text;
alter table public.price_imports add column if not exists totals_sum_aed numeric(14,2);
alter table public.price_imports add column if not exists totals_expected_aed numeric(14,2);

notify pgrst, 'reload schema';
