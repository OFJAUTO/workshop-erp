-- 27 October 2026 (afternoon), section 2: card and payment-link settlements (the bank's ACTUAL fee).
-- A card or payment-link payment goes to Zoho at its FULL amount into the clearing account; when the bank pays
-- the batch out, accounts record the settlement here: the amount actually received, the fee split over the
-- payments in proportion, and Zoho gets the transfer clearing -> bank (net) plus the bank charges (fee).

-- 1. One row per settlement (STL-00001). Server-only: every screen reads it through the server.
create table if not exists public.card_settlements (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  method text not null check (method in ('card', 'link')),
  settled_on date not null,
  payment_count integer not null check (payment_count > 0),
  gross_aed numeric(12,2) not null check (gross_aed > 0),
  received_aed numeric(12,2) not null check (received_aed >= 0),
  fee_aed numeric(12,2) not null check (fee_aed >= 0),
  statement_ref text,
  note text,
  zoho_transfer_id text,
  zoho_fee_id text,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true,
  constraint card_settlements_sum check (round(received_aed + fee_aed, 2) = round(gross_aed, 2))
);

alter table public.card_settlements enable row level security;
grant all on public.card_settlements to service_role;

create trigger card_settlements_audit after insert or update on public.card_settlements for each row execute function write_audit_log();
create trigger card_settlements_nodel before delete on public.card_settlements for each row execute function prevent_delete();
create trigger card_settlements_stamp before insert or update on public.card_settlements for each row execute function set_audit_columns();
create trigger card_settlements_zoho_protect before update on public.card_settlements for each row execute function public.erp_protect_zoho_ids('zoho_transfer_id', 'zoho_fee_id');

-- 2. Each card/link payment remembers its settlement and its share of the ACTUAL fee.
alter table public.payments add column if not exists settlement_id uuid references public.card_settlements(id);
alter table public.payments add column if not exists actual_fee_aed numeric(12,2);
create index if not exists payments_unsettled_idx on public.payments (method, received_at) where settlement_id is null and status = 'recorded';

-- 3. The Zoho queue learns the settlement.
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery', 'vendorcredit', 'cnrefund', 'settlement'));

notify pgrst, 'reload schema';
