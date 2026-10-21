-- Section 5 (21 October 2026): the OFJ Platinum package seeded next to the existing one.
-- One price, the include list on the documents, complimentary pick-up & drop-off (two trips are
-- created at approval) and the complimentary 10-day after-care check (booked at gate-out).
update public.settings
set value = value || '[{
  "key": "ofj_platinum",
  "name": "OFJ Platinum",
  "time_in_workshop": "5-7 working days",
  "pickup_dropoff": true,
  "aftercare_check": true,
  "items": [
    { "label": "PPF full exterior", "warranty": "10-year warranty", "only_if": null },
    { "label": "PPF interior (screens & trims)", "warranty": null, "only_if": null },
    { "label": "Ceramic heat-rejection tint - sides & rear", "warranty": "5-year warranty", "only_if": null },
    { "label": "Windshield film", "warranty": "5-year warranty", "only_if": null },
    { "label": "Panoramic roof tint", "warranty": "5-year warranty", "only_if": "the car has a sunroof or panoramic roof" },
    { "label": "Ceramic coating for PPF", "warranty": null, "only_if": null },
    { "label": "Ceramic interior leather", "warranty": null, "only_if": null },
    { "label": "Detailing & polishing - PPF prep", "warranty": null, "only_if": null },
    { "label": "Complimentary pick-up & drop-off", "warranty": null, "only_if": null },
    { "label": "Complimentary 10-day check", "warranty": null, "only_if": null }
  ]
}]'::jsonb
where key = 'bodyshop_packages' and value::text not like '%ofj_platinum%';

insert into public.settings (key, value, label)
select 'bodyshop_packages', '[]'::jsonb, 'Bodyshop packages'
where not exists (select 1 from public.settings where key = 'bodyshop_packages');

notify pgrst, 'reload schema';
