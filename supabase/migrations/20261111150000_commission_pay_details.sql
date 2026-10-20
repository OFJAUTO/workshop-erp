-- 21 October 2026, part 1 section 1.7: paying a commission records how and with what note; the page
-- at /commissions (accounts and the owner) runs Pending -> Approved, to pay -> Paid.
alter table public.quotations
  add column if not exists commission_paid_method text,
  add column if not exists commission_paid_note text;
