-- 16 October 2026, section E: a tyre row on the Parts table carries its details (brand, model, size, year, marks) as
-- one record and takes its name from them; the tyre models per brand live in Settings; the import's availability
-- words become "Supplier stock: 653" / "Out of stock".
alter table public.part_items add column if not exists tyre_spec jsonb;

insert into public.settings (key, value, label, description)
values ('tyre_models', '{}'::jsonb, 'Tyre models', 'Tyre models per brand, offered as one-tap choices in the tyre details window; a model typed there is added by itself.')
on conflict (key) do nothing;

-- Tyre rows whose size sat in the part number box: the size joins the name (part numbers never reach the customer).
update public.part_items
  set description = btrim(description) || ' ' || regexp_replace(upper(part_number), '\s*R\s*', ' R'), part_number = null
  where is_active and description ~* '^tyres?\M' and part_number ~* '^\d{3}/\d{2}\s?R\s?\d{2}$' and description !~* '\d{3}/\d{2}\s?R\s?\d{2}';
update public.quotation_lines l
  set title = p.description
  from public.part_items p
  where l.part_item_id = p.id and l.is_active and l.title ~* '^tyres?\M' and l.title !~* '\d{3}/\d{2}\s?R\s?\d{2}' and p.description ~* '\d{3}/\d{2}\s?R\s?\d{2}'
    and exists (select 1 from public.quotations q where q.id = l.quotation_id and q.status in ('draft', 'pending_owner'));

-- Availability notes from price imports: "Supplier to confirm (653)" was the supplier's stock figure.
update public.part_items set availability_note = 'Out of stock' where availability_note ~ '^Supplier to confirm \(-\d+\)$';
update public.part_items set availability_note = 'Supplier stock: ' || substring(availability_note from '\((\d+)\)') where availability_note ~ '^Supplier to confirm \(\d+\)$';
