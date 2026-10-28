-- 29 October 2026, section 3: every card-machine and payment-link payment carries the bank's 6-character auth code
-- (from the card slip or the payment confirmation): the key that matches it to the bank's settlement report.
alter table public.payments add column if not exists auth_code text;
alter table public.payments drop constraint if exists payments_auth_code_check;
alter table public.payments add constraint payments_auth_code_check check (auth_code is null or auth_code ~ '^[A-Z0-9]{6}$');
create index if not exists payments_auth_code_idx on public.payments (auth_code) where auth_code is not null;
comment on column public.payments.auth_code is 'The bank''s auth code of a card-machine or payment-link payment (6 letters or digits).';

-- The code accounts already typed into the reference box (RCT-00036: 756117).
update public.payments set auth_code = upper(reference)
  where auth_code is null and method in ('card', 'link') and reference ~ '^[A-Za-z0-9]{6}$';

notify pgrst, 'reload schema';
