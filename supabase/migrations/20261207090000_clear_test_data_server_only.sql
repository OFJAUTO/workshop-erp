-- C1 of the 4 November audit (CRITICAL): any signed-in staff login could run clear_test_data() over the API and empty
-- the database. Only the server may run it now: the owner's "Clear test data" button calls it with the server's own
-- key (src/lib/clear-test-data.ts, admin client), after its own owner + testing-phase + typed-DELETE checks.
revoke all on function public.clear_test_data() from public, anon, authenticated;
grant execute on function public.clear_test_data() to service_role;
