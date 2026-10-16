-- 16 October 2026, section B (staff review fixes): gate-in photos and videos can be taken off (anyone doing the
-- gate-in while it is open, only the owner once it is finished; marked, never deleted), the gate-out remembers the
-- collecting person's phone and the saved driver, the recovery driver, and the recovery companies live in Settings.
alter table public.gate_in_media
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.staff(id);

alter table public.gate_outs
  add column if not exists collector_phone text,
  add column if not exists collector_contact_id uuid references public.customer_contacts(id),
  add column if not exists delivery_driver text;

insert into public.settings (key, value, label, description)
values ('recovery_companies', '[]'::jsonb, 'Recovery companies', 'Outside recovery companies offered as one-tap choices at gate-out; a company typed there is added to the list.')
on conflict (key) do nothing;
