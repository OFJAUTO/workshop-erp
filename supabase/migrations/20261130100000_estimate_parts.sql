-- Estimate parts priced by the parts desk (30 October 2026).
--
-- An estimate has no job yet, so its parts cannot be part requests. The part LINE of the estimate carries the price
-- itself: the advisor names it and sends it to the parts desk (price_requested_*), the parts desk fills cost (the
-- line's unit_cost), supplier, part number, type and availability (priced_*), or the advisor types a price he already
-- has (priced_by_advisor) and the parts desk checks it (price_checked_*). At gate-in the priced lines become real
-- part requests and part items on the job, with their cost, supplier and markup (no re-pricing).
-- The line's existing part_type and brand columns hold the type. quotation_lines keeps its grants and policies.

alter table public.quotation_lines add column if not exists parts_note text;
alter table public.quotation_lines add column if not exists price_requested_at timestamptz;
alter table public.quotation_lines add column if not exists price_requested_by uuid;
alter table public.quotation_lines add column if not exists priced_at timestamptz;
alter table public.quotation_lines add column if not exists priced_by uuid;
alter table public.quotation_lines add column if not exists priced_by_advisor boolean not null default false;
alter table public.quotation_lines add column if not exists price_checked_at timestamptz;
alter table public.quotation_lines add column if not exists price_checked_by uuid;
alter table public.quotation_lines add column if not exists supplier_text text;
alter table public.quotation_lines add column if not exists part_number text;
alter table public.quotation_lines add column if not exists availability text;
alter table public.quotation_lines add column if not exists delivery_days integer;

do $$ begin
  alter table public.quotation_lines add constraint quotation_lines_availability_check check (availability is null or availability in ('in_stock', 'to_order'));
exception when duplicate_object then null; end $$;

-- The parts desk asked to price, waiting: found quickly for the Parts desk list.
create index if not exists quotation_lines_price_requested_idx on public.quotation_lines (price_requested_at) where price_requested_at is not null and unit_cost is null;

-- The approved-quotation lock: the parts desk may still CHECK an advisor's price on an estimate the customer already
-- accepted (the stamp only; the figures stay frozen).
create or replace function public.erp_lock_quotation_lines()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    if public.erp_quote_locked_status(old.quotation_id) then
      raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; its lines cannot be deleted. Make a new version.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if public.erp_quote_locked_status(new.quotation_id) then
      raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; lines cannot be added. Make a new version.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if public.erp_quote_locked_status(old.quotation_id) or public.erp_quote_locked_status(new.quotation_id) then
    v_old := to_jsonb(old) - 'updated_at' - 'updated_by' - 'line_total' - 'customer_approved' - 'price_checked_at' - 'price_checked_by';
    v_new := to_jsonb(new) - 'updated_at' - 'updated_by' - 'line_total' - 'customer_approved' - 'price_checked_at' - 'price_checked_by';
    if v_old is distinct from v_new then
      raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; its lines cannot be changed. Make a new version.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

comment on column public.quotation_lines.priced_by_advisor is 'Estimate part priced by the advisor (a price he already had): internal only, the parts desk checks it (30 Oct 2026).';

notify pgrst, 'reload schema';
