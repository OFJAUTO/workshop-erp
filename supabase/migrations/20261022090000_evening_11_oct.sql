-- Evening list of 11 October 2026: customer links as short first pages, payment links that open once,
-- the parts list tick, parts sold per set, the Parts pricing screen, parts that are left off, exchanged,
-- not needed or not received, recovery types, and the manager's note groups.

-- A3. The customer's quotation: whether the full document was opened before approving; an advisor's decline.
alter table public.quotations add column if not exists viewed_full_at timestamptz;
alter table public.quotations add column if not exists declined_by uuid references public.staff (id);
-- D5. A price change after the quotation was sent is flagged on it.
alter table public.quotations add column if not exists parts_price_changed_at timestamptz;

-- E7. A part left off this quotation stays on the car's list, greyed and not ordered. E10. The recovery type.
alter table public.quotation_lines add column if not exists left_off boolean not null default false;
alter table public.quotation_lines add column if not exists recovery_type text;
alter table public.gate_ins add column if not exists recovery_type text;

-- D5. "Pricing done" on the Parts screen.
alter table public.jobs add column if not exists parts_pricing_done_at timestamptz;
alter table public.jobs add column if not exists parts_pricing_done_by uuid references public.staff (id);

-- C1. Bad items the technician says need no part.
alter table public.inspections add column if not exists no_part_items jsonb not null default '[]'::jsonb;

-- C3. Parts sold per set (brake pads, brake shoes, wiper blades, spark plugs): the choice is Front / Rear and the quantity counts sets.
alter table public.part_catalogue add column if not exists unit text not null default 'each';
alter table public.part_catalogue drop constraint if exists part_catalogue_unit_check;
alter table public.part_catalogue add constraint part_catalogue_unit_check check (unit in ('each', 'set'));
update public.part_catalogue set unit = 'set' where unit <> 'set' and lower(name) in ('brake pads', 'parking brake shoe', 'brake shoes', 'wiper blade', 'wiper blades', 'spark plug', 'spark plugs');

-- F1, F5, F6, F7. Every part is in exactly one state: received by the technician line by line, exchanges, not needed, dispositions.
alter table public.part_items add column if not exists tech_received_qty numeric not null default 0;
alter table public.part_items add column if not exists not_received_at timestamptz;
alter table public.part_items add column if not exists exchange_status text not null default 'none';
alter table public.part_items add column if not exists exchange_reason text;
alter table public.part_items add column if not exists exchange_note text;
alter table public.part_items add column if not exists exchange_at timestamptz;
alter table public.part_items add column if not exists exchange_by uuid references public.staff (id);
alter table public.part_items add column if not exists replacement_part_id uuid references public.part_items (id);
alter table public.part_items add column if not exists replaced_part_id uuid references public.part_items (id);
alter table public.part_items add column if not exists not_needed_at timestamptz;
alter table public.part_items add column if not exists not_needed_by uuid references public.staff (id);
alter table public.part_items add column if not exists not_needed_reason text;
alter table public.part_items add column if not exists disposition text;
alter table public.part_items add column if not exists disposition_at timestamptz;
alter table public.part_items add column if not exists disposition_by uuid references public.staff (id);
alter table public.part_items add column if not exists disposition_note text;
alter table public.part_items add column if not exists credit_note_path text;
alter table public.part_items add column if not exists goodwill_cost_aed numeric;
alter table public.part_items add column if not exists goodwill_by uuid references public.staff (id);
alter table public.part_items add column if not exists goodwill_at timestamptz;
alter table public.part_items add column if not exists no_home_notified_at timestamptz;
alter table public.part_items drop constraint if exists part_items_exchange_status_check;
alter table public.part_items add constraint part_items_exchange_status_check check (exchange_status in ('none', 'needed', 'ordered', 'done'));
alter table public.part_items drop constraint if exists part_items_exchange_reason_check;
alter table public.part_items add constraint part_items_exchange_reason_check check (exchange_reason is null or exchange_reason in ('wrong_part', 'damaged', 'does_not_fit', 'faulty'));
alter table public.part_items drop constraint if exists part_items_disposition_check;
alter table public.part_items add constraint part_items_disposition_check check (disposition is null or disposition in ('returned', 'stock', 'fit_pending', 'fit_approved'));
-- Parts handed over so far count as received by the technician.
update public.part_items set tech_received_qty = coalesce(issued_qty, confirmed_quantity, quantity) where issue_status = 'confirmed' and tech_received_qty = 0;

-- A9. Payment links: pasted by the advisor, opened once by the customer. The system never opens them itself.
create table if not exists public.payment_links (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid references public.jobs (id),
  invoice_id      uuid not null references public.invoices (id),
  url             text not null,
  added_by        uuid references public.staff (id),
  added_at        timestamptz not null default now(),
  opened_at       timestamptz,
  replaced_at     timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id)
);
create index if not exists payment_links_invoice_idx on public.payment_links (invoice_id);
alter table public.payment_links enable row level security;
drop policy if exists payment_links_read on public.payment_links;
create policy payment_links_read on public.payment_links for select to authenticated using (true);
drop trigger if exists payment_links_audit on public.payment_links;
create trigger payment_links_audit after insert or update on public.payment_links for each row execute function public.write_audit_log();
drop trigger if exists payment_links_no_delete on public.payment_links;
create trigger payment_links_no_delete before delete on public.payment_links for each row execute function public.prevent_delete();
-- Links pasted before tonight become the first row of the history.
insert into public.payment_links (job_id, invoice_id, url, added_by, added_at)
select i.job_id, i.id, i.payment_link_url, i.updated_by, i.updated_at from public.invoices i
where i.payment_link_url is not null and i.payment_link_url <> '' and not exists (select 1 from public.payment_links p where p.invoice_id = i.id);

-- Settings: the supplier list's opening line, the recovery types with their usual cost and price, the manager's note groups.
insert into public.settings (key, value, label, description) values
  ('supplier_quote_opening_line', '"Please quote price and availability:"'::jsonb, 'Supplier list opening line', 'The first line of the parts list copied for a supplier.'),
  ('recovery_types', '[{"key": "normal", "label": "Normal", "cost": 150, "price": 150}, {"key": "full_down", "label": "Full down", "cost": 250, "price": 250}, {"key": "closed_box", "label": "Closed box", "cost": 400, "price": 400}]'::jsonb, 'Recovery types', 'The recovery truck types with their usual cost and price per trip.'),
  ('manager_note_groups', '{"About the report": ["Report checked and accurate.", "Report checked. Findings confirmed on the car.", "Report corrected by the workshop manager."], "Urgency": ["All listed items should be done together.", "Urgent items should be done before the car is driven further.", "Recommended items can wait until the next service.", "Vehicle is safe to drive. No urgent work found.", "Vehicle is not safe to drive until the urgent items are repaired."], "The job": ["Further diagnosis is needed to confirm the cause.", "Parts must be ordered. Timing depends on delivery.", "Engine or transmission removal is required for this repair.", "Outside work is required for part of this job.", "Additional faults may be found once work starts."], "The car": ["Vehicle is in good overall condition.", "Vehicle shows signs of previous repair work.", "Vehicle shows signs of poor previous maintenance."]}'::jsonb, 'Manager note groups', 'The one-tap notes on the report approval, under four small headings.')
on conflict (key) do nothing;
