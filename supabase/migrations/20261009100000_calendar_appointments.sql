-- Calendar: appointments booked by advisors, the workshop manager and the owner. Everyone can view.

create table public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references public.customers (id),
  vehicle_id            uuid references public.vehicles (id),
  vehicle_text          text,                                   -- a car not in the system yet
  reason                text not null,
  starts_at             timestamptz not null,
  duration_minutes      integer not null default 60 check (duration_minutes between 15 and 480),
  advisor_id            uuid references public.staff (id),
  status                text not null default 'booked' check (status in ('booked', 'arrived', 'no_show', 'cancelled')),
  job_id                uuid references public.jobs (id),       -- set when gate-in starts from the appointment
  notes                 text,
  cancel_reason         text,
  reminder_sent_at      timestamptz,                            -- WhatsApp reminder marked as sent
  reminder_sent_by      uuid references public.staff (id),
  reminder_notified_at  timestamptz,                            -- the advisor was told to send the reminder
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.staff (id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.staff (id)
);
create index appointments_starts_idx on public.appointments (starts_at);
create index appointments_customer_idx on public.appointments (customer_id);

create trigger appointments_audit_columns before insert or update on public.appointments
  for each row execute function public.set_audit_columns();
create trigger appointments_audit after insert or update on public.appointments
  for each row execute function public.write_audit_log();
create trigger appointments_no_delete before delete on public.appointments
  for each row execute function public.prevent_delete();

alter table public.appointments enable row level security;
create policy appointments_read on public.appointments for select to authenticated using (true);
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy appointments_update on public.appointments for update to authenticated
  using (public.has_role('owner', 'workshop_manager', 'service_advisor'))
  with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));

alter publication supabase_realtime add table public.appointments;

-- Settings used by the calendar (the settings page updates existing rows only).
insert into public.settings (key, value, label, description) values
  ('appointments_per_day', '8'::jsonb, 'Appointments per day', 'How many appointments count as a full day on the calendar.'),
  ('whatsapp_reminder_template', to_jsonb('Dear [name], a reminder of your appointment at OFJ Automotive tomorrow, [date] at [time], for [reason]. Please reply to confirm. Thank you, [advisor], OFJ Automotive'::text), 'WhatsApp appointment reminder', 'Placeholders: [name], [date], [time], [reason], [car], [advisor].')
on conflict (key) do nothing;
