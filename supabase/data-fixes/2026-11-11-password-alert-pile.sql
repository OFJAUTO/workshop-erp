-- 11 November 2026 (Section 14): the pile of "signed in with the password instead of a phone" bells stops counting.
-- From today these sign-ins arrive as ONE evening summary (information); a new device still alerts at once.
-- Marks the old per-sign-in bells read. Nothing is deleted (the notices stay in the list, read).
-- WAITING FOR APPLY: the owner runs it with the rest of the list.
begin;
update public.notifications
   set read_at = now()
 where type = 'password_backup_sign_in'
   and read_at is null;
commit;
