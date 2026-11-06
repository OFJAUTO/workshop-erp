-- Audit L4 (6 November 2026, Supabase advisor hardening): every function in public gets a fixed search_path, so no
-- one can make a function pick up a look-alike table or function from another schema. "extensions" stays reachable
-- for the Supabase extensions some functions call unqualified. Functions that already pin one are left alone.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', f.sig);
  end loop;
end $$;
