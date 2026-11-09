-- Outsourced lathe work (9 November 2026, Section 8). Disc/drum/flywheel machining goes to a lathe shop that bills once
-- a month. Each job of it is a part on the car's parts list with a ticket number (SUB-00001…) printed on its sticker:
-- Sent → Back → Billed. Its cost comes from the price list at once (so the job's profit is right); the month-end bill
-- replaces the estimate with the actual cost per car (customer invoices never change). One bill → one Zoho bill with a
-- line per job, paid as one supplier payment.

alter table public.part_items
  add column if not exists lathe_ticket text unique,
  add column if not exists lathe_item text,
  add column if not exists lathe_sent_at timestamptz,
  add column if not exists lathe_sent_by uuid references public.staff(id),
  add column if not exists lathe_taken_by text,
  add column if not exists lathe_back_at timestamptz,
  add column if not exists lathe_back_by uuid references public.staff(id),
  add column if not exists lathe_bill_id uuid,
  add column if not exists lathe_bill_amount_aed numeric(12, 2);

create table if not exists public.lathe_bills (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  supplier_name text not null,
  bill_number text not null,
  bill_date date not null,
  before_vat_aed numeric(12, 2) not null,
  vat_aed numeric(12, 2) not null default 0,
  total_aed numeric(12, 2) not null,
  extra_lines jsonb not null default '[]'::jsonb,
  paid_at timestamptz,
  paid_method text,
  paid_reference text,
  paid_by uuid references public.staff(id),
  zoho_bill_id text,
  zoho_payment_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  unique (supplier_name, bill_number)
);
alter table public.part_items drop constraint if exists part_items_lathe_bill_fk;
alter table public.part_items add constraint part_items_lathe_bill_fk foreign key (lathe_bill_id) references public.lathe_bills(id);

-- Server-only (the screens go through the server): RLS on, no policies, no grants to logins.
alter table public.lathe_bills enable row level security;
revoke all on public.lathe_bills from anon, authenticated;
grant all on public.lathe_bills to service_role;
drop trigger if exists lathe_bills_audit on public.lathe_bills;
create trigger lathe_bills_audit after insert or update on public.lathe_bills for each row execute function public.write_audit_log();
drop trigger if exists lathe_bills_no_delete on public.lathe_bills;
create trigger lathe_bills_no_delete before delete on public.lathe_bills for each row execute function public.prevent_delete();

-- The price list (item, price; the highest when a range) and the two limits; the owner changes them on the lathe page.
insert into public.settings (key, label, value) values
  ('lathe_price_list', 'Lathe price list (item, price in AED; the highest when a range)', '[]'::jsonb),
  ('lathe_lpo_threshold_aed', 'Lathe work under this cost (AED) skips LPO approval', to_jsonb(200)),
  ('lathe_min_markup_percent', 'Lathe work: minimum markup on the cost (%)', to_jsonb(200))
on conflict (key) do nothing;

-- Zoho: one bill per lathe bill (a line per job), and its payment.
alter table public.zoho_outbox drop constraint if exists zoho_outbox_kind_check;
alter table public.zoho_outbox add constraint zoho_outbox_kind_check
  check (kind in ('contact', 'deposit', 'invoice', 'payment', 'creditnote', 'vendor', 'bill', 'billpayment', 'commission', 'recovery', 'vendorcredit', 'cnrefund', 'settlement', 'supplierpay', 'paygroup', 'lathebill'));

notify pgrst, 'reload schema';
