-- 21 October 2026, part 2 section 2.4: the ORDER NOW clock. An approved LPO that nobody ordered
-- rings the owner once past the red line (Settings); the stamp keeps it to one bell.
alter table public.purchase_orders add column if not exists order_overdue_notified_at timestamptz;
