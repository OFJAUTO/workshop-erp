-- MONEY FROM THE ESTIMATE (4 November 2026, the owner's urgent task; case E-00061).
--
-- A company accepts an estimate and wants to pay BEFORE the car arrives: a PROFORMA INVOICE from the
-- estimate (complete, or partial as % / AED), paid -> the TAX INVOICE is issued automatically (a partial
-- payment gets an "Advance payment against E-xxxxx" tax invoice, VAT inside the amount). The documents and
-- payments follow the car onto the job at gate-in; the final tax invoice deducts everything already
-- invoiced. Bill-to (company, address, TRN, attention person, the customer's PO number) prints on the
-- estimate, the proforma and the tax invoices, and may differ from the car's owner.
--
-- The code reads these columns only once they exist (estimateMoneyReady and friends in
-- src/lib/schema-ready.ts), so this file can wait for the owner's "apply" without breaking live.

-- 1) Invoices tied to an estimate. A plain uuid ON PURPOSE: invoices already has one foreign key to
--    quotations (deposit_for_quotation_id), and a second would make every unhinted invoices->quotations
--    embed ambiguous (the additional-estimates migration of 30 October kept its links plain for the same
--    reason). The id is the estimate VERSION the document was issued from; readers resolve the family by
--    its number.
alter table public.invoices add column if not exists estimate_id uuid;
create index if not exists invoices_estimate_idx on public.invoices (estimate_id) where estimate_id is not null;

-- 2) The bill-to block (company name, address, TRN, attention person, the customer's PO/reference
--    number), snapshotted on the document like customer_snapshot; the estimate keeps the typed values so
--    every later document starts from them.
alter table public.invoices add column if not exists bill_to jsonb;
alter table public.quotations add column if not exists bill_to jsonb;

-- 3) "Valid until" on a proforma issued from an estimate (printed on the document).
alter table public.invoices add column if not exists valid_until date;

-- 4) An advisor's payment link and "Payment received - send to accounts" work on an estimate before any
--    job exists: the request and the report may carry an estimate instead of a job.
alter table public.payment_requests alter column job_id drop not null;
alter table public.payment_requests add column if not exists estimate_id uuid;
create index if not exists payment_requests_estimate_idx on public.payment_requests (estimate_id) where estimate_id is not null;
alter table public.payment_requests drop constraint if exists payment_requests_place;
alter table public.payment_requests add constraint payment_requests_place check (job_id is not null or estimate_id is not null);

alter table public.payment_reports alter column job_id drop not null;
alter table public.payment_reports add column if not exists estimate_id uuid;
create index if not exists payment_reports_estimate_idx on public.payment_reports (estimate_id) where estimate_id is not null and is_active;
alter table public.payment_reports drop constraint if exists payment_reports_place;
alter table public.payment_reports add constraint payment_reports_place check (job_id is not null or estimate_id is not null);

-- 5) The WhatsApp message for sending an estimate's proforma (Settings > Messages; a missing row would
--    silently drop edits - 23 October lesson).
insert into public.settings (key, value, label)
values ('whatsapp_estimate_proforma_template', to_jsonb('Dear [name],

Our proforma invoice for estimate *[estimate]* ([make model], [plate]) is here:
[link]

Amount: AED [amount]. This is not a tax invoice: the tax invoice is issued the moment the payment is received.

Bank details are on the proforma. Thank you,
OFJ Automotive'::text), 'WhatsApp message: estimate proforma invoice')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
