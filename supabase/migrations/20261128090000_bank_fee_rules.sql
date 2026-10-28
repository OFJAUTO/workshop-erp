-- 29 October 2026, section 1: the bank's fee per payment method, as Network International charges it.
-- Card machine: MSF 2.15% before VAT, no fee per transaction. Payment link: MSF 1.75% + AED 1.00 per transaction.
-- VAT 5% on the fees is reclaimable input VAT, so a job's cost is MSF + fee only (src/lib/bank-fees.ts).
-- Each payment keeps the estimate in parts (MSF, fee, VAT); a settlement later writes the actual parts beside them.

alter table public.payments
  add column if not exists fee_msf_aed numeric(12,2),
  add column if not exists fee_txn_aed numeric(12,2),
  add column if not exists fee_vat_aed numeric(12,2),
  add column if not exists actual_msf_aed numeric(12,2),
  add column if not exists actual_txn_fee_aed numeric(12,2),
  add column if not exists actual_vat_aed numeric(12,2);

comment on column public.payments.bank_charge_aed is 'Estimated bank fee counted as the job''s cost: MSF + fee per transaction, before VAT.';
comment on column public.payments.actual_fee_aed is 'Actual bank fee from the settlement, counted as the job''s cost: MSF + fee per transaction, before VAT.';

insert into public.settings (key, value, label, description) values
  ('bank_fee_card_txn_aed', '0', 'Card machine: fee per transaction (AED)', 'Before VAT. Network International charges none on the card machine.'),
  ('bank_fee_link_txn_aed', '1', 'Payment link: fee per transaction (AED)', 'Before VAT.'),
  ('bank_fee_vat_percent', '5', 'VAT on bank fees (%)', 'Input VAT on the MSF and the transaction fee: reclaimable, never a cost to a job.'),
  ('bank_terminal_ids_card', '""', 'Card machine terminal IDs', 'Recognise the card machine on an imported bank report.'),
  ('bank_terminal_ids_link', '""', 'Payment link terminal IDs', 'Recognise the payment link on an imported bank report.')
on conflict (key) do nothing;

-- The old card rate 2.26% was 2.15% with the VAT on it.
update public.settings set value = '2.15'::jsonb, description = 'MSF before VAT (the earlier 2.26% included the VAT).'
  where key = 'bank_charge_card_percent' and value::text in ('2.26', '"2.26"');
update public.settings set value = '2.15'::jsonb
  where key = 'bank_charge_fee_percent' and value::text in ('2.26', '"2.26"');

notify pgrst, 'reload schema';
