-- 29 October 2026, section 4: a settlement saved ANYWAY keeps its unexplained difference, so the sum rule becomes
-- ticked = received + what the bank kept + the recorded difference (0 when the figures add up), and the parts add up
-- to what the bank kept whenever they are known.
alter table public.card_settlements drop constraint if exists card_settlements_sum;
alter table public.card_settlements add constraint card_settlements_sum check (round(received_aed + fee_aed + difference_aed, 2) = round(gross_aed, 2));
alter table public.card_settlements drop constraint if exists card_settlements_parts;
alter table public.card_settlements add constraint card_settlements_parts check (msf_aed is null or round(coalesce(msf_aed, 0) + coalesce(txn_fee_aed, 0) + coalesce(vat_aed, 0), 2) = round(fee_aed, 2));
