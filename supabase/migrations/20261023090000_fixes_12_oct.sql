-- Fixes from the testing of 12 October 2026: supplier discounts and list prices, the LPO supplier copy with its
-- verification link, parts renamed and split by Parts, the expected payment method on a quotation, one person
-- editing a quotation at a time, who sent an invoice, bank transfer as a payment method, advisors working on
-- each other's quotations, and shorter WhatsApp messages.

-- 1. Supplier discounts: a default percentage, optionally different per part type ({"genuine": 10, "oem": 15}).
alter table public.suppliers add column if not exists default_discount_percent numeric not null default 0;
alter table public.suppliers add column if not exists discount_by_type jsonb not null default '{}'::jsonb;

-- Parts enter the list price; the discount gives the net cost (cost_aed stays the cost used everywhere).
alter table public.part_items add column if not exists list_price_aed numeric;
alter table public.part_items add column if not exists discount_percent numeric;
-- Parts can correct the technician's name and quantity; the original stays on the row.
alter table public.part_items add column if not exists original_description text;
alter table public.part_items add column if not exists quantity_changed_at timestamptz;
alter table public.part_items add column if not exists quantity_changed_by uuid references public.staff(id);

alter table public.purchase_order_lines add column if not exists list_price numeric;
alter table public.purchase_order_lines add column if not exists discount_percent numeric;

-- 2. The LPO supplier copy: a public verification link (QR on the PDF) and who sent it.
alter table public.purchase_orders add column if not exists verify_token text;
alter table public.purchase_orders add column if not exists superseded_by uuid references public.purchase_orders(id);
alter table public.purchase_orders add column if not exists sent_at timestamptz;
alter table public.purchase_orders add column if not exists sent_by uuid references public.staff(id);
alter table public.purchase_orders add column if not exists sent_method text;
update public.purchase_orders set verify_token = encode(gen_random_bytes(18), 'hex') where verify_token is null;
create unique index if not exists purchase_orders_verify_token_idx on public.purchase_orders (verify_token);

-- 3. The expected payment method on a quotation (internal) and the editing lock.
alter table public.quotations add column if not exists expected_payment_method text not null default 'not_sure';
alter table public.quotations drop constraint if exists quotations_expected_payment_method_check;
alter table public.quotations add constraint quotations_expected_payment_method_check check (expected_payment_method in ('card', 'link', 'cash', 'cheque', 'transfer', 'not_sure'));
alter table public.quotations add column if not exists editing_by uuid references public.staff(id);
alter table public.quotations add column if not exists editing_at timestamptz;

-- 4. Who sent an invoice link.
alter table public.invoices add column if not exists sent_by uuid references public.staff(id);
alter table public.invoices add column if not exists sent_at timestamptz;

-- 5. Bank transfer as a payment method (no bank charge).
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('cash', 'card', 'link', 'cheque', 'transfer'));
insert into public.settings (key, value, label, description)
values ('bank_charge_transfer_percent', '0'::jsonb, 'Bank charge on bank transfers (%)', 'Kept by the bank on a bank transfer, in percent. Usually 0.')
on conflict (key) do nothing;

-- 6. Any advisor may see and work on any quotation; the car keeps its own advisor.
create or replace function public.can_see_quotation(p_quotation uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_staff_role()
    when 'owner' then true
    when 'service_advisor' then true
    else false end;
$$;

-- 7. WhatsApp messages: one or two short lines and the link. No bank details, no names.
update public.settings set value = to_jsonb('[make model] ([plate]) is ready. Your proforma and the amount due are here:
[link]
Once payment is received, your car is ready to collect.'::text) where key = 'whatsapp_ready_template';
update public.settings set value = to_jsonb('Thank you for your payment. The tax invoice for [make model] ([plate]) is here:
[link]'::text) where key = 'whatsapp_invoice_template';
update public.settings set value = to_jsonb('Your quotation for [make model] ([plate]) is ready:
[link]'::text) where key = 'whatsapp_quote_template';
update public.settings set value = to_jsonb('Our estimate for [make model] ([plate]) is here:
[link]
The final price is confirmed once the car is with us.'::text) where key = 'whatsapp_estimate_template';
update public.settings set value = to_jsonb('The inspection of [make model] ([plate]) is complete. The report is here:
[link]'::text) where key = 'whatsapp_report_template';
update public.settings set value = to_jsonb('[make model] ([plate]) has been received at OFJ Automotive. Please review the check-in and approve the inspection:
[link]'::text) where key = 'whatsapp_approval_template';

-- 8. Duplicate part names in the data: "Lower arm" and "Upper arm" are the control arms.
update public.part_requests set label = regexp_replace(label, '^lower arm', 'Lower control arm', 'i') where label ~* '^lower arm($|[^a-z])' and label !~* 'control';
update public.part_requests set label = regexp_replace(label, '^upper arm', 'Upper control arm', 'i') where label ~* '^upper arm($|[^a-z])' and label !~* 'control';
update public.part_items set description = regexp_replace(description, '^lower arm', 'Lower control arm', 'i') where description ~* '^lower arm($|[^a-z])' and description !~* 'control';
update public.part_items set description = regexp_replace(description, '^upper arm', 'Upper control arm', 'i') where description ~* '^upper arm($|[^a-z])' and description !~* 'control';
update public.quotation_lines set title = regexp_replace(title, '^lower arm', 'Lower control arm', 'i') where line_type = 'part' and title ~* '^lower arm($|[^a-z])' and title !~* 'control';
update public.quotation_lines set title = regexp_replace(title, '^upper arm', 'Upper control arm', 'i') where line_type = 'part' and title ~* '^upper arm($|[^a-z])' and title !~* 'control';
update public.inspections set parts_list = (
  select coalesce(jsonb_agg(case
    when (e->>'name') ~* '^lower arm($|[^a-z])' and (e->>'name') !~* 'control' then jsonb_set(e, '{name}', to_jsonb(regexp_replace(e->>'name', '^lower arm', 'Lower control arm', 'i')))
    when (e->>'name') ~* '^upper arm($|[^a-z])' and (e->>'name') !~* 'control' then jsonb_set(e, '{name}', to_jsonb(regexp_replace(e->>'name', '^upper arm', 'Upper control arm', 'i')))
    else e end), '[]'::jsonb)
  from jsonb_array_elements(parts_list) e)
where jsonb_typeof(parts_list) = 'array' and parts_list::text ~* '"name": ?"(lower|upper) arm';
update public.part_catalogue set is_active = false where (name ~* '^lower arm$' or name ~* '^upper arm$') and is_active;
