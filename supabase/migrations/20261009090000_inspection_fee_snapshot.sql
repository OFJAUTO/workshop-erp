-- Inspection fee notice shown on the approval page; the wording and amount are saved with each approval, like the terms.
alter table public.approval_requests
  add column if not exists inspection_fee_aed numeric(10,2),
  add column if not exists inspection_fee_notice text,
  add column if not exists inspection_fee_notice_ar text;

-- New settings (the settings page updates existing rows only).
insert into public.settings (key, value, label, description) values
  ('inspection_fee_aed', '750'::jsonb, 'Inspection fee (AED)', 'Charged when no work is approved after the inspection.'),
  ('inspection_fee_notice', to_jsonb('If no work is approved after the inspection, an inspection fee of AED [amount] will apply.'::text), 'Inspection fee notice (English)', 'Shown above the tick box on the approval page; [amount] is replaced by the fee.'),
  ('inspection_fee_notice_ar', to_jsonb('في حال عدم الموافقة على أي أعمال بعد الفحص، تُطبَّق رسوم فحص بقيمة [amount] درهمًا.'::text), 'Inspection fee notice (Arabic)', 'Arabic version of the notice.'),
  ('opening_hour', '8'::jsonb, 'Opening hour', 'Stage timers count working hours only, from this hour.'),
  ('closing_hour', '17'::jsonb, 'Closing hour', 'Stage timers stop counting at this hour.')
on conflict (key) do nothing;
