-- Evening list of 12 October 2026, part 2.

-- 3 and 5: paired parts and "goes with" offers in the parts pool.
alter table public.part_catalogue add column if not exists paired boolean not null default false;
alter table public.part_catalogue add column if not exists goes_with text[] not null default '{}';
update public.part_catalogue set paired = true
  where is_active and name in ('Lower control arm', 'Upper control arm', 'Control arm bushing', 'Shock absorber', 'Shock mount', 'Air suspension strut', 'Air spring', 'Coil spring', 'Stabiliser link', 'Stabiliser bar bushing', 'Tie rod end', 'Inner tie rod', 'Wheel bearing', 'CV boot', 'Brake disc', 'Headlight');
-- The brake pad wear sensor is a part per axle (Front / Rear), never a checklist item.
update public.part_catalogue set unit = 'set', needs_position = true where is_active and name = 'Brake pad wear sensor';
update public.part_catalogue set goes_with = array['Brake pad wear sensor'] where is_active and name in ('Brake pads', 'Brake disc') and goes_with = '{}';
update public.part_catalogue set goes_with = array['Gasket', 'Coolant'] where is_active and name = 'Water pump' and goes_with = '{}';
update public.part_catalogue set goes_with = array['Drain plug and washer'] where is_active and name in ('Engine oil', 'Oil filter') and goes_with = '{}';
update public.part_catalogue set goes_with = array['Ignition coil'] where is_active and name = 'Spark plug' and goes_with = '{}';
update public.part_catalogue set goes_with = array['Compressor oil', 'Receiver drier'] where is_active and name = 'A/C compressor' and goes_with = '{}';

-- 8: recovery, who pays.
alter table public.quotation_lines add column if not exists recovery_paid_by text check (recovery_paid_by in ('us', 'customer'));
alter table public.quotation_lines add column if not exists recovery_mention_free boolean not null default false;
update public.quotation_lines set recovery_paid_by = case when visible_to_customer = false then 'us' else 'customer' end where line_type = 'recovery' and recovery_paid_by is null;

-- 10: parts and requests removed as not needed (kept, greyed, with Put back).
alter table public.part_items add column if not exists removed_at timestamptz, add column if not exists removed_by uuid references public.staff(id), add column if not exists removed_reason text;
alter table public.part_requests add column if not exists removed_at timestamptz, add column if not exists removed_by uuid references public.staff(id), add column if not exists removed_reason text;

-- 11: supplier discounts above the owner's limit wait for approval; every change of a standard is logged.
alter table public.part_items add column if not exists discount_approval_status text check (discount_approval_status in ('pending', 'approved', 'refused')),
  add column if not exists discount_approval_at timestamptz,
  add column if not exists discount_approval_by uuid references public.staff(id),
  add column if not exists discount_approval_note text;
create table if not exists public.supplier_discount_changes (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  part_type text,
  from_percent numeric(6,2),
  to_percent numeric(6,2) not null,
  applied_lines integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id)
);
alter table public.supplier_discount_changes enable row level security;
drop policy if exists supplier_discount_changes_read on public.supplier_discount_changes;
create policy supplier_discount_changes_read on public.supplier_discount_changes for select to authenticated using (true);
drop trigger if exists supplier_discount_changes_audit on public.supplier_discount_changes;
create trigger supplier_discount_changes_audit after insert or update on public.supplier_discount_changes for each row execute function public.write_audit_log();
drop trigger if exists supplier_discount_changes_no_delete on public.supplier_discount_changes;
create trigger supplier_discount_changes_no_delete before delete on public.supplier_discount_changes for each row execute function public.prevent_delete();
update public.suppliers set default_discount_percent = 55 where is_active and name ilike 'gargash%' and coalesce(default_discount_percent, 0) = 0;

-- 9: which "not sent" reminders the hourly job has already sent for a job.
alter table public.jobs add column if not exists doc_reminders jsonb not null default '{}'::jsonb;

-- U1 follow-up: a row of the Parts table saves itself under one key, so two quick saves never make two parts.
alter table public.part_items add column if not exists client_key text;
create index if not exists part_items_client_key_idx on public.part_items (job_id, client_key) where client_key is not null;

-- New settings rows (the form only updates rows that exist).
insert into public.settings (key, value, label, description) values
  ('tyre_brands', '["Michelin","Pirelli","Continental","Bridgestone","Goodyear","Dunlop","Yokohama","Hankook","Toyo","Falken","Kumho","BFGoodrich","Nexen","Other"]'::jsonb, 'Tyre brands', 'The brand list on the tyre boxes of the inspection; anything else can be typed.'),
  ('tyre_brand_custom', '{}'::jsonb, 'Tyre brands typed', 'Brands typed on reports more than once, offered to the owner to add.'),
  ('road_test_chips', '{}'::jsonb, 'Road test one-tap remarks', 'Per road test item: rows of chips (what, where, when) that write the remark.'),
  ('road_test_chip_usage', '{}'::jsonb, 'Road test chip usage', 'How often each chip was tapped; most used come first.'),
  ('reason_presets', '{}'::jsonb, 'One-tap reasons', 'The reasons offered wherever the system asks why, per place.'),
  ('doc_reminder_limits', '{}'::jsonb, 'Documents not sent: limits', 'Working minutes before a document not sent turns amber, then red with a reminder to the advisor.'),
  ('supplier_discount_approval_above_percent', '70'::jsonb, 'Supplier discount needing owner approval above (%)', 'A part priced with a supplier discount above this waits for the owner.')
on conflict (key) do nothing;
