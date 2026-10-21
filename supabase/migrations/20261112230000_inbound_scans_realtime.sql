-- Section 10 (21 October): scan reports appear on screens by themselves.
-- inbound_scans joins the live publication so the inspection screens, the job card and the scans page
-- hear a new report the moment the mailbox check stores it. The access rules already decide per person
-- what the live feed may carry (inbound_scans_read), exactly as they do for the pages.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'inbound_scans') then
    alter publication supabase_realtime add table public.inbound_scans;
  end if;
end $$;
