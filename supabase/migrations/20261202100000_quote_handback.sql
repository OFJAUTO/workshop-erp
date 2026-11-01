-- Estimate back to the advisor (1 November 2026, E-00055). The advisor who started an estimate or quotation stays in
-- charge; when the owner approves or edits one in someone else's charge it goes back to that advisor with what changed.
--   handback_baseline : how the version stood before the owner's first change (kept only while he edits)
--   handed_back_*     : the handback itself ("Approved by Omar - ready to send" / "Edited by Omar - check and send")
-- No new table, so no new grants: quotations keeps its policies and grants.

alter table public.quotations
  add column if not exists handback_baseline jsonb,
  add column if not exists handed_back_at timestamptz,
  add column if not exists handed_back_by uuid references public.staff(id),
  add column if not exists handback_kind text,
  add column if not exists handback_summary text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotations_handback_kind_check') then
    alter table public.quotations add constraint quotations_handback_kind_check check (handback_kind is null or handback_kind in ('approved', 'edited'));
  end if;
end $$;

create index if not exists quotations_handed_back_idx on public.quotations (handed_back_at) where handed_back_at is not null and status = 'draft';

-- The ones it already happened to: an estimate still being prepared whose newest version the owner made, in the charge
-- of the advisor who started it. It goes back to that advisor now, with the total before and after, and they are told.
with starters as (
  select distinct on (number) number, created_by as lead
  from public.quotations
  order by number, version
), stuck as (
  select q.id, q.number, q.version, q.created_by, q.updated_at, q.total_aed, p.total_aed as before_total, st.lead, o.display_name as owner_name
  from public.quotations q
  join starters st on st.number = q.number
  join public.staff o on o.id = q.created_by and o.role_id = 'owner'
  join public.staff l on l.id = st.lead and l.role_id <> 'owner'
  left join public.quotations p on p.id = q.parent_id
  where q.kind = 'estimate' and q.is_active and q.status = 'draft' and q.version > 1 and q.handed_back_at is null
), done as (
  update public.quotations q
  set handed_back_at = s.updated_at,
      handed_back_by = s.created_by,
      handback_kind = 'edited',
      handback_summary = case
        when s.before_total is not null and s.before_total <> s.total_aed
          then 'Total ' || to_char(s.before_total, 'FM999,999,990.00') || ' → ' || to_char(s.total_aed, 'FM999,999,990.00')
        else 'Total ' || to_char(s.total_aed, 'FM999,999,990.00')
      end
  from stuck s
  where q.id = s.id
  returning q.id, q.number, q.version, q.handback_summary, s.lead, s.owner_name, s.created_by
), logged as (
  insert into public.quotation_events (quotation_id, job_id, event_type, note, created_by)
  select d.id, null, 'quote_handed_back', d.number || ' v' || d.version || ' Edited by ' || d.owner_name || ' – check and send: ' || d.handback_summary, d.created_by
  from done d
  returning 1
)
insert into public.notifications (staff_id, type, title, body, job_id, href)
select d.lead, 'quote_handed_back', 'Edited by ' || d.owner_name || ' – check and send · ESTIMATE ' || d.number, d.handback_summary, null, '/estimates/' || d.id
from done d;

notify pgrst, 'reload schema';
