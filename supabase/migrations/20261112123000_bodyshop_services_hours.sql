-- Bodyshop costing, part 2 (section 4.2): the owner's bodyshop services exist with their default
-- installer hours. Existing services get hours; the missing ones are created under Bodyshop
-- (priced per car: no stored price), each with its agreed default.

-- Hours on the services that already exist.
update public.services set installer_hours = 96 where is_active and installer_hours is null and name in ('Full PPF', 'Full body PPF', 'Coloured PPF', 'Glossy PPF xpel ultimate fusion premium quality 10 years warranty', 'Ofj platinum paint protection film PPF - 10 years warranty');
update public.services set installer_hours = 48 where is_active and installer_hours is null and name = 'Full front PPF';
update public.services set installer_hours = 4  where is_active and installer_hours is null and name = 'Window tint';
update public.services set installer_hours = 16 where is_active and installer_hours is null and name = 'Old PPF removal';

-- The missing ones, created once (names are unique by sight, not by constraint: guarded inserts).
do $$
declare
  cat uuid;
  pos int;
  r record;
begin
  select id into cat from public.service_categories where name = 'Bodyshop' and is_active limit 1;
  if cat is null then select id into cat from public.service_categories where is_active order by position desc limit 1; end if;
  select coalesce(max(position), 0) into pos from public.services;
  for r in select * from (values
    ('PPF interior (screens & trims)',               'ppf',  8::numeric),
    ('Dismantle & refit (for PPF)',                  'other', 16::numeric),
    ('Detailing & polishing - PPF prep',             'other', 12::numeric),
    ('Ceramic heat-rejection tint - sides & rear',   'tint',  4::numeric),
    ('Windshield film',                              'tint',  2::numeric),
    ('Panoramic roof tint',                          'tint',  2::numeric),
    ('Ceramic coating for PPF',                      'other', 4::numeric),
    ('Ceramic interior leather',                     'other', 4::numeric)
  ) as v(name, kind, hours)
  loop
    if not exists (select 1 from public.services where lower(name) = lower(r.name)) then
      pos := pos + 1;
      insert into public.services (category_id, name, line_kind, department, bodyshop_kind, installer_hours, position, is_active)
      values (cat, r.name, 'service', 'bodyshop', r.kind, r.hours, pos, true);
    else
      update public.services set installer_hours = coalesce(installer_hours, r.hours) where lower(name) = lower(r.name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
