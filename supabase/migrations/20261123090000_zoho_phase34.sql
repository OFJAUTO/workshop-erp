-- 27 October 2026, Zoho Books phase 3/4 (docs/zoho-plan.md): the per-supplier VAT switch, vendor credits for
-- returned parts, customer refunds on credit notes, the daily reconciliation store and the go-live settings.

-- 1. A supplier who is genuinely not VAT-registered: no TRN needed, bills post without VAT. Default ON (registered).
alter table public.suppliers add column if not exists vat_registered boolean not null default true;

-- 2. Refund paid to the customer against a credit note (recorded by accounts/owner on the credit note's page).
alter table public.invoices add column if not exists refund_paid_at timestamptz;
alter table public.invoices add column if not exists refund_paid_by uuid references public.staff(id);
alter table public.invoices add column if not exists refund_method text check (refund_method in ('cash', 'transfer'));
alter table public.invoices add column if not exists refund_reference text;
alter table public.invoices add column if not exists refund_amount_aed numeric(12,2);

-- 3. The two new document kinds in the outbox, and their Zoho ids (server-only like the others).
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery', 'vendorcredit', 'cnrefund'));
alter table public.part_items add column if not exists zoho_vendorcredit_id text;
alter table public.invoices add column if not exists zoho_refund_id text;
drop trigger if exists part_items_zoho_protect on public.part_items;
create trigger part_items_zoho_protect before update on public.part_items for each row execute function public.erp_protect_zoho_ids('zoho_vendorcredit_id');
drop trigger if exists invoices_zoho_protect on public.invoices;
create trigger invoices_zoho_protect before update on public.invoices for each row execute function public.erp_protect_zoho_ids('zoho_invoice_id', 'zoho_creditnote_id', 'zoho_refund_id');

-- 4. One reconciliation line per day: the ERP's figures next to Zoho's, green or red. Server-only.
create table if not exists public.zoho_reconciliation (
  day date primary key,
  status text not null check (status in ('green', 'red')),
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);
alter table public.zoho_reconciliation enable row level security;
revoke all on public.zoho_reconciliation from anon, authenticated;
grant all on public.zoho_reconciliation to service_role;

-- 5. Go-live settings (owner panel on Settings > Zoho Books). Every key seeded: an update on a missing row is silent.
insert into public.settings (key, label, value) values
  ('zoho_golive_reviewed', 'Zoho: OFJ TEST reviewed side by side (who and when)', '{}'::jsonb),
  ('zoho_golive_start_date', 'Zoho: go-live start date (documents before it never post)', '""'::jsonb),
  ('zoho_golive_log', 'Zoho: go-live switch history', '[]'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
