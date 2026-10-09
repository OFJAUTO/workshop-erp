-- Quotation rules, 9 October 2026: the parts price floor, "Other" and "Recovery" lines with hidden
-- internal costs, bank charges, urgent/recommended labels with all-or-nothing approval, parts added by
-- an advisor, the services list that replaces fixed-price packages, and narrower visibility.

-- 1. Services list (categories and services the owner manages) --------------------------------
create table public.service_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id)
);
create table public.services (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references public.service_categories (id),
  name           text not null,
  department     text not null default 'both' check (department in ('mechanical', 'bodyshop', 'both')),
  price_aed      numeric(12,2) check (price_aed is null or price_aed >= 0),   -- fixed price, or
  default_hours  numeric(6,1) check (default_hours is null or default_hours > 0), -- default labour hours
  description    text,
  parts_requests text[] not null default '{}',   -- labels sent to Parts when the service is added
  position       integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);
create index services_category_idx on public.services (category_id, position);
do $$
declare t text;
begin
  foreach t in array array['service_categories', 'services'] loop
    execute format('create trigger %I_audit_columns before insert or update on public.%I for each row execute function public.set_audit_columns()', t, t);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function public.write_audit_log()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.prevent_delete()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.has_role(''owner''))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.has_role(''owner'')) with check (public.has_role(''owner''))', t, t);
  end loop;
end $$;

-- The owner's starting list. Prices and hours are left empty for the owner to fill in.
do $$
declare
  cats text[] := array['Servicing', 'Brakes', 'Wheels and tyres', 'Suspension and steering', 'Engine and cooling', 'Transmission and driveline', 'Air conditioning', 'Electrical', 'Diagnostics', 'Detailing', 'Bodyshop'];
  items text[][] := array[
    array['Minor service', 'Major service', 'Oil and filter change', 'Spark plug replacement', 'Air filter replacement', 'Cabin filter replacement', 'Coolant flush', 'Brake fluid change', 'Transmission oil service', 'Differential oil change', 'Transfer case oil change'],
    array['Front brake pad replacement', 'Rear brake pad replacement', 'Front brake disc replacement', 'Rear brake disc replacement', 'Front brake disc skimming', 'Rear brake disc skimming', 'Brake bleeding', 'Brake caliper overhaul', 'Brake hose replacement', 'Parking brake adjustment', null],
    array['Wheel alignment', 'Wheel fitting with road force balancing', 'Wheel removal and refitting', 'Wheel balancing', 'Tyre fitting (per tyre)', 'Tyre rotation', 'Puncture repair', 'Tyre pressure sensor replacement', null, null, null],
    array['Front shock absorber replacement', 'Rear shock absorber replacement', 'Lower arm replacement', 'Upper arm replacement', 'Stabilizer link replacement', 'Stabilizer bush replacement', 'Tie rod end replacement', 'Wheel bearing replacement', 'Air suspension strut replacement', null, null],
    array['Serpentine belt replacement', 'Tensioner and pulley replacement', 'Engine mount replacement', 'Valve cover gasket replacement', 'Front crank seal replacement', 'Water pump replacement', 'Thermostat replacement', 'Radiator replacement', 'Coolant hose replacement', 'Ignition coil replacement', null],
    array['Transmission mount replacement', 'Drive shaft replacement', 'CV boot replacement', 'Differential seal replacement', null, null, null, null, null, null, null],
    array['A/C gas refill', 'A/C leak test', 'A/C compressor replacement', 'A/C condenser replacement', 'A/C smell treatment', null, null, null, null, null, null],
    array['Battery replacement', 'Auxiliary battery replacement', 'Alternator replacement', 'Starter motor replacement', 'Headlight replacement', 'Tail lamp replacement', 'Wiper blade replacement', 'Parking sensor replacement', null, null, null],
    array['Diagnostic scan', 'Fault diagnosis (per hour)', 'Pre-purchase inspection', 'Software update or coding', null, null, null, null, null, null, null],
    array['Car wash', 'Interior detailing', 'Engine bay cleaning', 'Polish', null, null, null, null, null, null, null],
    array['Full front PPF', 'Full body PPF', 'Window tint', 'Ceramic coating', 'Paint per panel', 'Dent repair', null, null, null, null, null]
  ];
  parts_for jsonb := '{"Front brake pad replacement": ["Front brake pads"], "Rear brake pad replacement": ["Rear brake pads"], "Front brake disc replacement": ["Front brake discs", "Front brake pads"], "Rear brake disc replacement": ["Rear brake discs", "Rear brake pads"], "Oil and filter change": ["Engine oil", "Oil filter"], "Spark plug replacement": ["Spark plugs"], "Air filter replacement": ["Air filter"], "Cabin filter replacement": ["Cabin filter"], "Brake hose replacement": ["Brake hose"], "Front shock absorber replacement": ["Front shock absorbers"], "Rear shock absorber replacement": ["Rear shock absorbers"], "Lower arm replacement": ["Lower arm"], "Upper arm replacement": ["Upper arm"], "Stabilizer link replacement": ["Stabilizer links"], "Stabilizer bush replacement": ["Stabilizer bushes"], "Tie rod end replacement": ["Tie rod ends"], "Wheel bearing replacement": ["Wheel bearing"], "Air suspension strut replacement": ["Air suspension strut"], "Serpentine belt replacement": ["Serpentine belt"], "Tensioner and pulley replacement": ["Tensioner", "Pulley"], "Engine mount replacement": ["Engine mounts"], "Valve cover gasket replacement": ["Valve cover gasket"], "Front crank seal replacement": ["Front crank seal"], "Water pump replacement": ["Water pump"], "Thermostat replacement": ["Thermostat"], "Radiator replacement": ["Radiator"], "Coolant hose replacement": ["Coolant hose"], "Ignition coil replacement": ["Ignition coils"], "Transmission mount replacement": ["Transmission mount"], "Drive shaft replacement": ["Drive shaft"], "CV boot replacement": ["CV boot"], "Differential seal replacement": ["Differential seal"], "A/C compressor replacement": ["A/C compressor"], "A/C condenser replacement": ["A/C condenser"], "Battery replacement": ["Battery"], "Auxiliary battery replacement": ["Auxiliary battery"], "Alternator replacement": ["Alternator"], "Starter motor replacement": ["Starter motor"], "Headlight replacement": ["Headlight"], "Tail lamp replacement": ["Tail lamp"], "Wiper blade replacement": ["Wiper blades"], "Parking sensor replacement": ["Parking sensor"], "Tyre pressure sensor replacement": ["Tyre pressure sensor"]}'::jsonb;
  c integer; i integer; cat_id uuid; dept text; req text[];
begin
  if exists (select 1 from public.service_categories) then return; end if;
  for c in 1 .. array_length(cats, 1) loop
    insert into public.service_categories (name, position) values (cats[c], c) returning id into cat_id;
    dept := case when cats[c] = 'Bodyshop' then 'bodyshop' when cats[c] = 'Detailing' then 'both' else 'mechanical' end;
    for i in 1 .. 11 loop
      if items[c][i] is not null then
        req := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(parts_for -> items[c][i], '[]'::jsonb)) x), '{}');
        insert into public.services (category_id, name, department, parts_requests, position) values (cat_id, items[c][i], dept, req, i);
      end if;
    end loop;
  end loop;
end $$;

-- 2. Lines: Other and Recovery, hidden internal costs, urgency, owner discount reasons, advisor-added parts
alter table public.quotation_lines drop constraint if exists quotation_lines_line_type_check;
update public.quotation_lines set line_type = 'other' where line_type = 'outside';
alter table public.quotation_lines add constraint quotation_lines_line_type_check check (line_type in ('labour', 'part', 'package', 'other', 'recovery', 'fee'));
alter table public.quotation_lines add column if not exists visible_to_customer boolean not null default true;
alter table public.quotation_lines add column if not exists urgency text check (urgency is null or urgency in ('urgent', 'recommended'));
alter table public.quotation_lines add column if not exists discount_reason text;
alter table public.quotation_lines add column if not exists advisor_added boolean not null default false;
alter table public.quotation_lines add column if not exists service_id uuid references public.services (id);

-- 3. Quotations: all or nothing, the urgent-only request, card payment tick, who the link went to
alter table public.quotations drop constraint if exists quotations_status_check;
update public.quotations set status = 'approved' where status = 'partly_approved';
alter table public.quotations add constraint quotations_status_check
  check (status in ('draft', 'pending_owner', 'sent', 'opened', 'approved', 'urgent_requested', 'declined', 'expired', 'superseded', 'cancelled'));
alter table public.quotations add column if not exists payment_by_card boolean not null default false;
alter table public.quotations add column if not exists customer_request_note text;
alter table public.quotations add column if not exists sent_to_name text;
alter table public.quotations add column if not exists sent_to_phone text;

-- 4. Settings: bank charges, company details for documents, messages with the link on its own line
insert into public.settings (key, value, label, description) values
  ('bank_charge_card_percent', '1.9'::jsonb, 'Bank charge, card machine (%)', 'Of the total bill including VAT. Internal cost only, never shown to the customer.'),
  ('bank_charge_link_percent', '1.9'::jsonb, 'Bank charge, payment link (%)', 'Of the total bill including VAT. Internal cost only, never shown to the customer.'),
  ('company_address', to_jsonb('Al Quoz, Dubai, United Arab Emirates'::text), 'Company address', 'Shown in the header of every PDF.'),
  ('company_phone', to_jsonb(''::text), 'Company phone', 'Shown in the header of every PDF.'),
  ('company_email', to_jsonb(''::text), 'Company email', 'Shown in the header of every PDF.')
on conflict (key) do nothing;
update public.settings set value = to_jsonb(E'Dear [name], your quotation for your [make model] ([plate]) is ready. Please review it and approve the work you would like us to do:\n[link]\nThank you, [advisor], OFJ Automotive'::text) where key = 'whatsapp_quote_template';
update public.settings set value = to_jsonb(E'Dear [name], our estimate for your [make model] ([plate]) is ready. The final price is confirmed once the vehicle is with us:\n[link]\nThank you, [advisor], OFJ Automotive'::text) where key = 'whatsapp_estimate_template';
update public.settings set value = to_jsonb(E'Dear [name], your [make model] ([plate]) has been received at OFJ Automotive. Please review the check-in video and job card, and approve so we can begin the inspection:\n[link]\nThank you, [advisor], OFJ Automotive'::text) where key = 'whatsapp_approval_template';
update public.settings set value = to_jsonb(E'Dear [name], the inspection of your [make model] ([plate]) is complete. Please review the report with our findings and photos:\n[link]\nThank you, [advisor], OFJ Automotive'::text) where key = 'whatsapp_report_template';

-- 5. Who sees quotations: the owner, and advisors for their own jobs. Parts see part lines only. Nobody else.
create or replace function public.can_see_quotation(p_quotation uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_staff_role()
    when 'owner' then true
    when 'service_advisor' then exists (select 1 from public.quotations q where q.id = p_quotation and (q.created_by = auth.uid() or (q.job_id is not null and public.is_job_advisor(q.job_id))))
    else false end;
$$;
drop view if exists public.quotation_work_lines;
create or replace view public.quotation_part_lines with (security_invoker = false) as
  select l.id, l.quotation_id, q.job_id, q.number, q.version, q.status, l.title, l.quantity, l.part_item_id, l.customer_approved, l.advisor_added
  from public.quotation_lines l
  join public.quotations q on q.id = l.quotation_id
  where l.is_active and q.is_active and l.line_type = 'part' and (public.has_role('owner', 'parts') or public.can_see_quotation(q.id));
revoke all on public.quotation_part_lines from public, anon;
grant select on public.quotation_part_lines to authenticated, service_role;
