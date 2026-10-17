-- 17 October 2026, D: delivery by recovery with the driver's one-button page, and the recovery log.
-- Drivers are saved once (Settings > Recovery or learned at gate-out); every pick-up or delivery is one trip row with
-- the pin, the driver's photo and his claimed price, checked on the Recovery page (Claimed -> Approved / Queried -> Paid).

create table if not exists public.recovery_drivers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  truck_plate  text,
  company      text,                           -- null = our truck
  is_default   boolean not null default false, -- the regular driver, prefilled
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.staff (id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff (id)
);
create index if not exists recovery_drivers_company_idx on public.recovery_drivers (company, is_active);
create trigger recovery_drivers_audit_columns before insert or update on public.recovery_drivers for each row execute function public.set_audit_columns();
create trigger recovery_drivers_audit after insert or update on public.recovery_drivers for each row execute function public.write_audit_log();
create trigger recovery_drivers_no_delete before delete on public.recovery_drivers for each row execute function public.prevent_delete();

create table if not exists public.recovery_trips (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid references public.jobs (id),
  kind             text not null default 'delivery' check (kind in ('delivery', 'pickup')),
  company          text,                        -- null = our truck
  driver_id        uuid references public.recovery_drivers (id),
  driver_name      text,
  driver_phone     text,
  truck_plate      text,
  location_url     text,
  location_details text,
  lat              double precision,
  lng              double precision,
  scheduled_date   date,
  scheduled_slot   text,                        -- morning / afternoon / evening / HH:MM
  token            text unique,                 -- the driver's one-button page (/drive/<token>), dead once used
  sent_at          timestamptz,                 -- "Send to driver" pressed
  loaded_at        timestamptz,                 -- "Car loaded: send 'on its way'"
  delivered_at     timestamptz,                 -- the driver's button (or the advisor's backup)
  photo_path       text,
  price_aed        numeric(10,2),
  price_at         timestamptz,
  status           text not null default 'open' check (status in ('open', 'claimed', 'approved', 'queried', 'paid')),
  decided_by       uuid references public.staff (id),
  decided_at       timestamptz,
  query_note       text,
  marked_by        uuid references public.staff (id),  -- the advisor's "Mark delivered"
  reminded_at      timestamptz,                 -- the once-only 3-hour reminder
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.staff (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.staff (id)
);
create index if not exists recovery_trips_job_idx on public.recovery_trips (job_id);
create index if not exists recovery_trips_status_idx on public.recovery_trips (status, created_at desc);
create trigger recovery_trips_audit_columns before insert or update on public.recovery_trips for each row execute function public.set_audit_columns();
create trigger recovery_trips_audit after insert or update on public.recovery_trips for each row execute function public.write_audit_log();
create trigger recovery_trips_no_delete before delete on public.recovery_trips for each row execute function public.prevent_delete();

insert into public.settings (key, value, label, description) values
  ('whatsapp_on_the_way_template',
   '"Dear [name], your [car] is now on its way to you on our recovery truck [truck plate]. Driver: [driver name], [driver mobile]. For anything else, call OFJ Automotive on +971 4 330 3113."'::jsonb,
   'WhatsApp: car on its way',
   'Sent by the advisor once the car is loaded. Blanks: [name], [car], [truck plate], [driver name], [driver mobile]. Driver details are allowed in this message only.'),
  ('workshop_location_pin', '""'::jsonb, 'Workshop location pin',
   'A Google Maps link to the workshop, used to show the rough distance of each recovery trip. Paste any maps link that contains the coordinates.')
on conflict (key) do nothing;
