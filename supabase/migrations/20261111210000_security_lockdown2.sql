-- Security lockdown, part 2 (21 October 2026): functions and leftover default grants.
-- Functions in public were executable by EVERY role through the built-in PUBLIC grant (not a
-- direct anon grant). Policies and triggers only need authenticated and the server key, so:
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- Future functions the same: no PUBLIC execute, explicit grants instead.
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;

-- The platform role's default grants still name anon; they only apply to objects supabase_admin
-- itself creates, and postgres may not be allowed to change them - try, never fail.
do $$ begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
exception when others then raise notice 'supabase_admin defaults left as they are: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
