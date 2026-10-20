-- 21 October 2026, part 1 section 1.2: a RED task older than 30 minutes rings one bell. The stamps,
-- so each one rings once: cash still not confirmed and banked, and a deposit still not recorded
-- after the customer's approval.
alter table public.payments add column if not exists bank_reminder_at timestamptz;
alter table public.quotations add column if not exists deposit_accounts_reminded_at timestamptz;
