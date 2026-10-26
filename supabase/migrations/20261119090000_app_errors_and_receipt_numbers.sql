-- 26 October 2026: recording a deposit or a payment.
--
-- 1. app_errors: the technical side of a failed save, for us. Staff see a plain sentence ("Couldn't save – nothing was
--    recorded. Try again or tell the owner."); the database's own words land here. Server-only: RLS on, NO policies,
--    no anon or authenticated grants, only service_role. No audit trigger (it is itself a log).
create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  place text not null,
  message text not null,
  detail jsonb,
  staff_id uuid,
  job_id uuid
);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
grant all on public.app_errors to service_role;
create index if not exists app_errors_at_idx on public.app_errors (at desc);

-- 2. Receipt numbers are taken only by a save that succeeds: the number is the next after the highest receipt on
--    record, worked out inside the insert under a transaction lock, so a failed insert (or two taps at once) never
--    uses one up and the numbering has no gaps. Clear test data empties payments, so it restarts at RCT-00001 by
--    itself. A number written explicitly (test rows) is kept as it is.
create or replace function public.set_receipt_number() returns trigger
language plpgsql set search_path = public as $$
declare n integer;
begin
  if new.number is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('public.payments.number'));
  select coalesce(max(substring(number from '^RCT-([0-9]+)$')::integer), 0) + 1 into n from public.payments;
  new.number := 'RCT-' || lpad(n::text, 5, '0');
  return new;
end $$;
revoke all on function public.set_receipt_number() from public;
grant execute on function public.set_receipt_number() to authenticated, service_role;

alter table public.payments alter column number drop default;
drop trigger if exists payments_receipt_number on public.payments;
create trigger payments_receipt_number before insert on public.payments for each row execute function public.set_receipt_number();

notify pgrst, 'reload schema';
