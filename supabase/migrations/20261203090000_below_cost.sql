-- Nothing below cost (2 November 2026, section 1: Q-00039 on J-00969).
--
-- 1. The owner's approval of ONE quotation line selling below its cost, with the figures he saw: his reason, who, when,
--    the selling price and the cost at that moment. A lower price or a higher cost later is no longer covered
--    (belowCostOf in src/lib/quotes.ts). On approved quotations these columns are frozen like every other line column
--    (erp_lock_quotation_lines compares the whole row). quotation_lines keeps its RLS, policies and table grants; these
--    are plain columns on it (no column grant needed: only gate_ins, jobs, gate_outs, job_items and appointments
--    hide columns from the login role).
-- 2. The parts behind a revision request from Parts (quotations.revision_request_parts): when they are all taken off
--    since, the request is withdrawn by itself (withdrawStaleRevisions in src/lib/quote-versions.ts).
-- 3. Q-00039 v1 (J-00969): Peter's request "Peter added FRONT RH HEAD LIGHT, AED 5,502.73" (31 October) is still
--    waiting for the owner, but the part was taken off as a duplicate on 2 November. The AED figure was the part's
--    COST (list 12,228.30 less the supplier's 55% standard discount), never a selling price, and no markup was ever
--    subtracted. Withdrawn here, with the owner's unread bell marked read. Guarded: only while the request still waits
--    and the part is gone; elsewhere (TEST) the rows do not exist and nothing happens.
-- 4. Early charges pushed into a quotation as an Other line with a cost were priced at the cost alone (THE price rule
--    reads cost + markup and the markup was empty). The ones still on a quotation being prepared get the markup that
--    lands exactly on the typed charge. Guarded to untouched lines (no markup typed) on draft or waiting quotations.

alter table public.quotation_lines add column if not exists below_cost_reason text;
alter table public.quotation_lines add column if not exists below_cost_by uuid references public.staff (id);
alter table public.quotation_lines add column if not exists below_cost_at timestamptz;
alter table public.quotation_lines add column if not exists below_cost_sell_aed numeric(12,2);
alter table public.quotation_lines add column if not exists below_cost_cost_aed numeric(12,2);
comment on column public.quotation_lines.below_cost_reason is 'The owner''s reason for selling this line below its cost (2 November 2026).';
comment on column public.quotation_lines.below_cost_sell_aed is 'The selling price the owner approved below cost; a lower price later is not covered.';
comment on column public.quotation_lines.below_cost_cost_aed is 'The cost when the owner approved; a higher cost later is not covered.';

alter table public.quotations add column if not exists revision_request_parts uuid[];
comment on column public.quotations.revision_request_parts is 'The parts behind a revision request from Parts; when all are taken off the request is withdrawn by itself.';

do $$
declare
  v_q uuid := '32aa6ca9-7035-4e5b-961e-80d7f938cb0a';
  v_part uuid := '7c2b4e68-fc15-4b1d-ae32-57af0fb651ad';
  v_job uuid;
  v_note text := 'Withdrawn: FRONT RH HEAD LIGHT was taken off by Parts as a duplicate on 2 November 2026, so nothing is left to revise. The AED 5,502.73 in the request was the part''s COST (list 12,228.30 less the supplier''s 55% standard discount), not a selling price; no markup was subtracted.';
  n int;
begin
  update public.quotations q
     set revision_declined_at = now(), revision_declined_by = null, revision_decision_note = v_note, revision_request_parts = array[v_part]
   where q.id = v_q
     and q.status = 'approved'
     and q.revision_requested_at is not null
     and q.revision_allowed_at is null
     and q.revision_declined_at is null
     and q.revision_request_kind = 'parts'
     and q.revision_request_reason like 'Peter added FRONT RH HEAD LIGHT%'
     and exists (select 1 from public.part_items p where p.id = v_part and (p.is_active = false or p.removed_at is not null or p.not_needed_at is not null))
  returning q.job_id into v_job;
  get diagnostics n = row_count;
  raise notice 'Q-00039 revision request withdrawn: %', n;
  if n > 0 then
    insert into public.quotation_events (quotation_id, job_id, event_type, note, created_by) values (v_q, v_job, 'revision_withdrawn', 'Q-00039: the revision request is withdrawn. ' || v_note, null);
    insert into public.job_events (job_id, event_type, note, created_by) values (v_job, 'revision_withdrawn', 'Q-00039: the revision request is withdrawn. ' || v_note, null);
    update public.notifications set read_at = now()
     where type = 'revision_request' and read_at is null and href like '%/quote/32aa6ca9-7035-4e5b-961e-80d7f938cb0a%';
    get diagnostics n = row_count;
    raise notice 'Q-00039 owner bells marked read: %', n;
  end if;
end $$;

-- 3b. An owner's bell for a revision request that was answered since (Q-00020's, closed by this morning's update) is
--     marked read: only bells older than the answer, so a newer request's bell stays.
do $$
declare
  n int;
begin
  update public.notifications nt set read_at = now()
   where nt.type = 'revision_request' and nt.read_at is null
     and exists (select 1 from public.quotations q
                  where nt.href like '%/quote/' || q.id::text || '%'
                    and coalesce(q.revision_declined_at, q.revision_allowed_at) is not null
                    and coalesce(q.revision_declined_at, q.revision_allowed_at) > nt.created_at);
  get diagnostics n = row_count;
  raise notice 'answered revision bells marked read: %', n;
end $$;

do $$
declare
  n int;
begin
  update public.quotation_lines l
     set markup_mode = 'percent',
         markup_percent = round(((l.unit_price / l.unit_cost) - 1) * 100, 6),
         line_total = round(round(l.unit_cost * (1 + round(((l.unit_price / l.unit_cost) - 1) * 100, 6) / 100) * coalesce(nullif(l.quantity, 0), 1), 2) * (1 - coalesce(l.discount_percent, 0) / 100), 2)
   where l.is_active
     and l.line_type = 'other'
     and l.unit_cost > 0
     and l.unit_price is not null
     and l.markup_percent is null
     and l.markup_aed is null
     and coalesce(l.price_display, 'normal') = 'normal'
     and exists (select 1 from public.charge_lines c where c.quotation_line_id = l.id)
     and exists (select 1 from public.quotations q where q.id = l.quotation_id and q.status in ('draft', 'pending_owner'));
  get diagnostics n = row_count;
  raise notice 'early-charge Other lines priced at their charge (were at cost): %', n;
end $$;
