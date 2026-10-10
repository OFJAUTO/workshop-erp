-- Fixes from the first day of staff testing (10 October 2026).

-- A4: one tap, one row. The editor sends a key with every add; a retry with the same key is the same row.
alter table public.quotation_lines add column if not exists client_key text;
create unique index if not exists quotation_lines_client_key_idx on public.quotation_lines (client_key) where client_key is not null;
alter table public.part_requests add column if not exists client_key text;
create unique index if not exists part_requests_client_key_idx on public.part_requests (client_key) where client_key is not null;

-- B1: the pre-scan gate is on.
update public.settings set value = 'true'::jsonb where key = 'prescan_gate_enabled';

-- D3: the supplier list carries what an LPO and a supplier invoice need.
alter table public.suppliers add column if not exists trn text;
alter table public.suppliers add column if not exists address text;
alter table public.suppliers add column if not exists payment_terms text;

-- D4: purchase orders are called LPOs; the next number starts the LPO series.
alter table public.purchase_orders alter column number set default ('LPO-' || lpad(nextval('public.po_number_seq')::text, 5, '0'));

-- E2: the manager's time budget for the technicians, separate from the hours charged.
alter table public.jobs add column if not exists budget_hours numeric(6,1);
alter table public.jobs add column if not exists budget_reason text;
alter table public.jobs add column if not exists budget_by uuid references public.staff (id);
alter table public.jobs add column if not exists budget_at timestamptz;

-- F1: a proforma turns into the tax invoice once it is paid in full; a tax invoice by hand needs a reason.
alter table public.invoices add column if not exists converted_from uuid references public.invoices (id);
alter table public.invoices add column if not exists converted_to uuid references public.invoices (id);
alter table public.invoices add column if not exists issue_reason text;
alter table public.jobs add column if not exists invoice_sent_at timestamptz;

-- B3, C4, F2, G: settings.
insert into public.settings (key, value, label, description) values
  ('quick_remarks', '["Noise", "Crack", "Broken", "Leak", "Worn", "Loose", "Missing", "Corroded"]'::jsonb, 'Quick remarks', 'One-tap remarks offered on every checklist item, before the ones learned from earlier reports.'),
  ('advisor_labour_discount', 'false'::jsonb, 'Advisors can discount labour', 'On: advisors see a small discount column on labour and service lines. Off: only the owner discounts.'),
  ('bank_charge_cash_percent', '0'::jsonb, 'Bank charge, cash', 'Percent kept by the bank on cash. Normally 0.'),
  ('bank_charge_cheque_percent', '0'::jsonb, 'Bank charge, cheque', 'Percent kept by the bank on cheques. Normally 0.'),
  ('customer_documents_uppercase', 'false'::jsonb, 'Print customer documents in CAPITALS', 'On: every line on quotations, estimates, invoices and reports the customer sees is printed in capitals.'),
  ('known_words', '["BMW", "AMG", "A/C", "ABS", "TPMS", "VIN", "QC", "LPO", "LLC", "FZE", "FZCO", "DMCC", "UAE", "GCC", "VAT", "TRN", "SUV", "AWD", "4WD", "RS", "GT", "GTS", "GTR", "SRT", "GLE", "GLS", "GLC", "CLA", "CLS", "SL", "SLS", "SLK", "McLaren", "DBS", "DB11", "DB12", "SVR", "SVJ", "SF90", "F8", "GTB", "GTC4", "LED", "ECU", "DPF", "EGR", "PCM", "TCM", "DSG", "PDK", "MOT", "RPM", "OEM", "PPF", "II", "III", "IV", "V8", "V6", "V10", "V12", "W12", "M3", "M4", "M5", "X5", "X6", "X7", "iX", "EQS", "EQE", "ID.4", "RAV4", "CR-V", "HR-V", "Q7", "Q8", "RS6", "RS7", "S63", "C63", "E63", "G63", "G500", "LX", "GX", "NX", "RX", "UX", "LC500", "IS", "ES", "LS", "GR", "TRD", "USB", "AUX", "GPS", "OK"]'::jsonb, 'Known words', 'Words that keep their capitals when the system tidies names and descriptions (BMW, AMG, A/C). One per line, or separated by commas.'),
  ('bank_charge_card_percent', '2.26'::jsonb, 'Bank charge, card machine', 'Percent kept by the bank on card payments.'),
  ('bank_charge_link_percent', '1.75'::jsonb, 'Bank charge, payment link', 'Percent kept by the bank on payment links.'),
  ('whatsapp_invoice_template', '"Dear [name], thank you for your payment. Your tax invoice for the [make model] ([plate]) is here:\n[link]\nThank you, [advisor], OFJ Automotive"'::jsonb, 'WhatsApp tax invoice message', 'Sent with the tax invoice link once the proforma is paid. Placeholders: [name], [make model], [plate], [link], [advisor].')
on conflict (key) do nothing;
update public.settings set value = '2.26'::jsonb where key = 'bank_charge_card_percent' and value = '1.9'::jsonb;
update public.settings set value = '1.75'::jsonb where key = 'bank_charge_link_percent' and value = '1.9'::jsonb;

-- G: text tidiness. Names in Title Case, codes in CAPITALS, descriptions in sentence case; known words keep their form.
create or replace function public.erp_known_words() returns text[] language sql stable as $$
  select coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce((select value from public.settings where key = 'known_words'), '[]'::jsonb)) x), '{}'::text[]);
$$;

-- Puts every known word back in its own form, wherever it appears as a whole word.
create or replace function public.erp_apply_known(t text) returns text language plpgsql stable as $$
declare
  kw text;
begin
  if t is null or t = '' then return t; end if;
  foreach kw in array public.erp_known_words() loop
    if kw <> '' then
      t := regexp_replace(t, '(^|[^[:alnum:]])' || regexp_replace(kw, '([.^$*+?()\[\]{}|\\/])', '\\\1', 'g') || '($|[^[:alnum:]])', '\1' || kw || '\2', 'gi');
    end if;
  end loop;
  return t;
end $$;

-- Title Case for names: each word that is all capitals or all lower-case is fixed; words with their own capitals (McLaren) stay.
create or replace function public.erp_title_case(t text) returns text language plpgsql stable as $$
declare
  parts text[];
  i int;
  w text;
  out text := '';
begin
  if t is null then return null; end if;
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  if t = '' then return t; end if;
  parts := regexp_split_to_array(t, ' ');
  for i in 1..array_length(parts, 1) loop
    w := parts[i];
    if w = upper(w) or w = lower(w) then
      w := initcap(lower(w));
    end if;
    out := out || case when i = 1 then '' else ' ' end || w;
  end loop;
  return public.erp_apply_known(out);
end $$;

-- Sentence case for descriptions: shouty or all-lower text becomes normal; mixed text only gets its first letters.
create or replace function public.erp_sentence_case(t text) returns text language plpgsql stable as $$
declare
  letters text;
  out text;
begin
  if t is null then return null; end if;
  out := btrim(t);
  if out = '' then return out; end if;
  letters := regexp_replace(out, '[^[:alpha:]]', '', 'g');
  if letters <> '' and (letters = upper(letters) or letters = lower(letters)) then
    -- Lower everything except words with digits or symbols inside (part numbers, sizes), then capitalise sentence starts.
    out := regexp_replace(out, '\m([[:alpha:]]+)\M', lower('\1'), 'g');
    out := (select string_agg(case when x ~ '[0-9/\-]' then x else lower(x) end, ' ') from regexp_split_to_table(out, ' ') x);
  end if;
  out := regexp_replace(out, '(^|[.!?]\s+)([[:lower:]])', '\1' || upper('\2'), 'g');
  out := upper(substr(out, 1, 1)) || substr(out, 2);
  return public.erp_apply_known(out);
end $$;

create or replace function public.erp_upper_code(t text) returns text language sql immutable as $$
  select case when t is null then null else upper(btrim(t)) end;
$$;

-- One trigger function per table, naming the columns it tidies.
create or replace function public.erp_tidy_customers() returns trigger language plpgsql as $$
begin
  new.full_name := public.erp_title_case(new.full_name);
  new.company_name := public.erp_title_case(new.company_name);
  new.area := public.erp_title_case(new.area);
  new.trn := public.erp_upper_code(new.trn);
  new.notes := public.erp_sentence_case(new.notes);
  new.vip_note := public.erp_sentence_case(new.vip_note);
  return new;
end $$;
drop trigger if exists customers_tidy on public.customers;
create trigger customers_tidy before insert or update on public.customers for each row execute function public.erp_tidy_customers();

create or replace function public.erp_tidy_vehicles() returns trigger language plpgsql as $$
begin
  new.plate_code := public.erp_upper_code(new.plate_code);
  new.plate_number := public.erp_upper_code(new.plate_number);
  new.vin := public.erp_upper_code(new.vin);
  new.colour := public.erp_title_case(new.colour);
  new.notes := public.erp_sentence_case(new.notes);
  return new;
end $$;
drop trigger if exists vehicles_tidy on public.vehicles;
create trigger vehicles_tidy before insert or update on public.vehicles for each row execute function public.erp_tidy_vehicles();

create or replace function public.erp_tidy_suppliers() returns trigger language plpgsql as $$
begin
  new.name := public.erp_title_case(new.name);
  new.trn := public.erp_upper_code(new.trn);
  new.payment_terms := public.erp_sentence_case(new.payment_terms);
  new.notes := public.erp_sentence_case(new.notes);
  return new;
end $$;
drop trigger if exists suppliers_tidy on public.suppliers;
create trigger suppliers_tidy before insert or update on public.suppliers for each row execute function public.erp_tidy_suppliers();

create or replace function public.erp_tidy_part_items() returns trigger language plpgsql as $$
begin
  new.part_number := public.erp_upper_code(new.part_number);
  new.description := public.erp_sentence_case(new.description);
  new.brand := public.erp_title_case(new.brand);
  new.supplier := public.erp_title_case(new.supplier);
  return new;
end $$;
drop trigger if exists part_items_tidy on public.part_items;
create trigger part_items_tidy before insert or update on public.part_items for each row execute function public.erp_tidy_part_items();

create or replace function public.erp_tidy_part_requests() returns trigger language plpgsql as $$
begin
  new.label := public.erp_sentence_case(new.label);
  return new;
end $$;
drop trigger if exists part_requests_tidy on public.part_requests;
create trigger part_requests_tidy before insert or update on public.part_requests for each row execute function public.erp_tidy_part_requests();

create or replace function public.erp_tidy_purchase_orders() returns trigger language plpgsql as $$
begin
  new.supplier_name := public.erp_title_case(new.supplier_name);
  new.supplier_invoice_number := public.erp_upper_code(new.supplier_invoice_number);
  return new;
end $$;
drop trigger if exists purchase_orders_tidy on public.purchase_orders;
create trigger purchase_orders_tidy before insert or update on public.purchase_orders for each row execute function public.erp_tidy_purchase_orders();

create or replace function public.erp_tidy_quotation_lines() returns trigger language plpgsql as $$
begin
  if new.fee_kind is null then
    new.title := public.erp_sentence_case(new.title);
  end if;
  new.details := public.erp_sentence_case(new.details);
  return new;
end $$;
drop trigger if exists quotation_lines_tidy on public.quotation_lines;
create trigger quotation_lines_tidy before insert or update on public.quotation_lines for each row execute function public.erp_tidy_quotation_lines();

create or replace function public.erp_tidy_inspection_items() returns trigger language plpgsql as $$
begin
  new.remarks := public.erp_sentence_case(new.remarks);
  new.parts_needed := public.erp_sentence_case(new.parts_needed);
  return new;
end $$;
drop trigger if exists inspection_items_tidy on public.inspection_items;
create trigger inspection_items_tidy before insert or update on public.inspection_items for each row execute function public.erp_tidy_inspection_items();

create or replace function public.erp_tidy_inspection_findings() returns trigger language plpgsql as $$
begin
  new.found := public.erp_sentence_case(new.found);
  new.needs := public.erp_sentence_case(new.needs);
  return new;
end $$;
drop trigger if exists inspection_findings_tidy on public.inspection_findings;
create trigger inspection_findings_tidy before insert or update on public.inspection_findings for each row execute function public.erp_tidy_inspection_findings();

create or replace function public.erp_tidy_job_requests() returns trigger language plpgsql as $$
begin
  new.text := public.erp_sentence_case(new.text);
  return new;
end $$;
drop trigger if exists job_requests_tidy on public.job_requests;
create trigger job_requests_tidy before insert or update on public.job_requests for each row execute function public.erp_tidy_job_requests();

create or replace function public.erp_tidy_work_lines() returns trigger language plpgsql as $$
begin
  new.title := public.erp_sentence_case(new.title);
  new.details := public.erp_sentence_case(new.details);
  return new;
end $$;
drop trigger if exists work_lines_tidy on public.work_lines;
create trigger work_lines_tidy before insert or update on public.work_lines for each row execute function public.erp_tidy_work_lines();

create or replace function public.erp_tidy_name() returns trigger language plpgsql as $$
begin
  new.name := public.erp_title_case(new.name);
  return new;
end $$;
drop trigger if exists vehicle_makes_tidy on public.vehicle_makes;
create trigger vehicle_makes_tidy before insert or update on public.vehicle_makes for each row execute function public.erp_tidy_name();
drop trigger if exists vehicle_models_tidy on public.vehicle_models;
create trigger vehicle_models_tidy before insert or update on public.vehicle_models for each row execute function public.erp_tidy_name();

-- Existing entries, tidied once (the audit log records the pass).
update public.customers set full_name = full_name where id is not null;
update public.vehicles set vin = vin where id is not null;
update public.suppliers set name = name where id is not null;
update public.part_items set description = description where id is not null;
update public.part_requests set label = label where id is not null;
update public.purchase_orders set supplier_name = supplier_name where id is not null;
update public.quotation_lines set title = title where id is not null;
update public.inspection_items set remarks = remarks where remarks is not null or parts_needed is not null;
update public.inspection_findings set found = found where id is not null;
update public.job_requests set text = text where id is not null;
update public.work_lines set title = title where id is not null;
update public.vehicle_makes set name = name where id is not null;
update public.vehicle_models set name = name where id is not null;
