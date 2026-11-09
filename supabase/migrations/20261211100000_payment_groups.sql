-- One payment for several cars (9 November 2026, Section 3; AL ALI PROPERTY INVESTMENTS LLC paid two Corollas with ONE
-- cheque, Emirates NBD 019383 dated 2 Nov 2026, AED 4,368.00). A payment group is that one payment: its number (CP-),
-- method, full amount and cheque/transfer details. Each car's share is an ordinary payment (receipt) pointing at the
-- group; a combined cheque or transfer clears or bounces as ONE (every share together). What is left over after the
-- shares is an unallocated advance on the customer, also in the group. "Replace with combined payment" voids the old
-- receipts and keeps which ones it replaced.

create table if not exists public.payment_groups (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.customers(id),
  method text not null check (method in ('cash', 'card', 'link', 'cheque', 'transfer')),
  amount_aed numeric(12, 2) not null check (amount_aed > 0),
  received_at timestamptz not null default now(),
  reference text,
  auth_code text,
  cheque_number text,
  cheque_bank text,
  cheque_date date,
  notes text,
  replaced_payment_ids uuid[] not null default '{}',
  replace_reason text,
  client_key text unique,
  zoho_payment_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);

alter table public.payments add column if not exists group_id uuid references public.payment_groups(id);
create index if not exists payments_group_idx on public.payments (group_id) where group_id is not null;

-- Server-only (the screens read and write it through the server): RLS on, no policies, no grants to logins.
alter table public.payment_groups enable row level security;
revoke all on public.payment_groups from anon, authenticated;
grant all on public.payment_groups to service_role;

-- The change log and no deletes, like every business table.
drop trigger if exists payment_groups_audit on public.payment_groups;
create trigger payment_groups_audit after insert or update on public.payment_groups for each row execute function public.write_audit_log();
drop trigger if exists payment_groups_no_delete on public.payment_groups;
create trigger payment_groups_no_delete before delete on public.payment_groups for each row execute function public.prevent_delete();

-- Zoho: one customer payment for the whole group, applied to each car's invoice.
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery', 'vendorcredit', 'cnrefund', 'settlement', 'supplierpay', 'paygroup'));

notify pgrst, 'reload schema';

-- The two new customer messages (statement of account, one bill for several cars): their Settings rows.
insert into public.settings (key, label, value) values
  ('whatsapp_statement_template', 'WhatsApp: statement of account', to_jsonb(E'Dear [name],\n\nHere is your statement of account with OFJ Automotive (open invoices, payments and the balance):\n[link]\n\nOFJ Automotive'::text)),
  ('whatsapp_combined_bill_template', 'WhatsApp: one bill for several cars', to_jsonb(E'Dear [name],\n\nHere is one bill for your [cars] cars with us (each car receives its own tax invoice once paid):\n[link]\n\nOFJ Automotive'::text))
on conflict (key) do nothing;
