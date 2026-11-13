-- 13 November 2026 (Section 14): the inspection report's PCV valve and fuel injectors, in the Engine bay section.
-- 1. The answer styles "pcv" (OK / Faulty, replace) and "injector" (OK / Needs service and further check / Replace).
alter table public.inspection_items drop constraint if exists inspection_items_style_check;
alter table public.inspection_items add constraint inspection_items_style_check check (style in ('grade', 'job', 'gas', 'pcv', 'injector'));

-- 2. The two items join the stored checklist right after "Intake manifold" (once; reports already made keep theirs).
do $$
declare
  cl jsonb;
  sec jsonb;
  items jsonb;
  out_items jsonb;
  it jsonb;
  i int;
  new_sections jsonb := '[]'::jsonb;
  pcv jsonb := '{"key": "engine_bay.pcv_valve", "label": "PCV valve", "style": "pcv"}'::jsonb;
  inj jsonb := '{"key": "engine_bay.fuel_injectors", "label": "Fuel injectors", "style": "injector"}'::jsonb;
begin
  select value into cl from public.settings where key = 'inspection_checklist';
  if cl is null or jsonb_typeof(cl) <> 'array' then return; end if;
  if cl::text like '%engine_bay.pcv_valve%' then return; end if;
  for i in 0 .. jsonb_array_length(cl) - 1 loop
    sec := cl -> i;
    if sec ->> 'key' = 'engine_bay' then
      items := coalesce(sec -> 'items', '[]'::jsonb);
      out_items := '[]'::jsonb;
      for it in select * from jsonb_array_elements(items) loop
        out_items := out_items || jsonb_build_array(it);
        if it ->> 'key' = 'engine_bay.intake_manifold' then out_items := out_items || jsonb_build_array(pcv, inj); end if;
      end loop;
      if out_items::text not like '%engine_bay.pcv_valve%' then out_items := out_items || jsonb_build_array(pcv, inj); end if;
      sec := jsonb_set(sec, '{items}', out_items);
    end if;
    new_sections := new_sections || jsonb_build_array(sec);
  end loop;
  update public.settings set value = new_sections, updated_at = now() where key = 'inspection_checklist';
end $$;
