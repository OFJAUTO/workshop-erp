-- Inspection fee: optional, the advisor sets the amount (30 October 2026). Replaces the single fixed fee setting.
--
-- jobs.inspection_fee_choice: 'fee' (inspection_fee_aed, before VAT) or 'none' (no_fee_reason / no_fee_note).
--   Null = a job from before this change: it keeps the fee it was approved with (inspection_fee_aed).
-- jobs.inspection_type: 'full' or 'quick' (no fee only): a quick job skips the Inspection stage, straight to the quotation.
-- approval_requests.no_fee: the customer's approval page then mentions no fee at all.
-- Settings: the minimum and maximum an advisor may set (the owner's), and the customer's wording with VAT.
-- jobs has column-level select grants for the login role (customer privacy, 29 October): the new columns get theirs.

alter table public.jobs add column if not exists inspection_fee_choice text;
alter table public.jobs add column if not exists no_fee_reason text;
alter table public.jobs add column if not exists no_fee_note text;
alter table public.jobs add column if not exists inspection_type text not null default 'full';
alter table public.jobs add column if not exists fee_set_by uuid;
alter table public.jobs add column if not exists fee_set_at timestamptz;
do $$ begin
  alter table public.jobs add constraint jobs_inspection_fee_choice_check check (inspection_fee_choice is null or inspection_fee_choice in ('fee', 'none'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.jobs add constraint jobs_inspection_type_check check (inspection_type in ('full', 'quick'));
exception when duplicate_object then null; end $$;
grant select (inspection_fee_choice, no_fee_reason, no_fee_note, inspection_type, fee_set_by, fee_set_at) on public.jobs to authenticated;

alter table public.approval_requests add column if not exists no_fee boolean not null default false;

insert into public.settings (key, value, label, description) values
  ('inspection_fee_min_aed', '500', 'Inspection fee: lowest an advisor can set (AED, before VAT)', 'The advisor types any amount from the lowest to the highest; only the owner goes outside it.'),
  ('inspection_fee_max_aed', '2500', 'Inspection fee: highest an advisor can set (AED, before VAT)', 'The advisor types any amount from the lowest to the highest; only the owner goes outside it.')
on conflict (key) do nothing;

-- The customer's wording with VAT, unless the owner already changed it: [total] with VAT, [amount] before VAT.
update public.settings set value = to_jsonb('If no work is approved after the inspection, an inspection fee of AED [total] including VAT (AED [amount] + VAT) will apply.'::text)
where key = 'inspection_fee_notice' and value = to_jsonb('If no work is approved after the inspection, an inspection fee of AED [amount] will apply.'::text);
update public.settings set value = to_jsonb('في حال عدم الموافقة على أي أعمال بعد الفحص، تُطبَّق رسوم فحص بقيمة [total] درهمًا شاملة ضريبة القيمة المضافة ([amount] درهمًا + الضريبة).'::text)
where key = 'inspection_fee_notice_ar' and value = to_jsonb('في حال عدم الموافقة على أي أعمال بعد الفحص، تُطبَّق رسوم فحص بقيمة [amount] درهمًا.'::text);

notify pgrst, 'reload schema';
