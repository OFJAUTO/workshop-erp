-- CAPITALS, saved (1 November 2026, B1; Q-00039 / J-00969). The text staff type for the customer is STORED in
-- capitals, not just shown in capitals: quotation and estimate lines (title and note), the note to the customer,
-- invoice lines made from now on, the job card's work lines and customer requests, the services list and the parts
-- list. Existing text is converted, letter case only (approved quotations too, logged by the audit trigger);
-- issued TAX INVOICES and credit notes stay exactly as issued.

-- 1. One function raises the text; one trigger per table.
create or replace function public.erp_caps_text()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'quotation_lines' then
    new.title := upper(new.title);
    new.details := upper(new.details);
  elsif tg_table_name = 'quotations' then
    new.customer_note := upper(new.customer_note);
  elsif tg_table_name = 'invoice_lines' then
    new.description := upper(new.description);
  elsif tg_table_name = 'work_lines' then
    new.title := upper(new.title);
  elsif tg_table_name = 'job_requests' then
    new.text := upper(new.text);
  elsif tg_table_name in ('services', 'part_catalogue') then
    new.name := upper(new.name);
  end if;
  return new;
end;
$$;

-- Standing rule: no function for anon (trigger functions never check EXECUTE when they fire).
revoke all on function public.erp_caps_text() from public, anon;
grant execute on function public.erp_caps_text() to authenticated, service_role;

drop trigger if exists quotation_lines_caps on public.quotation_lines;
create trigger quotation_lines_caps before insert or update of title, details on public.quotation_lines for each row execute function public.erp_caps_text();
drop trigger if exists quotations_caps on public.quotations;
create trigger quotations_caps before insert or update of customer_note on public.quotations for each row execute function public.erp_caps_text();
-- Invoice lines: new ones only (an issued tax invoice is never changed).
drop trigger if exists invoice_lines_caps on public.invoice_lines;
create trigger invoice_lines_caps before insert on public.invoice_lines for each row execute function public.erp_caps_text();
drop trigger if exists work_lines_caps on public.work_lines;
create trigger work_lines_caps before insert or update of title on public.work_lines for each row execute function public.erp_caps_text();
drop trigger if exists job_requests_caps on public.job_requests;
create trigger job_requests_caps before insert or update of text on public.job_requests for each row execute function public.erp_caps_text();
drop trigger if exists services_caps on public.services;
create trigger services_caps before insert or update of name on public.services for each row execute function public.erp_caps_text();
drop trigger if exists part_catalogue_caps on public.part_catalogue;
create trigger part_catalogue_caps before insert or update of name on public.part_catalogue for each row execute function public.erp_caps_text();

-- 2. The locks let a change of letter case through (nothing else): the line lock (team allowed, as before) ...
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
    v_old := to_jsonb(old) - 'updated_at' - 'updated_by' - 'line_total' - 'customer_approved' - 'price_checked_at' - 'price_checked_by' - 'team';
    v_new := to_jsonb(new) - 'updated_at' - 'updated_by' - 'line_total' - 'customer_approved' - 'price_checked_at' - 'price_checked_by' - 'team';
    if v_old is distinct from v_new and lower(v_old::text) is distinct from lower(v_new::text) then
      raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; its lines cannot be changed. Make a new version.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ... and the header lock (the note to the customer may change case, nothing else).
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
        if c = 'customer_note' and lower(v_old ->> c) is not distinct from lower(v_new ->> c) then
          continue;
        end if;
        raise exception 'QUOTE_LOCKED: this quotation was approved by the customer; % cannot be changed. Make a new version.', replace(c, '_', ' ') using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- 3. The existing text, letter case only. Counts in the notices.
do $$
declare
  n int;
begin
  update public.quotation_lines set title = upper(title), details = upper(details)
   where title is distinct from upper(title) or details is distinct from upper(details);
  get diagnostics n = row_count; raise notice 'quotation and estimate lines: %', n;

  update public.quotations set customer_note = upper(customer_note) where customer_note is distinct from upper(customer_note);
  get diagnostics n = row_count; raise notice 'notes to the customer: %', n;

  -- Proformas only: issued tax invoices and credit notes stay exactly as issued.
  update public.invoice_lines set description = upper(description)
   where description is distinct from upper(description)
     and invoice_id in (select id from public.invoices where kind = 'proforma');
  get diagnostics n = row_count; raise notice 'proforma lines: %', n;

  update public.work_lines set title = upper(title) where title is distinct from upper(title);
  get diagnostics n = row_count; raise notice 'job card work lines: %', n;

  update public.job_requests set text = upper(text) where text is distinct from upper(text);
  get diagnostics n = row_count; raise notice 'customer requests: %', n;

  update public.services set name = upper(name) where name is distinct from upper(name);
  get diagnostics n = row_count; raise notice 'services list: %', n;

  update public.part_catalogue set name = upper(name) where name is distinct from upper(name);
  get diagnostics n = row_count; raise notice 'parts list: %', n;
end $$;

notify pgrst, 'reload schema';
