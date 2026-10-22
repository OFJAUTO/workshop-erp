-- Evening batch of 21 October 2026, section 12: the invoice is the warranty card.
-- 1. The team leaders' warranty details per job and product (PPF roll/batch + areas, tint roll, ceramic product
--    and batch), entered at the end of their stage; QC confirms them complete before the car is Ready.
-- 2. The job's own warranty card address (QR on the tax invoice, the public page) and the QC confirmation.
-- 3. The 10-day check activates the warranty: reminders on day 8, 12 and 20 are recorded; the owner can activate
--    by hand with a note.
-- 4. Warranty terms per product (owner edits in Settings) and the "Your OFJ warranty card" message.

create table if not exists public.warranty_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  product text not null check (product in ('ppf', 'tint', 'ceramic')),
  -- Which item of that product (two ceramic items: exterior and interior); '' when the product has one row.
  item_key text not null default '',
  roll_batch text,
  product_name text,
  areas jsonb not null default '[]'::jsonb,
  stage_id uuid references public.bodyshop_stages(id),
  entered_by uuid references public.staff(id),
  entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create unique index if not exists warranty_entries_one_per_item on public.warranty_entries (job_id, product, item_key) where is_active;
create index if not exists warranty_entries_job on public.warranty_entries (job_id);

-- 1. RLS on; 2. staff who work with the warranty may read; writes go through server actions only;
-- 3. grants: the server (service_role) only - no screen reads this table with the user's own client.
alter table public.warranty_entries enable row level security;
create policy warranty_entries_read on public.warranty_entries
  for select to authenticated using (has_role('owner', 'service_advisor', 'workshop_manager', 'team_leader', 'accounts'));
grant all on public.warranty_entries to service_role;

create trigger warranty_entries_audit after insert or update on public.warranty_entries for each row execute function write_audit_log();
create trigger warranty_entries_nodel before delete on public.warranty_entries for each row execute function prevent_delete();
create trigger warranty_entries_stamp before insert or update on public.warranty_entries for each row execute function set_audit_columns();

alter table public.jobs add column if not exists warranty_token text;
create unique index if not exists jobs_warranty_token on public.jobs (warranty_token) where warranty_token is not null;
alter table public.jobs add column if not exists warranty_confirmed_at timestamptz;
alter table public.jobs add column if not exists warranty_confirmed_by uuid references public.staff(id);
alter table public.jobs add column if not exists warranty_card_sent_at timestamptz;

alter table public.aftercare_checks add column if not exists reminded_12_at timestamptz;
alter table public.aftercare_checks add column if not exists reminded_20_at timestamptz;
alter table public.aftercare_checks add column if not exists activated_at timestamptz;
alter table public.aftercare_checks add column if not exists activated_by uuid references public.staff(id);
alter table public.aftercare_checks add column if not exists activation_note text;

insert into public.settings (key, label, value) values
  ('warranty_terms', 'Warranty terms per product (owner)', jsonb_build_object(
    -- PPF keeps the owner's existing wording and years (Settings > Bodyshop) as its starting point.
    'ppf', jsonb_build_object('months', coalesce((select (value #>> '{}')::int * 12 from public.settings where key = 'ppf_warranty_years'), 120),
      'short', 'Covers the film against yellowing, cracking, bubbling and peeling caused by a defect in the film or its installation. Keep the 10-day after-care check to activate it.',
      'full', coalesce(nullif((select value #>> '{}' from public.settings where key = 'ppf_warranty_text'), ''), 'The paint protection film is guaranteed against yellowing, cracking, bubbling, blistering and peeling caused by a defect in the film or in its installation, for the period shown from the handover date. The warranty is activated by the complimentary 10-day after-care check. It does not cover damage from accidents, stone chips that cut through the film, improper washing, chemical spills, or film removed or repaired by anyone other than OFJ Automotive.')),
    'tint', jsonb_build_object('months', 60,
      'short', 'Covers the tint against bubbling, peeling, cracking and colour change caused by a defect in the film or its installation.',
      'full', 'The window tint is guaranteed against bubbling, peeling, cracking, delamination and colour change caused by a defect in the film or in its installation, for the period shown from the handover date. Do not open the windows for 3 days after fitting and do not clean the inside of the glass for 7 days. It does not cover scratches, damage from sharp objects, seat belts or stickers, or film removed or repaired by anyone other than OFJ Automotive. Darkness chosen above the legal limit is the customer''s own request and responsibility.'),
    'ceramic', jsonb_build_object('months', 24,
      'short', 'Covers the coating''s gloss and water repellence when the car is washed as advised and the care visits are kept.',
      'full', 'The ceramic coating is guaranteed to keep its gloss and water repellence for the period shown from the handover date when the car is washed with pH-neutral shampoo, never machine-polished, and brought in for the advised care visits. It does not cover damage from accidents, scratches, chemical spills, bird droppings or tree sap left on the surface, or the coating being polished or treated by anyone other than OFJ Automotive.'),
    'mechanical', jsonb_build_object('months', 6,
      'short', 'Covers our workmanship on the work listed on this invoice.',
      'full', 'Our workmanship on the work listed on this invoice is guaranteed for the period shown from the handover date. Parts carry their own manufacturer warranty. The warranty does not cover wear and tear, damage from accidents or misuse, or work done on the car by anyone else after the handover. A claim needs this invoice; we inspect the car and put right any fault in our workmanship free of charge.')
  )),
  ('whatsapp_warranty_card_template', 'WhatsApp: your OFJ warranty card', to_jsonb('Hello [name], your OFJ warranty card for the [make model] ([plate]): [link]. It shows what is covered and until when. Please book your 10-day after-care check to activate it. OFJ Automotive'::text)),
  ('whatsapp_aftercare_reminder_template', 'WhatsApp: 10-day check reminder', to_jsonb('Hello [name], a reminder to book the complimentary after-care check for your [make model] ([plate]). It activates your OFJ warranty: [link]. OFJ Automotive'::text)),
  ('ceramic_products_used', 'Ceramic products used (one-tap suggestions)', '[]'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
