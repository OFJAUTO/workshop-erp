-- 29 October 2026, section 4: a settlement as the bank reports it - net received, MSF, transaction fee and the VAT on
-- the fees - and each payment's actual share in the same parts. Ticked = net + MSF + fee + VAT; a settlement saved
-- with a difference keeps it and the reason. (fee_aed stays what the bank kept in all: MSF + fee + VAT.)
alter table public.card_settlements
  add column if not exists msf_aed numeric(12,2),
  add column if not exists txn_fee_aed numeric(12,2),
  add column if not exists vat_aed numeric(12,2),
  add column if not exists difference_aed numeric(12,2) not null default 0,
  add column if not exists difference_note text,
  add column if not exists source text not null default 'manual',
  add column if not exists report_id uuid;

alter table public.card_settlements drop constraint if exists card_settlements_source_check;
alter table public.card_settlements add constraint card_settlements_source_check check (source in ('manual', 'report'));

comment on column public.card_settlements.fee_aed is 'What the bank kept: MSF + transaction fee + VAT on the fees.';
comment on column public.card_settlements.difference_aed is 'Ticked total − (net + MSF + fee + VAT), saved on purpose with the reason in difference_note (0 when the figures add up).';

-- Settlements recorded before this change kept one fee with its VAT inside: split it so profit counts MSF + fee only.
update public.card_settlements set vat_aed = round(fee_aed * 5 / 105, 2), msf_aed = fee_aed - round(fee_aed * 5 / 105, 2), txn_fee_aed = 0
  where msf_aed is null and is_active;
update public.payments p set actual_vat_aed = round(p.actual_fee_aed * 5 / 105, 2), actual_msf_aed = p.actual_fee_aed - round(p.actual_fee_aed * 5 / 105, 2), actual_txn_fee_aed = 0, actual_fee_aed = p.actual_fee_aed - round(p.actual_fee_aed * 5 / 105, 2)
  where p.settlement_id is not null and p.actual_fee_aed is not null and p.actual_vat_aed is null;

notify pgrst, 'reload schema';
