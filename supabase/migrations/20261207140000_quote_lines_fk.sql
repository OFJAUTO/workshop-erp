-- Audit L1 (6 November 2026): live holds one quotation line whose quotation does not exist (MAIN BATTERY AGM 95AH,
-- AED 210, 22 Oct 21:42, unreachable by any screen). The foreign key to quotations exists and is validated on live,
-- so the line can only have come in while keys and triggers were switched off (a restore or a test-data clear).
-- This removes any such orphan, with triggers off for this one statement (the lock trigger reads the missing parent).
do $$
declare n int;
begin
  set local session_replication_role = replica;
  delete from public.quotation_lines l where not exists (select 1 from public.quotations q where q.id = l.quotation_id);
  get diagnostics n = row_count;
  raise notice 'orphaned quotation lines removed: %', n;
  set local session_replication_role = origin;
end $$;
