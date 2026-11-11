-- 11 November 2026, Section 5 (AL ALI cheque 019383, RCT-00062): accounts ask the owner to void a duplicate receipt
-- ("Void - duplicate / entered by mistake", a reason); the owner decides on his Approvals. Nothing is deleted: the
-- receipt is voided with who, when and why, as every void. And a cheque's full amount is kept on each receipt taken
-- from it, so the receipts on one cheque number can never total more than the cheque.

alter table public.payments add column if not exists void_requested_at timestamptz;
alter table public.payments add column if not exists void_requested_by uuid references public.staff(id);
alter table public.payments add column if not exists void_request_reason text;
alter table public.payments add column if not exists cheque_total_aed numeric(12, 2);

create index if not exists payments_cheque_number_idx on public.payments (cheque_number) where cheque_number is not null;
create index if not exists payments_void_requested_idx on public.payments (void_requested_at) where void_requested_at is not null;

notify pgrst, 'reload schema';
