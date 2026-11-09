-- Lost phone (9 November 2026, Section 4): only the owner can give someone a one-time sign-in code (15 minutes, single
-- use, logged) to set up a new passkey. The code is kept only as its hash, as a passkey challenge of purpose 'reset'.
alter table public.passkey_challenges drop constraint if exists passkey_challenges_purpose_check;
alter table public.passkey_challenges add constraint passkey_challenges_purpose_check check (purpose in ('login', 'register', 'confirm', 'reset'));
notify pgrst, 'reload schema';
