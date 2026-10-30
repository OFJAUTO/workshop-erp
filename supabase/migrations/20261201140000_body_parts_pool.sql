-- Body, lights, glass and interior parts in the parts pool (30 October 2026, night batch section 7).
-- The pickers already show these from the built-in list (src/lib/body-parts.ts) until this runs; afterwards they are
-- the owner's own rows (Settings > Parts list), editable like any other. A part the owner already has (same name, any
-- capitals) is left alone. needs_position = the part comes in sides (the picker asks which; each side its own line).
insert into public.part_catalogue (category, name, needs_position, position, is_active)
select v.category, v.name, v.needs_position, 1000 + v.n, true
from (values
  ('Body', 'Bumper', true, 1),
  ('Body', 'Bumper grille', true, 2),
  ('Body', 'Radiator grille', false, 3),
  ('Body', 'Bonnet', false, 4),
  ('Body', 'Front wing / fender', true, 5),
  ('Body', 'Door', true, 6),
  ('Body', 'Tailgate / boot lid', false, 7),
  ('Body', 'Roof panel', false, 8),
  ('Body', 'Side skirt', true, 9),
  ('Body', 'Wheel arch liner', true, 10),
  ('Body', 'Mirror (complete)', true, 11),
  ('Body', 'Mirror housing', true, 12),
  ('Body', 'Mirror glass', true, 13),
  ('Body', 'Door handle', true, 14),
  ('Body', 'Spoiler', true, 15),
  ('Body', 'Badge / emblem', true, 16),
  ('Body', 'Mouldings and trims', true, 17),
  ('Body', 'Bumper bracket / reinforcement', true, 18),
  ('Body', 'Fog light cover', true, 19),
  ('Body', 'Tow hook cover', true, 20),
  ('Body', 'Washer jet', true, 21),
  ('Body', 'Number plate holder', true, 22),
  ('Body', 'Headlight', true, 23),
  ('Body', 'Tail light', true, 24),
  ('Body', 'Fog light', true, 25),
  ('Body', 'Indicator', true, 26),
  ('Body', 'Side repeater', true, 27),
  ('Body', 'Third brake light', false, 28),
  ('Glass', 'Windscreen', false, 29),
  ('Glass', 'Rear screen', false, 30),
  ('Glass', 'Door glass', true, 31),
  ('Glass', 'Quarter glass', true, 32),
  ('Glass', 'Sunroof / panoramic glass', false, 33),
  ('Interior', 'Seat', true, 34),
  ('Interior', 'Seat cover / upholstery', true, 35),
  ('Interior', 'Seat motor / switch', true, 36),
  ('Interior', 'Door card / trim', true, 37),
  ('Interior', 'Dashboard trim', false, 38),
  ('Interior', 'Steering wheel', false, 39),
  ('Interior', 'Centre console', false, 40),
  ('Interior', 'Carpet', true, 41),
  ('Interior', 'Headliner', false, 42),
  ('Interior', 'Seat belt', true, 43)
) as v(category, name, needs_position, n)
where not exists (select 1 from public.part_catalogue c where lower(c.name) = lower(v.name));
