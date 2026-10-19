-- The Recovery page updates itself: its table joins the live feed (RLS decides who receives what).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'recovery_trips') then
    alter publication supabase_realtime add table public.recovery_trips;
  end if;
end $$;
