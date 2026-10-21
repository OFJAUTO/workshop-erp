-- Evening batch of 21 October 2026, section 2: commission payments need PROOF.
-- One payment can settle several commissions of one person (cash with a signed voucher, or a bank
-- transfer with its reference and slip). A payment without its proof shows amber everywhere until
-- the signed voucher or the bank slip is uploaded.

create sequence if not exists public.commission_voucher_seq;

create table public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('CPV-' || lpad(nextval('public.commission_voucher_seq')::text, 5, '0')),
  recipient text not null,
  recipient_phone text,
  method text not null check (method in ('cash', 'transfer')),
  paid_on date not null default (now() at time zone 'Asia/Dubai')::date,
  amount_aed numeric(12,2) not null,
  reference text,
  note text,
  -- The signed voucher photo (cash) or the bank slip (transfer), in the job-files bucket.
  proof_path text,
  proof_uploaded_at timestamptz,
  proof_uploaded_by uuid references public.staff(id),
  paid_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);

-- 1. RLS on; 2. owner and accounts only (they are the only ones who pay or see commissions);
-- 3. explicit grants - the user client reads the page, server actions write.
alter table public.commission_payments enable row level security;
create policy commission_payments_read on public.commission_payments
  for select to authenticated using (has_role('owner', 'accounts'));
create policy commission_payments_write on public.commission_payments
  for insert to authenticated with check (has_role('owner', 'accounts'));
create policy commission_payments_update on public.commission_payments
  for update to authenticated using (has_role('owner', 'accounts')) with check (has_role('owner', 'accounts'));
grant select, insert, update on public.commission_payments to authenticated;
grant all on public.commission_payments to service_role;
grant usage on sequence public.commission_voucher_seq to authenticated, service_role;

create trigger commission_payments_audit after insert or update on public.commission_payments for each row execute function write_audit_log();
create trigger commission_payments_nodel before delete on public.commission_payments for each row execute function prevent_delete();
create trigger commission_payments_stamp before insert or update on public.commission_payments for each row execute function set_audit_columns();

-- The quotation's commission points at the payment that settled it.
alter table public.quotations add column if not exists commission_payment_id uuid references public.commission_payments(id);

-- Backfill: the one commission already paid (J-00859, cash by Mathew) becomes a voucher with its
-- proof still missing, so the signed paper gets uploaded like every future one.
do $$
declare
  r record;
  pid uuid;
begin
  for r in
    select q.id, q.commission_to, q.commission_aed, q.commission_paid_at, q.commission_paid_by, q.commission_paid_method, q.commission_paid_note
    from public.quotations q
    where q.is_active and q.commission_to is not null and q.commission_paid_at is not null and q.commission_payment_id is null
  loop
    insert into public.commission_payments (recipient, method, paid_on, amount_aed, note, paid_by, created_by, updated_by, created_at)
      values (r.commission_to,
              case when r.commission_paid_method in ('cash', 'transfer') then r.commission_paid_method else 'cash' end,
              (r.commission_paid_at at time zone 'Asia/Dubai')::date,
              coalesce(r.commission_aed, 0),
              coalesce(r.commission_paid_note, '') || case when coalesce(r.commission_paid_note, '') = '' then '' else ' · ' end || 'Recorded before vouchers existed (21 October); upload the signed voucher or slip.',
              r.commission_paid_by, r.commission_paid_by, r.commission_paid_by, r.commission_paid_at)
      returning id into pid;
    update public.quotations set commission_payment_id = pid where id = r.id;
  end loop;
end $$;

notify pgrst, 'reload schema';
