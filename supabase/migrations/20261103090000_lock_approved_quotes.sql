-- 16 October 2026, evening: an approved quotation is locked in the database itself, not only on the screens.
-- Once the customer has approved (status approved) or the version was replaced by a newer one (superseded), its lines
-- cannot be added, changed or deleted and the header's money choices cannot change, whoever asks and from wherever.
-- The only way to change the work is a new version. The bookkeeping columns stay free: the stored line total
-- (recomputed, never different when nothing changed), the customer's approval mark, updated_at/by, and the header's
-- status, derived totals, flags and notes written by the system (deposit reminders, revision requests, editing lock).

create or replace function public.erp_quote_locked_status(p_quotation uuid)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.quotations q where q.id = p_quotation and q.status in ('approved', 'superseded'));
$$;

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
    v_old := to_jsonb(old) - 'updated_at' - 'updated_by' - 'line_total' - 'customer_approved';
    v_new := to_jsonb(new) - 'updated_at' - 'updated_by' - 'line_total' - 'customer_approved';
    if v_old is distinct from v_new then
      raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; its lines cannot be changed. Make a new version.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_lines_lock on public.quotation_lines;
create trigger quotation_lines_lock
  before insert or update or delete on public.quotation_lines
  for each row execute function public.erp_lock_quotation_lines();

create or replace function public.erp_lock_quotation_header()
returns trigger
language plpgsql
as $$
declare
  v_cols text[] := array['discount_percent', 'discount_kind', 'discount_value', 'discount_scope', 'deposit_mode', 'deposit_value',
                         'rounded_total_aed', 'vat_percent', 'validity_days', 'customer_note', 'payment_by_card',
                         'expected_payment_method', 'materials_cost_aed', 'kind', 'number', 'version', 'job_id', 'customer_id', 'vehicle_id'];
  c text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if old.status in ('approved', 'superseded') then
    foreach c in array v_cols loop
      if (v_old -> c) is distinct from (v_new -> c) then
        raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; % cannot be changed. Make a new version.', replace(c, '_', ' ') using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists quotations_lock on public.quotations;
create trigger quotations_lock
  before update on public.quotations
  for each row execute function public.erp_lock_quotation_header();
