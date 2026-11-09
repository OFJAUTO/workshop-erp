-- Accounts posting (9 November 2026, Section 2; J-00858's cheque RCT-00058 could not be cleared).
-- Cheques: received -> deposited (date, bank account) -> cleared (the day it is on the statement) or bounced.
-- Bank transfers recorded from 9 November wait the same way (payments.cheque_status = the BANK status of a cheque
-- or a transfer; a transfer with no status, recorded before, counts as it always did - no data changes here).
-- A clearing is recorded as a posting row (card_settlements, STL- numbers) like a card settlement, so Zoho moves the
-- money from Undeposited Funds to the bank on the posting day.

alter table public.payments
  add column if not exists cheque_deposited_at date,
  add column if not exists cheque_deposited_to text,
  add column if not exists cheque_deposited_by uuid references public.staff(id),
  add column if not exists bounce_charge_aed numeric(12, 2);

alter table public.card_settlements drop constraint if exists card_settlements_method_check;
alter table public.card_settlements add constraint card_settlements_method_check check (method in ('card', 'link', 'cheque', 'transfer'));

create index if not exists payments_bank_waiting_idx on public.payments (method, received_at) where cheque_status = 'pending' and status = 'recorded';

notify pgrst, 'reload schema';
