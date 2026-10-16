-- 16 October 2026, section D: the deposit is the advisor's choice on the quotation (a fixed amount, a percentage of the
-- parts or of the total; the old rule only suggests), revisions after the customer's approval need the owner's one-time
-- permission, services can be "outside work" (our cost typed, never in the labour discount), the deposit document and
-- the deposit receipt message in Settings, and the services list gains the wheels, A/C and outside-work items.

alter table public.quotations
  add column if not exists deposit_mode text,
  add column if not exists deposit_value numeric(12,2),
  add column if not exists deposit_set_by uuid references public.staff(id),
  add column if not exists deposit_set_at timestamptz,
  add column if not exists deposit_skipped_at timestamptz,
  add column if not exists deposit_skipped_by uuid references public.staff(id),
  add column if not exists deposit_reminded_at timestamptz,
  add column if not exists revision_requested_at timestamptz,
  add column if not exists revision_requested_by uuid references public.staff(id),
  add column if not exists revision_request_reason text,
  add column if not exists revision_request_kind text,
  add column if not exists revision_allowed_at timestamptz,
  add column if not exists revision_allowed_by uuid references public.staff(id),
  add column if not exists revision_declined_at timestamptz,
  add column if not exists revision_declined_by uuid references public.staff(id),
  add column if not exists revision_decision_note text;
alter table public.quotations drop constraint if exists quotations_deposit_mode_check;
alter table public.quotations add constraint quotations_deposit_mode_check check (deposit_mode is null or deposit_mode in ('none', 'aed', 'percent_parts', 'percent_total'));
alter table public.quotations drop constraint if exists quotations_revision_request_kind_check;
alter table public.quotations add constraint quotations_revision_request_kind_check check (revision_request_kind is null or revision_request_kind in ('advisor', 'parts'));
-- Quotations that already carried a deposit (the old automatic rule) keep it as a fixed amount.
update public.quotations set deposit_mode = 'aed', deposit_value = deposit_aed where deposit_aed > 0 and deposit_mode is null;

alter table public.quotation_lines add column if not exists outside_work boolean not null default false;
alter table public.services add column if not exists outside_work boolean not null default false;
alter table public.purchase_orders add column if not exists deposit_waiting_notified_at timestamptz;
alter table public.payments
  add column if not exists deposit_quotation_id uuid references public.quotations(id),
  add column if not exists deposit_invoice_number text;

insert into public.settings (key, value, label, description) values
  ('deposit_document', '"receipt"'::jsonb, 'Deposit document', 'What the customer gets for a deposit: a receipt only, or a tax invoice for the deposit as well.'),
  ('whatsapp_deposit_receipt_template', to_jsonb(E'Thank you for your deposit of AED [amount] for [make model] ([plate]). Your receipt is here:\n[link]'::text), 'WhatsApp: deposit receipt', 'Sent with the deposit receipt. Placeholders: [name], [make model], [plate], [amount], [link].')
on conflict (key) do nothing;

-- The services list: wheels and tyres jobs are fixed-price services, A/C gas recharge, and the "Outside work" category.
do $$
declare
  wheels uuid;
  servicing uuid;
  outside uuid;
  pos int;
begin
  select id into wheels from public.service_categories where lower(name) = 'wheels and tyres' and is_active order by position limit 1;
  select id into servicing from public.service_categories where lower(name) = 'servicing' and is_active order by position limit 1;
  if wheels is not null then
    update public.services set line_kind = 'service'
      where category_id = wheels and is_active
        and lower(name) in ('wheel alignment', 'wheel balancing', 'road force wheel balancing', 'tyre fitting (per tyre)', 'puncture repair', 'tpms sensor programming');
    update public.services set suggest_for = array(select distinct unnest(coalesce(suggest_for, '{}'::text[]) || array['steering_and_suspension.wheel_alignment', 'wheels_tyres_and_brakes.wheel_alignment']))
      where category_id = wheels and is_active and lower(name) = 'wheel alignment';
    update public.services set suggest_for = array(select distinct unnest(coalesce(suggest_for, '{}'::text[]) || array['wheels_tyres_and_brakes.wheel_balancing']))
      where category_id = wheels and is_active and lower(name) = 'wheel balancing';
    if not exists (select 1 from public.services where category_id = wheels and lower(name) = 'tpms sensor programming') then
      select coalesce(max(position), 0) + 1 into pos from public.services where category_id = wheels;
      insert into public.services (category_id, name, department, price_aed, line_kind, price_per, position) values (wheels, 'TPMS sensor programming', 'mechanical', null, 'service', 'job', pos);
    end if;
  end if;
  if servicing is not null then
    update public.services set line_kind = 'service' where category_id = servicing and is_active and lower(name) in ('minor service', 'major service');
    if not exists (select 1 from public.services where category_id = servicing and lower(name) like 'a/c gas recharge%') then
      select coalesce(max(position), 0) + 1 into pos from public.services where category_id = servicing;
      insert into public.services (category_id, name, department, price_aed, line_kind, price_per, position) values (servicing, 'A/C gas recharge', 'mechanical', null, 'service', 'job', pos);
    end if;
  end if;
  select id into outside from public.service_categories where lower(name) = 'outside work' and is_active order by position limit 1;
  if outside is null then
    select coalesce(max(position), 0) + 1 into pos from public.service_categories;
    insert into public.service_categories (name, position) values ('Outside work', pos) returning id into outside;
  end if;
  if not exists (select 1 from public.services where category_id = outside and lower(name) = 'lathe charges') then
    insert into public.services (category_id, name, department, price_aed, line_kind, price_per, usual_quantity, outside_work, position) values (outside, 'Lathe charges', 'mechanical', null, 'service', 'piece', 1, true, 1);
  end if;
  -- The Bosch injector service moves from Servicing to Outside work.
  update public.services set category_id = outside, name = 'Fuel injector service (Bosch)', line_kind = 'service', outside_work = true, position = 2
    where is_active and lower(name) in ('fuel injector service', 'fuel injector service (bosch)');
  update public.services set outside_work = true where category_id = outside and is_active;
end $$;
