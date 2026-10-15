-- 15 October 2026: credit terms per customer (off by default), revised quotations that remember the line they came from,
-- the discount scope (labour only, or labour and our own services), the markup reminder log, services with an explicit
-- kind (Minor and Major service are services, Labour charges is the one standard labour line), the three software
-- items, and the new settings rows (damage note chips, the revised-quotation message, sticker sizes per sticker).

alter table public.customers add column if not exists credit_terms_days integer check (credit_terms_days is null or (credit_terms_days >= 1 and credit_terms_days <= 365));
alter table public.customers add column if not exists credit_terms_set_by uuid references public.staff (id);
alter table public.customers add column if not exists credit_terms_set_at timestamptz;

alter table public.quotation_lines add column if not exists revised_from_line_id uuid references public.quotation_lines (id);
alter table public.quotations add column if not exists discount_scope text not null default 'labour' check (discount_scope in ('labour', 'labour_services'));
alter table public.quotations add column if not exists markup_skipped_at timestamptz;
alter table public.quotations add column if not exists markup_skipped_by uuid references public.staff (id);

alter table public.services add column if not exists line_kind text check (line_kind is null or line_kind in ('labour', 'service'));
-- Minor and major service are services, not labour: minor at AED 750 by default (editable), major priced by the advisor.
update public.services set line_kind = 'service', price_aed = coalesce(price_aed, 750) where lower(name) = 'minor service' and is_active;
update public.services set line_kind = 'service' where lower(name) = 'major service' and is_active;
-- The one standard labour line: Labour charges (the advisor types the hours, the rate comes from Settings).
insert into public.services (name, department, price_aed, default_hours, category_id, position, line_kind)
select 'Labour charges', 'both', null, null, s.category_id, 0, 'labour'
from public.services s
where lower(s.name) = 'minor service' and s.is_active and not exists (select 1 from public.services x where lower(x.name) = 'labour charges')
limit 1;
-- The software item became three, each with its own condition and note.
update public.services set name = 'Software update' where lower(name) = 'software update or coding' and is_active;
insert into public.services (name, department, price_aed, default_hours, category_id, position, line_kind)
select v.name, 'both', null, null, s.category_id, s.position + 1, 'labour'
from public.services s, (values ('Software reset'), ('Coding / programming')) as v(name)
where lower(s.name) = 'software update' and s.is_active and not exists (select 1 from public.services x where lower(x.name) = lower(v.name));

-- The inspection checklist setting: the one software item becomes three (the code default changed the same way).
do $$
declare
  v jsonb;
  outv jsonb := '[]'::jsonb;
  sec jsonb;
  it jsonb;
  items jsonb;
begin
  select value into v from public.settings where key = 'inspection_checklist';
  if v is null or jsonb_typeof(v) <> 'array' then return; end if;
  for sec in select * from jsonb_array_elements(v) loop
    items := '[]'::jsonb;
    for it in select * from jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) loop
      if (it->>'label') ilike 'software update%' then
        items := items
          || jsonb_build_array(jsonb_build_object('key', (sec->>'key') || '.software_update', 'label', 'Software update', 'style', 'job'))
          || jsonb_build_array(jsonb_build_object('key', (sec->>'key') || '.software_reset', 'label', 'Software reset', 'style', 'job'))
          || jsonb_build_array(jsonb_build_object('key', (sec->>'key') || '.coding_programming', 'label', 'Coding / programming', 'style', 'job'));
      else
        items := items || jsonb_build_array(it);
      end if;
    end loop;
    outv := outv || jsonb_build_array(sec || jsonb_build_object('items', items));
  end loop;
  update public.settings set value = outv where key = 'inspection_checklist';
end $$;

-- The old labour jobs list: the software entry renamed, the two services taken out (they are services now).
update public.settings
set value = coalesce((
  select jsonb_object_agg(e.k, coalesce((
    select jsonb_agg(case when x ilike 'software update%' then 'Software update' else x end)
    from jsonb_array_elements_text(e.v) x
    where lower(x) not in ('minor service', 'major service')
  ), '[]'::jsonb))
  from jsonb_each(value) e(k, v)
), '{}'::jsonb)
where key = 'labour_jobs' and jsonb_typeof(value) = 'object';

insert into public.settings (key, value, label, description) values
  ('damage_note_chips', '["Scratches", "Dents", "Stone chips", "Paint peeling", "PPF peeling", "PPF scratched", "Cracked bumper", "Kerbed wheels", "Windscreen chip", "Broken light"]'::jsonb, 'Damage note chips', 'One-tap words above the gate-in damage note. Several can be picked; typing always works too.'),
  ('whatsapp_quote_revised_template', to_jsonb(E'Your quotation for [make model] ([plate]) has been updated:\n[link]'::text), 'WhatsApp: revised quotation', 'Sent with the link when a quotation is revised after it was sent.'),
  ('sticker_battery_mm', '60'::jsonb, 'Battery sticker size (mm)', 'Square, printed at this exact size on the label printer.'),
  ('sticker_service_mm', '60'::jsonb, 'Oil service sticker size (mm)', 'Square, printed at this exact size on the label printer.')
on conflict (key) do nothing;

-- Clocks: the morning "left running overnight" notice is sent once per clock; a bodyshop clocking closed by the hourly job says so.
alter table public.work_sessions add column if not exists overnight_notified_at timestamptz;
alter table public.bodyshop_clockings add column if not exists closed_reason text;
alter table public.bodyshop_clockings add column if not exists overnight_notified_at timestamptz;
