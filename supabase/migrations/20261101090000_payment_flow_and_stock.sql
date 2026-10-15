-- Night of 15 October 2026: the payment flow (expected method on the proforma, Pay now by Network International,
-- "Customer says paid", the final confirmation that makes the tax invoice, waiting reminders), supplier LPO emails,
-- supplier invoice checks, scrap as a disposition, and real stock (stock orders, movements, counts).

-- 1. Proforma and payment flow ----------------------------------------------------------------------
alter table public.invoices add column if not exists expected_payment_method text
  check (expected_payment_method is null or expected_payment_method in ('cash', 'card', 'link', 'cheque', 'transfer'));
alter table public.invoices add column if not exists pay_now_enabled boolean not null default false;
alter table public.invoices add column if not exists customer_says_paid_at timestamptz;
alter table public.invoices add column if not exists customer_says_paid_by uuid references public.staff (id);
alter table public.invoices add column if not exists customer_says_paid_method text;
alter table public.invoices add column if not exists customer_says_paid_note text;
alter table public.invoices add column if not exists waiting_notified_at timestamptz;

-- Payment links: the pasted ones stay as they were; a Pay now link made by Network International carries its order.
alter table public.payment_links add column if not exists provider text not null default 'manual'
  check (provider in ('manual', 'ngenius'));
alter table public.payment_links add column if not exists order_reference text;
alter table public.payment_links add column if not exists amount_aed numeric(12,2);
alter table public.payment_links add column if not exists state text;
alter table public.payment_links add column if not exists paid_at timestamptz;
alter table public.payment_links add column if not exists payment_id uuid references public.payments (id);
alter table public.payment_links add column if not exists provider_payload jsonb;
create unique index if not exists payment_links_order_ref_idx on public.payment_links (order_reference) where order_reference is not null;

-- Automatic payments (the gateway) have no staff member behind them.
alter table public.payments alter column received_by drop not null;

-- 2. Supplier LPO by email ----------------------------------------------------------------------------
alter table public.purchase_orders add column if not exists emailed_at timestamptz;
alter table public.purchase_orders add column if not exists emailed_to text;
alter table public.purchase_orders add column if not exists emailed_by uuid references public.staff (id);

-- 3. Supplier invoice checks: the price on the invoice against the price on the LPO line -------------
alter table public.purchase_order_lines add column if not exists invoice_check text
  check (invoice_check is null or invoice_check in ('match', 'mismatch', 'accepted', 'disputed'));
alter table public.purchase_order_lines add column if not exists invoice_check_by uuid references public.staff (id);
alter table public.purchase_order_lines add column if not exists invoice_check_at timestamptz;
alter table public.purchase_orders add column if not exists supplier_invoice_checked_at timestamptz;
alter table public.purchase_orders add column if not exists supplier_invoice_checked_by uuid references public.staff (id);

-- 4. Returns and leftovers: scrap is a disposition too; a return is written against its LPO line ------
alter table public.part_items drop constraint if exists part_items_disposition_check;
alter table public.part_items add constraint part_items_disposition_check
  check (disposition is null or disposition in ('returned', 'stock', 'fit_pending', 'fit_approved', 'scrap'));
alter table public.part_items add column if not exists stock_item_id uuid references public.stock_items (id);

-- 5. Real stock: stock orders (an LPO with no job), average cost, reorder level, counts ---------------
alter table public.purchase_orders alter column job_id drop not null;
alter table public.purchase_orders drop constraint if exists purchase_orders_kind_check;
alter table public.purchase_orders add constraint purchase_orders_kind_check check (kind in ('main', 'supplier', 'stock'));
alter table public.purchase_order_lines add column if not exists stock_item_id uuid references public.stock_items (id);

alter table public.stock_items add column if not exists part_number text;
alter table public.stock_items add column if not exists supplier_id uuid references public.suppliers (id);
alter table public.stock_items add column if not exists reorder_quantity numeric(12,2) not null default 0;
alter table public.stock_items add column if not exists last_counted_at timestamptz;
alter table public.stock_items add column if not exists last_counted_by uuid references public.staff (id);
alter table public.stock_items add column if not exists low_notified_at timestamptz;

create table if not exists public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  stock_item_id  uuid not null references public.stock_items (id),
  kind           text not null check (kind in ('in', 'out', 'count', 'adjust', 'return')),
  quantity       numeric(12,2) not null,
  unit_cost      numeric(12,2),
  quantity_after numeric(12,2) not null default 0,
  job_id         uuid references public.jobs (id),
  po_id          uuid references public.purchase_orders (id),
  part_item_id   uuid references public.part_items (id),
  note           text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);
create index if not exists stock_movements_item_idx on public.stock_movements (stock_item_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['stock_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop trigger if exists %I_audit_columns on public.%I', t, t);
    execute format('create trigger %I_audit_columns before insert or update on public.%I for each row execute function public.set_audit_columns()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_log()', t, t);
    execute format('drop trigger if exists %I_no_delete on public.%I', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.prevent_delete()', t, t);
  end loop;
end $$;
