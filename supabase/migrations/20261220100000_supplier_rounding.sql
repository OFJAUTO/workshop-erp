-- ROUNDING ON SUPPLIER PAYMENTS (20 November 2026, Section 3; LPO-00111-2, AL NABOODA, invoice 33192428, AED 243.60
-- paid 243.50 in cash). The invoice is never changed: a payment that differs says what the difference is - ROUNDING
-- (closes the invoice, within a limit), STILL OWED (stays open), or a DISCOUNT FROM THE SUPPLIER (closes it, with a
-- reason). The written-off part is kept on the payment's line; Zoho gets the payment at what was paid and the
-- difference written off to the rounding (or discount) account. The supplier's own rounding line on an invoice is
-- stored with the invoice.

alter table public.supplier_payment_lines
  add column if not exists write_off_aed numeric(14,2) not null default 0,
  add column if not exists write_off_kind text,
  add column if not exists write_off_reason text,
  add column if not exists write_off_at timestamptz,
  add column if not exists write_off_by uuid references public.staff (id);
alter table public.supplier_payment_lines drop constraint if exists supplier_payment_lines_write_off_check;
alter table public.supplier_payment_lines add constraint supplier_payment_lines_write_off_check
  check (write_off_aed >= 0 and (write_off_kind is null or write_off_kind in ('rounding', 'discount')));

alter table public.supplier_payments add column if not exists zoho_writeoffs jsonb not null default '{}'::jsonb;

alter table public.purchase_orders add column if not exists supplier_invoice_rounding_aed numeric(14,2);

insert into public.settings (key, label, value) values
  ('supplier_rounding_limit_aed', 'Rounding on a supplier payment: the most that closes an invoice as rounding (AED)', '1'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
