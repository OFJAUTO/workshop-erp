-- Security lockdown, 21 October 2026 (after the Supabase advisor warnings of 17 October).
-- The audit found: RLS already ON for all 91 public tables and no policy lets anon through,
-- but the browser's public key (anon) still HELD dormant grants on 40 tables (old Supabase
-- defaults), six views ran as their owner (bypassing RLS), and a few server-only token tables
-- were reachable by any logged-in session (RLS denied rows, but the grants were untidy).

-- 1. The six owner views are gone. The pages now read the same narrow columns server-side
--    (src: calendar/form-data, dashboard, vehicles, my-jobs, job-data, workshop, assign, search).
drop view if exists public.customer_public;
drop view if exists public.customer_vip_flags;
drop view if exists public.workshop_board;
drop view if exists public.gate_in_amendments;
drop view if exists public.part_items_technician;
drop view if exists public.quotation_part_lines;

-- 2. The public browser key (anon) can touch NOTHING in the public schema.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- 3. And future tables never get anon grants by default (objects here are created as postgres).
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- 4. Server-only tables (tokens, pay links, PIN-login codes, the sealed mailbox token): no API role
--    at all. Only server code with the service key reads or writes them.
revoke all on table public.short_links from anon, authenticated;
revoke all on table public.payment_requests from anon, authenticated;
revoke all on table public.payment_links from anon, authenticated;
revoke all on table public.setup_links from anon, authenticated;
revoke all on table public.quick_codes from anon, authenticated;
revoke all on table public.google_mailbox_tokens from anon, authenticated;

notify pgrst, 'reload schema';
