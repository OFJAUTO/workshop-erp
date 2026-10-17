-- 17 October 2026, B1: break times per day of the week and per department (Settings > Breaks).
-- Saturday to Thursday: mechanical 12:30-13:30, bodyshop 13:30-14:30. Friday: both 12:30-14:00.
-- "" on a day means no break that day. The old break_mechanical/break_bodyshop keys stay as a fallback.
insert into public.settings (key, value, label, description) values
  ('break_times', '{
     "mechanical": { "sat": "12:30-13:30", "sun": "12:30-13:30", "mon": "12:30-13:30", "tue": "12:30-13:30", "wed": "12:30-13:30", "thu": "12:30-13:30", "fri": "12:30-14:00" },
     "bodyshop":   { "sat": "13:30-14:30", "sun": "13:30-14:30", "mon": "13:30-14:30", "tue": "13:30-14:30", "wed": "13:30-14:30", "thu": "13:30-14:30", "fri": "12:30-14:00" }
   }'::jsonb,
   'Breaks per day and department',
   'The break window per day of the week for each side; every clock pauses in it and labour cost, planning and due dates leave it out.')
on conflict (key) do nothing;
