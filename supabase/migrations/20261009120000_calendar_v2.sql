-- Calendar v2: booking types, collection details, a colour per person, who may change what, reminder stamps.

alter table public.appointments
  add column if not exists kind text not null default 'customer_visit'
    check (kind in ('customer_visit', 'car_drop', 'we_collect', 'customer_collects')),
  add column if not exists collect_address text,
  add column if not exists collect_method text
    check (collect_method is null or collect_method in ('our_recovery', 'outside_recovery', 'our_driver')),
  add column if not exists notified_hour_before_at timestamptz,
  add column if not exists notified_evening_before_at timestamptz,
  add column if not exists missed_notified_at timestamptz;

alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('booked', 'arrived', 'done', 'no_show', 'cancelled'));
alter table public.appointments alter column duration_minutes set default 30;

-- A colour per person for the shared calendar; the owner assigns it on the Team page.
alter table public.staff add column if not exists colour text
  check (colour is null or colour ~ '^#[0-9a-f]{6}$');

-- Only service advisors and the owner book. An advisor may change only their own bookings; the owner any.
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.has_role('owner', 'service_advisor'));
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated
  using (public.has_role('owner') or (public.has_role('service_advisor') and (advisor_id = auth.uid() or created_by = auth.uid())))
  with check (public.has_role('owner') or (public.has_role('service_advisor') and (advisor_id = auth.uid() or created_by = auth.uid())));

-- Reminder settings and the WhatsApp wording per booking type (the settings page updates existing rows only).
insert into public.settings (key, value, label, description) values
  ('appointment_reminder_hours_before', '1'::jsonb, 'Booking reminder (hours before)', 'The assigned person gets a bell notification this many hours before a booking (checked hourly).'),
  ('appointment_evening_reminder_hour', '18'::jsonb, 'Evening reminder hour for collections', 'For "We collect the car": the assigned person is also told the evening before, from this hour.'),
  ('appointment_missed_after_minutes', '30'::jsonb, 'Booking counts as missed after (minutes)', 'A booking with nothing recorded this long after its time shows as Not arrived or Not collected and notifies the assigned person.'),
  ('whatsapp_reminder_car_drop', to_jsonb('Dear [name], a reminder that your [car] is booked to be dropped at OFJ Automotive tomorrow, [date] at [time], for [reason]. Please reply to confirm. Thank you, [advisor], OFJ Automotive'::text), 'WhatsApp reminder: car drop-off', 'Placeholders: [name], [date], [time], [reason], [car], [advisor].'),
  ('whatsapp_reminder_we_collect', to_jsonb('Dear [name], a reminder that OFJ Automotive will collect your [car] tomorrow, [date] at [time], from [address], for [reason]. Please have the keys ready. Thank you, [advisor], OFJ Automotive'::text), 'WhatsApp reminder: we collect the car', 'Placeholders: [name], [date], [time], [reason], [car], [address], [advisor].'),
  ('whatsapp_reminder_customer_collects', to_jsonb('Dear [name], your [car] is ready for collection at OFJ Automotive tomorrow, [date] at [time]. Thank you, [advisor], OFJ Automotive'::text), 'WhatsApp reminder: customer collects', 'Placeholders: [name], [date], [time], [car], [advisor].')
on conflict (key) do nothing;
