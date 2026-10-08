-- Phase 4: quotations, estimates and parts pricing.
-- Quotations (Q-00001, with versions) and estimates (E-00001) share one table. Parts requests from the
-- inspection become exact part items that Parts price and the technician confirms. Customers answer
-- line by line on a public page. Declined work is kept against the car.

-- 1. Settings --------------------------------------------------------------------------------------
insert into public.settings (key, value, label, description) values
  ('labour_rate_aed', '350'::jsonb, 'Labour rate (AED per hour)', 'Used for every labour line unless a department rate is set.'),
  ('labour_rate_by_department', '{}'::jsonb, 'Labour rate per department', 'Optional: AED per hour per department.'),
  ('deposit_threshold_aed', '5000'::jsonb, 'Deposit threshold (AED)', 'When the parts on a quotation exceed this, a deposit is shown on the quote.'),
  ('deposit_percent', '50'::jsonb, 'Deposit (percent of parts)', 'The deposit asked for when parts exceed the threshold.'),
  ('quote_validity_days', '7'::jsonb, 'Quotation validity (days)', 'How long a quotation or estimate stays open.'),
  ('quote_owner_approval_above_aed', '0'::jsonb, 'Owner approval above (AED)', 'Quotations above this total need the owner before sending. 0 switches it off.'),
  ('parts_pricing_target_hours', '4'::jsonb, 'Parts pricing target (hours)', 'Working hours for Parts to price a request before it turns amber, red at double.'),
  ('quote_send_target_hours', '4'::jsonb, 'Quote sent after pricing (hours)', 'Working hours for the advisor to send once the parts are priced.'),
  ('estimate_followup_days', '2'::jsonb, 'Estimate follow-up (days)', 'Days after sending an estimate with no reply before the advisor is reminded.'),
  ('whatsapp_quote_template', to_jsonb('Dear [name], here is the quotation for your [make model] ([plate]): [link]. Please review the lines, approve what you would like us to do, and we will begin at once. Thank you, [advisor], OFJ Automotive'::text), 'WhatsApp quotation message', 'Placeholders: [name], [make model], [plate], [link], [advisor].'),
  ('whatsapp_estimate_template', to_jsonb('Dear [name], here is our estimate for your [make model] ([plate]): [link]. The final price is confirmed once the vehicle is with us. Thank you, [advisor], OFJ Automotive'::text), 'WhatsApp estimate message', 'Placeholders: [name], [make model], [plate], [link], [advisor].')
on conflict (key) do nothing;

-- 2. Fixed-price packages ------------------------------------------------------------------------
create table public.packages (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  department   text not null default 'both' check (department in ('mechanical', 'bodyshop', 'both')),
  price_aed    numeric(12,2) not null check (price_aed >= 0),
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.staff (id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff (id)
);
create trigger packages_audit_columns before insert or update on public.packages for each row execute function public.set_audit_columns();
create trigger packages_audit after insert or update on public.packages for each row execute function public.write_audit_log();
create trigger packages_no_delete before delete on public.packages for each row execute function public.prevent_delete();
alter table public.packages enable row level security;
create policy packages_read on public.packages for select to authenticated using (true);
create policy packages_insert on public.packages for insert to authenticated with check (public.has_role('owner'));
create policy packages_update on public.packages for update to authenticated using (public.has_role('owner')) with check (public.has_role('owner'));

-- 3. Parts requests (from the inspection) and exact part items -------------------------------------
create table public.part_requests (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id),
  inspection_id   uuid references public.inspections (id),
  source_type     text not null check (source_type in ('item', 'request', 'tyre', 'manual')),
  source_key      text not null,
  label           text not null,          -- the item, request or tyre it belongs to
  requested_text  text,                   -- what the technician wrote under "Parts needed"
  status          text not null default 'open' check (status in ('open', 'listed', 'done', 'rejected')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id),
  unique (job_id, source_type, source_key)
);
create index part_requests_job_idx on public.part_requests (job_id, status);
create trigger part_requests_audit_columns before insert or update on public.part_requests for each row execute function public.set_audit_columns();
create trigger part_requests_audit after insert or update on public.part_requests for each row execute function public.write_audit_log();
create trigger part_requests_no_delete before delete on public.part_requests for each row execute function public.prevent_delete();

create table public.part_items (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id),
  part_request_id    uuid references public.part_requests (id),
  part_number        text,
  description        text not null,
  quantity           numeric(10,2) not null default 1 check (quantity > 0),
  diagram_path       text,                 -- catalogue diagram image in the parts-diagrams bucket
  supplier           text,
  cost_aed           numeric(12,2) check (cost_aed is null or cost_aed >= 0),   -- before VAT
  availability       text check (availability is null or availability in ('in_stock', 'to_order')),
  delivery_date      date,
  priced_by          uuid references public.staff (id),
  priced_at          timestamptz,
  confirm_status     text not null default 'pending' check (confirm_status in ('pending', 'confirmed', 'rejected')),
  confirmed_quantity numeric(10,2),
  confirmed_by       uuid references public.staff (id),
  confirmed_at       timestamptz,
  reject_note        text,
  order_status       text not null default 'none' check (order_status in ('none', 'to_order', 'ordered', 'received')),
  added_by_role      text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);
create index part_items_job_idx on public.part_items (job_id, confirm_status);
create trigger part_items_audit_columns before insert or update on public.part_items for each row execute function public.set_audit_columns();
create trigger part_items_audit after insert or update on public.part_items for each row execute function public.write_audit_log();
create trigger part_items_no_delete before delete on public.part_items for each row execute function public.prevent_delete();

-- 4. Quotations and estimates ----------------------------------------------------------------------
create sequence if not exists public.quotation_number_seq start 1;
create sequence if not exists public.estimate_number_seq start 1;

create table public.quotations (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null default 'quotation' check (kind in ('quotation', 'estimate')),
  number                 text not null,
  version                integer not null default 1,
  parent_id              uuid references public.quotations (id),
  job_id                 uuid references public.jobs (id),
  customer_id            uuid not null references public.customers (id),
  vehicle_id             uuid references public.vehicles (id),
  estimate_id            uuid references public.quotations (id),
  status                 text not null default 'draft'
                         check (status in ('draft', 'pending_owner', 'sent', 'opened', 'approved', 'partly_approved', 'declined', 'expired', 'superseded', 'cancelled')),
  token                  text unique,
  discount_percent       numeric(5,2) not null default 0,
  vat_percent            numeric(5,2) not null default 5,
  subtotal_aed           numeric(12,2) not null default 0,
  discount_aed           numeric(12,2) not null default 0,
  vat_aed                numeric(12,2) not null default 0,
  total_aed              numeric(12,2) not null default 0,
  approved_total_aed     numeric(12,2),
  deposit_aed            numeric(12,2) not null default 0,
  promised_at            date,
  validity_days          integer not null default 7,
  valid_until            timestamptz,
  customer_note          text,
  owner_approval_reason  text,
  owner_approved_by      uuid references public.staff (id),
  owner_approved_at      timestamptz,
  sent_at                timestamptz,
  sent_by                uuid references public.staff (id),
  sent_method            text,
  opened_at              timestamptz,
  responded_at           timestamptz,
  approver_name          text,
  approver_phone         text,
  decline_reason         text,
  reminded_at            timestamptz,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid references public.staff (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.staff (id),
  unique (number, version)
);
create index quotations_job_idx on public.quotations (job_id, created_at desc);
create index quotations_customer_idx on public.quotations (customer_id, created_at desc);

create or replace function public.set_quotation_number() returns trigger language plpgsql as $$
begin
  if new.number is null or new.number = '' then
    if new.kind = 'estimate' then
      new.number := 'E-' || lpad(nextval('public.estimate_number_seq')::text, 5, '0');
    else
      new.number := 'Q-' || lpad(nextval('public.quotation_number_seq')::text, 5, '0');
    end if;
  end if;
  return new;
end $$;
create trigger quotations_number before insert on public.quotations for each row execute function public.set_quotation_number();
create trigger quotations_audit_columns before insert or update on public.quotations for each row execute function public.set_audit_columns();
create trigger quotations_audit after insert or update on public.quotations for each row execute function public.write_audit_log();
create trigger quotations_no_delete before delete on public.quotations for each row execute function public.prevent_delete();

create table public.quotation_lines (
  id                 uuid primary key default gen_random_uuid(),
  quotation_id       uuid not null references public.quotations (id),
  position           integer not null default 0,
  line_type          text not null check (line_type in ('labour', 'part', 'package', 'outside', 'fee')),
  title              text not null,
  details            text,
  group_label        text,
  source_type        text check (source_type is null or source_type in ('request', 'item', 'tyre', 'manual', 'estimate', 'package')),
  source_key         text,
  quantity           numeric(10,2) not null default 1 check (quantity > 0),
  unit_cost          numeric(12,2),
  markup_percent     numeric(6,2),
  unit_price         numeric(12,2),
  hours              numeric(6,2),
  labour_rate        numeric(10,2),
  discount_percent   numeric(5,2) not null default 0,
  line_total         numeric(12,2) not null default 0,
  part_item_id       uuid references public.part_items (id),
  package_id         uuid references public.packages (id),
  customer_approved  boolean,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);
create index quotation_lines_quotation_idx on public.quotation_lines (quotation_id, position);
create trigger quotation_lines_audit_columns before insert or update on public.quotation_lines for each row execute function public.set_audit_columns();
create trigger quotation_lines_audit after insert or update on public.quotation_lines for each row execute function public.write_audit_log();
create trigger quotation_lines_no_delete before delete on public.quotation_lines for each row execute function public.prevent_delete();

create table public.quotation_events (
  id            bigint generated always as identity primary key,
  quotation_id  uuid not null references public.quotations (id),
  job_id        uuid references public.jobs (id),
  event_type    text not null,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id)
);
create index quotation_events_idx on public.quotation_events (quotation_id, created_at desc);

-- Declined lines are kept against the car and shown at its next gate-in.
create table public.declined_work (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid references public.vehicles (id),
  customer_id   uuid not null references public.customers (id),
  job_id        uuid references public.jobs (id),
  quotation_id  uuid references public.quotations (id),
  title         text not null,
  details       text,
  amount_aed    numeric(12,2),
  declined_at   timestamptz not null default now(),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.staff (id)
);
create index declined_work_vehicle_idx on public.declined_work (vehicle_id, declined_at desc);
create trigger declined_work_audit_columns before insert or update on public.declined_work for each row execute function public.set_audit_columns();
create trigger declined_work_no_delete before delete on public.declined_work for each row execute function public.prevent_delete();

alter table public.jobs add column if not exists estimate_id uuid references public.quotations (id);
alter table public.jobs add column if not exists inspection_fee_due boolean not null default false;

-- 5. Who sees what (the database is the final word) ---------------------------------------------
-- The advisor of a job: who gated it in, or who sent its approval link, or who created the quotation.
create or replace function public.is_job_advisor(p_job uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j where j.id = p_job and j.gated_in_by = auth.uid())
      or exists (select 1 from public.approval_requests a where a.job_id = p_job and a.sent_by = auth.uid());
$$;
create or replace function public.can_see_quotation(p_quotation uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_staff_role()
    when 'owner' then true
    when 'accounts' then true
    when 'service_advisor' then exists (select 1 from public.quotations q where q.id = p_quotation and (q.created_by = auth.uid() or (q.job_id is not null and public.is_job_advisor(q.job_id))))
    else false end;
$$;
revoke all on function public.is_job_advisor(uuid), public.can_see_quotation(uuid) from public, anon;

alter table public.part_requests enable row level security;
alter table public.part_items enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_lines enable row level security;
alter table public.quotation_events enable row level security;
alter table public.declined_work enable row level security;
revoke all on public.part_requests, public.part_items, public.quotations, public.quotation_lines, public.quotation_events, public.declined_work from anon;

-- Parts, advisors, accounts, managers (their side) and the owner see requests and part items with costs. Technicians use the view below.
create policy part_requests_read on public.part_requests for select to authenticated
  using (public.has_role('owner', 'accounts', 'parts', 'service_advisor') or (public.has_role('workshop_manager') and public.can_see_job(job_id)));
create policy part_items_read on public.part_items for select to authenticated
  using (public.has_role('owner', 'accounts', 'parts', 'service_advisor') or (public.has_role('workshop_manager') and public.can_see_job(job_id)));
create policy part_requests_write on public.part_requests for insert to authenticated with check (public.has_role('owner', 'parts', 'service_advisor'));
create policy part_requests_update on public.part_requests for update to authenticated using (public.has_role('owner', 'parts', 'service_advisor')) with check (public.has_role('owner', 'parts', 'service_advisor'));
create policy part_items_write on public.part_items for insert to authenticated with check (public.has_role('owner', 'parts', 'service_advisor'));
create policy part_items_update on public.part_items for update to authenticated using (public.has_role('owner', 'parts', 'service_advisor')) with check (public.has_role('owner', 'parts', 'service_advisor'));

-- Technicians: the parts on their own cars, without any cost or supplier.
create or replace view public.part_items_technician with (security_invoker = false) as
  select p.id, p.job_id, p.part_request_id, p.part_number, p.description, p.quantity, p.diagram_path, p.availability, p.confirm_status, p.confirmed_quantity, p.reject_note, p.created_at,
         r.label as request_label, r.requested_text
  from public.part_items p
  left join public.part_requests r on r.id = p.part_request_id
  join public.jobs j on j.id = p.job_id
  where p.is_active and j.assigned_to = auth.uid();
revoke all on public.part_items_technician from public, anon;
grant select on public.part_items_technician to authenticated, service_role;

create policy quotations_read on public.quotations for select to authenticated using (public.can_see_quotation(id));
create policy quotation_lines_read on public.quotation_lines for select to authenticated using (public.can_see_quotation(quotation_id));
create policy quotation_events_read on public.quotation_events for select to authenticated using (public.can_see_quotation(quotation_id));
create policy quotations_insert on public.quotations for insert to authenticated with check (public.has_role('owner', 'service_advisor'));
create policy quotations_update on public.quotations for update to authenticated using (public.has_role('owner', 'service_advisor')) with check (public.has_role('owner', 'service_advisor'));
create policy quotation_lines_insert on public.quotation_lines for insert to authenticated with check (public.has_role('owner', 'service_advisor'));
create policy quotation_lines_update on public.quotation_lines for update to authenticated using (public.has_role('owner', 'service_advisor')) with check (public.has_role('owner', 'service_advisor'));

-- Workshop managers and technicians: the work lines of their cars, with hours but no prices.
create or replace view public.quotation_work_lines with (security_invoker = false) as
  select l.id, l.quotation_id, q.job_id, q.number, q.version, q.status, l.position, l.line_type, l.title, l.details, l.group_label, l.quantity, l.hours, l.customer_approved
  from public.quotation_lines l
  join public.quotations q on q.id = l.quotation_id
  join public.jobs j on j.id = q.job_id
  where l.is_active and q.is_active and l.line_type in ('labour', 'package', 'outside')
    and (public.has_role('owner', 'accounts', 'service_advisor') or (public.has_role('workshop_manager') and public.can_see_job(j.id)) or (public.has_role('technician') and j.assigned_to = auth.uid()));
revoke all on public.quotation_work_lines from public, anon;
grant select on public.quotation_work_lines to authenticated, service_role;

create policy declined_work_read on public.declined_work for select to authenticated using (not public.has_role('technician'));

-- 6. Files and live updates -----------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('parts-diagrams', 'parts-diagrams', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy parts_diagrams_read on storage.objects for select to authenticated using (bucket_id = 'parts-diagrams');

alter publication supabase_realtime add table public.quotations;
alter publication supabase_realtime add table public.part_items;
alter publication supabase_realtime add table public.part_requests;
