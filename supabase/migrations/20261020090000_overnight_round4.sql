-- Overnight build of 10 to 11 October 2026: services priced per unit, handover without scanning,
-- stickers, working time with breaks, device modes, loose items, owner's reports, inbound emails.

-- B1: fixed-price services carry what the price is per, the usual quantity and a time allowance.
alter table public.services add column if not exists price_per text not null default 'job';
alter table public.services add column if not exists usual_quantity integer not null default 1;
alter table public.services add column if not exists time_allowance_hours numeric(6,1);
alter table public.services add column if not exists includes_oil_change boolean not null default false;
alter table public.quotation_lines add column if not exists price_per text;

-- C: the handover is asked for by Parts and confirmed by the technician on his own device (or at the counter).
alter table public.part_handovers add column if not exists status text not null default 'confirmed';
alter table public.part_handovers drop constraint if exists part_handovers_status_check;
alter table public.part_handovers add constraint part_handovers_status_check check (status in ('pending', 'confirmed', 'cancelled'));
alter table public.part_handovers add column if not exists confirmed_at timestamptz;
alter table public.part_handovers add column if not exists device_id uuid references public.devices (id);
alter table public.part_handovers add column if not exists signed_at_counter boolean not null default false;
alter table public.part_handovers add column if not exists stickers jsonb not null default '{}'::jsonb;
alter table public.part_handovers add column if not exists stickers_printed_at timestamptz;
alter table public.part_items add column if not exists pending_handover_id uuid references public.part_handovers (id);
alter table public.part_items add column if not exists sticker_kind text;
alter table public.part_items drop constraint if exists part_items_sticker_kind_check;
alter table public.part_items add constraint part_items_sticker_kind_check check (sticker_kind is null or sticker_kind in ('part', 'battery'));
alter table public.part_items add column if not exists serial_number text;
alter table public.part_items add column if not exists stickers_printed integer not null default 0;
alter table public.part_items add column if not exists battery_model text;

-- D: short links behind every QR, battery warranties, the service sticker, next service on the car.
create table if not exists public.qr_links (
  code        text primary key,
  kind        text not null check (kind in ('part', 'battery', 'service', 'item')),
  job_id      uuid references public.jobs (id),
  vehicle_id  uuid references public.vehicles (id),
  ref_id      uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id)
);
alter table public.qr_links enable row level security;
drop policy if exists qr_links_read on public.qr_links;
create policy qr_links_read on public.qr_links for select to authenticated using (true);

create table if not exists public.battery_warranties (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id),
  vehicle_id      uuid not null references public.vehicles (id),
  part_item_id    uuid references public.part_items (id),
  handover_id     uuid references public.part_handovers (id),
  brand           text,
  model           text,
  serial_number   text,
  installed_on    date not null,
  warranty_until  date not null,
  qr_code         text references public.qr_links (code),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id)
);
alter table public.battery_warranties enable row level security;
drop policy if exists battery_warranties_read on public.battery_warranties;
create policy battery_warranties_read on public.battery_warranties for select to authenticated using (true);
drop trigger if exists battery_warranties_audit on public.battery_warranties;
create trigger battery_warranties_audit after insert or update on public.battery_warranties for each row execute function public.write_audit_log();
drop trigger if exists battery_warranties_no_delete on public.battery_warranties;
create trigger battery_warranties_no_delete before delete on public.battery_warranties for each row execute function public.prevent_delete();

alter table public.jobs add column if not exists service_sticker jsonb;
alter table public.vehicles add column if not exists next_service_date date;
alter table public.vehicles add column if not exists next_service_mileage integer;

-- E: working time with breaks, one clock per technician, device modes.
alter table public.staff add column if not exists break_start text;
alter table public.staff add column if not exists break_end text;
alter table public.work_sessions add column if not exists through_break boolean not null default false;
alter table public.devices add column if not exists blocked_at timestamptz;
alter table public.devices add column if not exists blocked_by uuid references public.staff (id);

-- G: loose items (a bumper or a part sent by another garage) on the same job card.
alter table public.jobs add column if not exists job_kind text not null default 'car';
alter table public.jobs drop constraint if exists jobs_job_kind_check;
alter table public.jobs add constraint jobs_job_kind_check check (job_kind in ('car', 'loose'));
alter table public.jobs add column if not exists assessment_note text;
alter table public.jobs add column if not exists brought_by text;
alter table public.vehicles add column if not exists kind text not null default 'car';
alter table public.vehicles drop constraint if exists vehicles_kind_check;
alter table public.vehicles add constraint vehicles_kind_check check (kind in ('car', 'loose'));
create table if not exists public.job_items (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.jobs (id),
  position              integer not null default 1,
  item_type             text not null,
  description           text,
  quantity              integer not null default 1,
  notes                 text,
  damage_note           text,
  qr_code               text references public.qr_links (code),
  collected_at          timestamptz,
  collected_by          uuid references public.staff (id),
  collector_name        text,
  collected_photo_path  text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.staff (id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.staff (id)
);
create index if not exists job_items_job_idx on public.job_items (job_id);
alter table public.job_items enable row level security;
drop policy if exists job_items_read on public.job_items;
create policy job_items_read on public.job_items for select to authenticated using (true);
drop trigger if exists job_items_audit on public.job_items;
create trigger job_items_audit after insert or update on public.job_items for each row execute function public.write_audit_log();
drop trigger if exists job_items_no_delete on public.job_items;
create trigger job_items_no_delete before delete on public.job_items for each row execute function public.prevent_delete();
alter table public.gate_in_media add column if not exists item_id uuid references public.job_items (id);
alter table public.gate_in_media drop constraint if exists gate_in_media_kind_check;
alter table public.gate_in_media add constraint gate_in_media_kind_check check (kind in ('video', 'video_exterior', 'video_interior', 'dashboard_photo', 'car_picture', 'keys_photo', 'keys_photo_front', 'keys_photo_back', 'damage_photo', 'gate_out_photo', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'item_photo', 'assessment_photo', 'item_collect_photo'));

-- H: the owner's report, kept on the job at gate-out.
alter table public.jobs add column if not exists owner_report jsonb;
alter table public.jobs add column if not exists owner_report_at timestamptz;

-- I: emails that are not scan reports are kept, not thrown away.
create table if not exists public.inbound_emails (
  id           uuid primary key default gen_random_uuid(),
  received_at  timestamptz not null default now(),
  from_email   text,
  subject      text,
  text_body    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.inbound_emails enable row level security;
drop policy if exists inbound_emails_read on public.inbound_emails;
create policy inbound_emails_read on public.inbound_emails for select to authenticated using (public.has_role('owner'));

-- Settings.
insert into public.settings (key, value, label, description) values
  ('part_labels_enabled', 'false'::jsonb, 'Tracking labels for boxes', 'Off: no label is made when parts arrive. A part that waits on a shelf can still get one from its Print label button.'),
  ('sticker_part_width_mm', '20'::jsonb, 'Part sticker width (mm)', 'The small sticker on a fitted part.'),
  ('sticker_part_height_mm', '20'::jsonb, 'Part sticker height (mm)', ''),
  ('sticker_large_mm', '60'::jsonb, 'Battery and service sticker size (mm)', 'Square stickers.'),
  ('sticker_part_types', '[]'::jsonb, 'Part types that get a sticker by default', 'The handover counter starts at the quantity for these part types; 0 for the others.'),
  ('sticker_battery_required', 'true'::jsonb, 'Battery warranty sticker required', 'The handover of a battery cannot finish without printing it.'),
  ('sticker_service_required', 'true'::jsonb, 'Oil service sticker required', 'Any job with an oil change shows "not printed yet" until it is, and QC checks it.'),
  ('battery_warranty_months', '12'::jsonb, 'Battery warranty (months)', ''),
  ('battery_warranty_by_brand', '{}'::jsonb, 'Battery warranty per brand (months)', 'For example {"Bosch": 24}.'),
  ('service_interval_months', '12'::jsonb, 'Next service after (months)', ''),
  ('service_interval_km', '10000'::jsonb, 'Next service after (km)', ''),
  ('service_interval_miles', '6000'::jsonb, 'Next service after (miles)', 'For cars recorded in miles.'),
  ('sticker_service_show_phone', 'true'::jsonb, 'Workshop phone on the service sticker', ''),
  ('sticker_logo_url', '""'::jsonb, 'Sticker logo', 'Empty: the standard logo file.'),
  ('sticker_wording', '{"part": "", "battery": "Battery warranty", "battery_valid": "Valid for this vehicle only", "service": "Service", "service_band": "Next service, whichever comes first"}'::jsonb, 'Sticker wording', ''),
  ('break_mechanical', '"12:30-13:30"'::jsonb, 'Break, mechanical', 'Start and end, 24-hour clock.'),
  ('break_bodyshop', '"13:30-14:30"'::jsonb, 'Break, bodyshop', ''),
  ('report_good_margin_percent', '25'::jsonb, 'Good car: margin at least (%)', 'The owner''s report calls a car good when its margin reaches this and it was on time.'),
  ('monthly_summary_sent_for', '""'::jsonb, 'Monthly summary last announced for', 'Set by the system.')
on conflict (key) do nothing;
update public.settings set value = '["mon", "tue", "wed", "thu", "fri", "sat"]'::jsonb where key = 'working_days';
update public.settings set value = '8'::jsonb where key = 'opening_hour';
update public.settings set value = '17'::jsonb where key = 'closing_hour';

-- Text tidiness for the new tables.
create or replace function public.erp_tidy_job_items() returns trigger language plpgsql as $$
begin
  new.description := public.erp_sentence_case(new.description);
  new.notes := public.erp_sentence_case(new.notes);
  new.damage_note := public.erp_sentence_case(new.damage_note);
  return new;
end $$;
drop trigger if exists job_items_tidy on public.job_items;
create trigger job_items_tidy before insert or update on public.job_items for each row execute function public.erp_tidy_job_items();
