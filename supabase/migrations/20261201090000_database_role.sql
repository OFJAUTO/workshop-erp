-- Tests never touch the live database (30 October 2026, batch 2 section 1).
--
-- The database says what it is: 'live' here. The TEST copy (a second Supabase project, filled by
-- scripts/test-db/copy-to-test.mjs) is set to 'test'. The test clean-up (tests/e2e-cleanup.sql) refuses to run unless
-- this says 'test'; the test routes (/api/e2e/*) refuse unless the server is the test server on a non-live project.
-- settings keeps its grants and policies; a new settings row needs its label (the upsert pattern of the settings form).
insert into public.settings (key, value, label, description)
values ('database_role', '"live"', 'Database role', 'live or test: the tests and their clean-up refuse to run unless this says test.')
on conflict (key) do nothing;
