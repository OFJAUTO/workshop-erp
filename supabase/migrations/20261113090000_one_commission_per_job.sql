-- Evening batch of 21 October 2026, section 1: ONE commission per job.
-- A revised quotation CARRIES the commission to the new version (code: createNextVersion / startQuotation);
-- the old version keeps a tombstone (commission_status = 'superseded', fields nulled). This migration
-- widens the status check, cleans the duplicates the copying already made (J-00859 showed the same
-- AED 1,500 four times), removes the test commission "Wdwdwd", and backfills who added each one.
-- No new tables: no RLS or grant changes needed here.

-- 1. 'superseded' joins the allowed statuses.
alter table public.quotations drop constraint if exists quotations_commission_status_check;
alter table public.quotations add constraint quotations_commission_status_check
  check (commission_status is null or commission_status in ('pending', 'approved', 'declined', 'superseded'));

-- 2. Who added it: fill the missing commission_set_by from the earliest version of the same number
--    that knows it (version copies lost it), else the quotation's creator. No more "added by ?".
update public.quotations q
set commission_set_by = coalesce(
      (select q2.commission_set_by from public.quotations q2
        where q2.number = q.number and q2.kind = q.kind and q2.commission_set_by is not null
        order by q2.version asc limit 1),
      q.created_by),
    commission_set_at = coalesce(q.commission_set_at,
      (select q2.commission_set_at from public.quotations q2
        where q2.number = q.number and q2.kind = q.kind and q2.commission_set_at is not null
        order by q2.version asc limit 1),
      q.created_at)
where q.is_active and q.commission_to is not null and q.commission_set_by is null;

-- 3. One per job: keep the PAID row first, else the newest version; the rest become tombstones,
--    each logged on the quotation's history. A paid row is never superseded by this clean-up.
do $$
declare
  r record;
begin
  for r in
    with ranked as (
      select q.id, q.job_id, q.number, q.version, q.commission_to, q.commission_aed,
             (q.commission_paid_at is not null) as paid,
             row_number() over (
               partition by q.job_id
               order by (q.commission_paid_at is not null) desc, q.version desc, q.created_at desc
             ) as rn,
             first_value(q.version) over (
               partition by q.job_id
               order by (q.commission_paid_at is not null) desc, q.version desc, q.created_at desc
             ) as kept_version
      from public.quotations q
      where q.is_active and q.kind = 'quotation' and q.job_id is not null
        and q.commission_to is not null and coalesce(q.commission_aed, 0) > 0
        and coalesce(q.commission_status, 'approved') <> 'declined'
    )
    select * from ranked where rn > 1 and not paid
  loop
    update public.quotations
      set commission_to = null, commission_kind = null, commission_value = null, commission_aed = 0,
          commission_status = 'superseded',
          commission_decided_by = null, commission_decided_at = null, commission_decision_note = null
      where id = r.id;
    insert into public.quotation_events (quotation_id, event_type, note)
      values (r.id, 'commission_superseded',
              format('%s v%s: duplicate commission for %s (AED %s) removed - one commission per job; version %s keeps it (21 October clean-up)',
                     r.number, r.version, r.commission_to, r.commission_aed, r.kept_version));
  end loop;
end $$;

-- 4. The test commission "Wdwdwd" goes entirely (Q-00027), and leaves the one-tap people list.
do $$
declare
  r record;
begin
  for r in select id, number, version, commission_aed from public.quotations
    where is_active and commission_to = 'Wdwdwd'
  loop
    update public.quotations
      set commission_to = null, commission_kind = null, commission_value = null, commission_aed = 0,
          commission_status = null, commission_set_by = null, commission_set_at = null,
          commission_decided_by = null, commission_decided_at = null, commission_decision_note = null
      where id = r.id;
    insert into public.quotation_events (quotation_id, event_type, note)
      values (r.id, 'commission_removed', format('%s v%s: test commission "Wdwdwd" (AED %s) removed in the 21 October clean-up', r.number, r.version, r.commission_aed));
  end loop;
end $$;
update public.settings
  set value = coalesce((select jsonb_agg(x) from jsonb_array_elements_text(value) x where x <> 'Wdwdwd'), '[]'::jsonb)
  where key = 'commission_people';
