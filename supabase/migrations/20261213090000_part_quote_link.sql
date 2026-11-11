-- 11 November 2026, Section 2 (URGENT, Q-00078 on J-00317): every parts request and every part belongs to ONE quotation
-- (its number: versions keep the number). Requested from a quotation = that one; anything else (inspection findings,
-- parts the desk adds) = the quotation being prepared now (the oldest number whose newest version is a draft or waits
-- for the owner, the same rule as quoteTargetFor), filled in by the trigger below so every existing path keeps working.
-- A part inherits its request's quotation. Empty = not on a quotation yet (the advisor adds it with "Add here").

alter table public.part_requests add column if not exists for_quote text;
alter table public.part_items add column if not exists for_quote text;

create or replace function public.erp_part_for_quote() returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.for_quote is null then
    -- (nested: PL/pgSQL does not short-circuit, and a request row has no part_request_id field)
    if tg_table_name = 'part_items' then
      if (to_jsonb(new) ->> 'part_request_id') is not null then
        select r.for_quote into new.for_quote from public.part_requests r where r.id = (to_jsonb(new) ->> 'part_request_id')::uuid;
      end if;
    end if;
    if new.for_quote is null and new.job_id is not null then
      select q.number into new.for_quote
        from public.quotations q
       where q.job_id = new.job_id
         and q.kind = 'quotation'
         and q.is_active
         and q.status in ('draft', 'pending_owner')
         and q.version = (select max(q2.version) from public.quotations q2 where q2.number = q.number and q2.is_active)
       order by (select min(q3.created_at) from public.quotations q3 where q3.number = q.number)
       limit 1;
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.erp_part_for_quote() from public, anon;
grant execute on function public.erp_part_for_quote() to authenticated, service_role;

drop trigger if exists part_requests_for_quote on public.part_requests;
create trigger part_requests_for_quote before insert on public.part_requests for each row execute function public.erp_part_for_quote();
drop trigger if exists part_items_for_quote on public.part_items;
create trigger part_items_for_quote before insert on public.part_items for each row execute function public.erp_part_for_quote();

-- Existing parts: the quotation whose live line carries the part (newest first); nothing is guessed beyond that.
update public.part_items p
   set for_quote = sub.number
  from (
    select distinct on (l.part_item_id) l.part_item_id, q.number
      from public.quotation_lines l
      join public.quotations q on q.id = l.quotation_id
     where l.is_active and l.part_item_id is not null and q.kind = 'quotation'
     order by l.part_item_id, q.created_at desc
  ) sub
 where p.id = sub.part_item_id and p.for_quote is null;

update public.part_requests r
   set for_quote = p.for_quote
  from public.part_items p
 where p.part_request_id = r.id and p.for_quote is not null and r.for_quote is null;

notify pgrst, 'reload schema';
