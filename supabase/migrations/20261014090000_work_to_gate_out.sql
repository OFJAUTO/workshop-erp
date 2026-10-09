-- The rest of the mechanical path, 9 October 2026: parts ordering (purchase orders, receiving,
-- supplier invoices, labels, issue with PIN, returns, consumables stock), work (work orders, job
-- clock, shifts, additional work), QC, wash, invoices and payments, gate-out with delivery, and
-- the company details for documents.

-- 1. Numbering ----------------------------------------------------------------------------------
create sequence if not exists public.po_number_seq;
create sequence if not exists public.invoice_number_seq;
create sequence if not exists public.proforma_number_seq;
create sequence if not exists public.credit_note_number_seq;
create sequence if not exists public.receipt_number_seq;

-- 2. Suppliers and purchase orders ---------------------------------------------------------------
create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id)
);
create unique index suppliers_name_idx on public.suppliers (lower(name));

create table public.purchase_orders (
  id                       uuid primary key default gen_random_uuid(),
  number                   text not null unique default ('PO-' || lpad(nextval('public.po_number_seq')::text, 5, '0')),
  job_id                   uuid not null references public.jobs (id),
  supplier_id              uuid references public.suppliers (id),
  supplier_name            text not null,
  status                   text not null default 'pending_approval'
                           check (status in ('pending_approval', 'approved', 'ordered', 'partly_received', 'received', 'cancelled')),
  notes                    text,
  total_cost_aed           numeric(12,2) not null default 0,
  approved_by              uuid references public.staff (id),
  approved_at              timestamptz,
  deposit_override_by      uuid references public.staff (id),
  deposit_override_reason  text,
  ordered_at               timestamptz,
  ordered_by               uuid references public.staff (id),
  received_at              timestamptz,
  supplier_invoice_status  text not null default 'none' check (supplier_invoice_status in ('none', 'to_follow', 'received')),
  supplier_invoice_number  text,
  supplier_invoice_path    text,
  supplier_invoice_amount  numeric(12,2),
  supplier_invoice_at      timestamptz,
  supplier_invoice_by      uuid references public.staff (id),
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  created_by               uuid references public.staff (id),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.staff (id)
);
create index purchase_orders_job_idx on public.purchase_orders (job_id, created_at desc);
create index purchase_orders_status_idx on public.purchase_orders (status);

create table public.purchase_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  po_id              uuid not null references public.purchase_orders (id),
  part_item_id       uuid not null references public.part_items (id),
  position           integer not null default 0,
  description        text not null,
  part_number        text,
  quantity           numeric(10,2) not null check (quantity > 0),
  unit_cost          numeric(12,2) not null default 0,
  expected_date      date,
  received_qty       numeric(10,2) not null default 0,
  received_at        timestamptz,
  flag               text check (flag is null or flag in ('wrong', 'damaged')),
  flag_note          text,
  invoice_unit_cost  numeric(12,2),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);
create index purchase_order_lines_po_idx on public.purchase_order_lines (po_id, position);

-- Parts: where each one stands after approval, and its label.
alter table public.part_items drop constraint if exists part_items_order_status_check;
alter table public.part_items add constraint part_items_order_status_check
  check (order_status in ('none', 'to_order', 'ordered', 'partly_received', 'received'));
alter table public.part_items add column if not exists po_id uuid references public.purchase_orders (id);
alter table public.part_items add column if not exists po_line_id uuid references public.purchase_order_lines (id);
alter table public.part_items add column if not exists expected_date date;
alter table public.part_items add column if not exists received_qty numeric(10,2) not null default 0;
alter table public.part_items add column if not exists issued_qty numeric(10,2) not null default 0;
alter table public.part_items add column if not exists issue_status text not null default 'none' check (issue_status in ('none', 'issued', 'confirmed'));
alter table public.part_items add column if not exists issued_at timestamptz;
alter table public.part_items add column if not exists issued_by uuid references public.staff (id);
alter table public.part_items add column if not exists issue_confirmed_at timestamptz;
alter table public.part_items add column if not exists issue_confirmed_by uuid references public.staff (id);
alter table public.part_items add column if not exists returned_qty numeric(10,2) not null default 0;
alter table public.part_items add column if not exists return_status text not null default 'none' check (return_status in ('none', 'to_return', 'returned'));
alter table public.part_items add column if not exists return_note text;
alter table public.part_items add column if not exists label_code text unique;
alter table public.part_items add column if not exists final_cost_aed numeric(12,2);

-- 3. Consumables stock ----------------------------------------------------------------------------
create table public.stock_items (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  unit           text not null default 'pc',
  quantity       numeric(12,2) not null default 0,
  minimum_level  numeric(12,2) not null default 0,
  unit_cost      numeric(12,2) not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);
create table public.stock_issues (
  id             uuid primary key default gen_random_uuid(),
  stock_item_id  uuid not null references public.stock_items (id),
  job_id         uuid not null references public.jobs (id),
  quantity       numeric(12,2) not null check (quantity > 0),
  unit_cost      numeric(12,2) not null default 0,
  issued_by      uuid references public.staff (id),
  confirmed_by   uuid references public.staff (id),
  confirmed_at   timestamptz,
  note           text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);
create index stock_issues_job_idx on public.stock_issues (job_id);

-- 4. Files on a job after the inspection (work photos, wash, delivery, supplier invoices, QC scan)
create table public.job_files (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id),
  kind          text not null check (kind in ('work_photo', 'additional_work', 'wash_photo', 'gate_out_photo', 'delivery_photo', 'handover_photo', 'supplier_invoice', 'qc_postscan', 'return_photo')),
  ref_id        uuid,
  storage_path  text not null unique,
  content_type  text,
  caption       text,
  taken_at      timestamptz not null default now(),
  uploaded_by   uuid references public.staff (id),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.staff (id)
);
create index job_files_job_idx on public.job_files (job_id, kind);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('job-files', 'job-files', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
create policy job_files_read on storage.objects for select to authenticated using (bucket_id = 'job-files');

-- 5. Work ------------------------------------------------------------------------------------------
create table public.work_lines (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id),
  quotation_line_id  uuid references public.quotation_lines (id),
  source             text not null default 'quotation' check (source in ('quotation', 'additional')),
  position           integer not null default 0,
  title              text not null,
  details            text,
  hours_quoted       numeric(6,1),
  assigned_to        uuid references public.staff (id),
  status             text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  done_at            timestamptz,
  done_by            uuid references public.staff (id),
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);
create index work_lines_job_idx on public.work_lines (job_id, position);

create table public.work_sessions (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id),
  technician_id  uuid not null references public.staff (id),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  end_reason     text check (end_reason is null or end_reason in ('stop', 'pause', 'complete', 'auto')),
  pause_reason   text,
  minutes        integer,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);
create index work_sessions_job_idx on public.work_sessions (job_id, started_at desc);
create unique index work_sessions_one_open_idx on public.work_sessions (technician_id) where ended_at is null;

create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.staff (id),
  shift_date    date not null,
  clock_in      timestamptz not null default now(),
  clock_out     timestamptz,
  late_minutes  integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.staff (id)
);
create index shifts_staff_idx on public.shifts (staff_id, shift_date desc);
create unique index shifts_one_open_idx on public.shifts (staff_id) where clock_out is null;

create table public.additional_work (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id),
  technician_id  uuid references public.staff (id),
  work_line_id   uuid references public.work_lines (id),
  remark         text not null,
  parts_needed   text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by     uuid references public.staff (id),
  decided_at     timestamptz,
  decision_note  text,
  quotation_id   uuid references public.quotations (id),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff (id)
);
create index additional_work_job_idx on public.additional_work (job_id, status);

-- 6. QC and wash ----------------------------------------------------------------------------------
create table public.qc_checks (
  id                      uuid primary key default gen_random_uuid(),
  job_id                  uuid not null references public.jobs (id),
  round                   integer not null default 1,
  status                  text not null default 'open' check (status in ('open', 'passed', 'failed')),
  inspector_id            uuid references public.staff (id),
  started_at              timestamptz not null default now(),
  finished_at             timestamptz,
  mileage                 integer,
  mileage_unit            text,
  postscan_path           text,
  postscan_waived_reason  text,
  items                   jsonb not null default '[]'::jsonb,
  notes                   text,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  created_by              uuid references public.staff (id),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references public.staff (id)
);
create index qc_checks_job_idx on public.qc_checks (job_id, round desc);

create table public.washes (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null unique references public.jobs (id),
  done_by      uuid references public.staff (id),
  done_at      timestamptz,
  photo_path   text,
  skipped      boolean not null default false,
  skip_reason  text,
  skipped_by   uuid references public.staff (id),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.staff (id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff (id)
);

-- 7. Invoices and payments --------------------------------------------------------------------------
create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique,
  kind               text not null default 'tax_invoice' check (kind in ('tax_invoice', 'proforma', 'credit_note')),
  job_id             uuid references public.jobs (id),
  customer_id        uuid not null references public.customers (id),
  vehicle_id         uuid references public.vehicles (id),
  credit_of          uuid references public.invoices (id),
  status             text not null default 'issued' check (status in ('issued', 'cancelled')),
  issued_at          timestamptz not null default now(),
  issued_by          uuid references public.staff (id),
  token              text unique,
  labour_mode        text not null default 'itemised' check (labour_mode in ('itemised', 'combined')),
  subtotal_aed       numeric(12,2) not null default 0,
  discount_aed       numeric(12,2) not null default 0,
  taxable_aed        numeric(12,2) not null default 0,
  vat_aed            numeric(12,2) not null default 0,
  total_aed          numeric(12,2) not null default 0,
  agreed_total_aed   numeric(12,2),
  discount_note      text,
  prepared_by        uuid references public.staff (id),
  approved_by        uuid references public.staff (id),
  notes              text,
  customer_snapshot  jsonb,
  vehicle_snapshot   jsonb,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);
create index invoices_job_idx on public.invoices (job_id, issued_at desc);
create index invoices_customer_idx on public.invoices (customer_id, issued_at desc);

create table public.invoice_lines (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.invoices (id),
  position           integer not null default 0,
  section            text not null check (section in ('services', 'parts', 'fees')),
  description        text not null,
  details            text,
  part_number        text,
  quantity           numeric(10,2) not null default 1,
  unit_price         numeric(12,2) not null default 0,
  amount_aed         numeric(12,2) not null default 0,
  vat_aed            numeric(12,2) not null default 0,
  total_aed          numeric(12,2) not null default 0,
  cost_aed           numeric(12,2) not null default 0,
  quotation_line_id  uuid references public.quotation_lines (id),
  part_item_id       uuid references public.part_items (id),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.staff (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.staff (id)
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique default ('RCT-' || lpad(nextval('public.receipt_number_seq')::text, 5, '0')),
  job_id           uuid references public.jobs (id),
  invoice_id       uuid references public.invoices (id),
  customer_id      uuid not null references public.customers (id),
  method           text not null check (method in ('cash', 'card', 'link', 'cheque')),
  amount_aed       numeric(12,2) not null check (amount_aed > 0),
  received_at      timestamptz not null default now(),
  received_by      uuid references public.staff (id),
  reference        text,
  cheque_number    text,
  cheque_bank      text,
  cheque_date      date,
  cheque_status    text check (cheque_status is null or cheque_status in ('pending', 'cleared', 'bounced')),
  cleared_at       timestamptz,
  bank_charge_aed  numeric(12,2) not null default 0,
  is_deposit       boolean not null default false,
  status           text not null default 'recorded' check (status in ('recorded', 'reversed')),
  reversed_at      timestamptz,
  reversed_reason  text,
  token            text unique,
  notes            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.staff (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.staff (id)
);
create index payments_job_idx on public.payments (job_id, received_at desc);
create index payments_invoice_idx on public.payments (invoice_id);

-- 8. Gate-out with delivery, and the job's later stages ---------------------------------------------
alter table public.gate_outs add column if not exists leave_method text check (leave_method is null or leave_method in ('customer', 'customer_driver', 'recovery'));
alter table public.gate_outs add column if not exists collector_name text;
alter table public.gate_outs add column if not exists handover_confirmed boolean not null default false;
alter table public.gate_outs add column if not exists old_parts_handed boolean;
alter table public.gate_outs add column if not exists delivery_address text;
alter table public.gate_outs add column if not exists delivery_at timestamptz;
alter table public.gate_outs add column if not exists delivery_by text check (delivery_by is null or delivery_by in ('our_truck', 'outside'));
alter table public.gate_outs add column if not exists delivery_company text;
alter table public.gate_outs add column if not exists delivery_fee_aed numeric(12,2);
alter table public.gate_outs add column if not exists left_at timestamptz;
alter table public.gate_outs add column if not exists left_by uuid references public.staff (id);
alter table public.gate_outs add column if not exists delivered_at timestamptz;
alter table public.gate_outs add column if not exists delivered_by uuid references public.staff (id);
alter table public.gate_outs add column if not exists delivered_to text;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('gate_in_pending','pending_approval','pending_inspection','in_inspection','pending_quote','pending_customer_approval','approved','waiting_parts','in_work','pending_qc','pending_wash','ready','pending_payment','in_delivery','closed'));
alter table public.jobs add column if not exists parts_state text not null default 'none' check (parts_state in ('none', 'ordering', 'ordered', 'received', 'issued'));
alter table public.jobs add column if not exists work_started_at timestamptz;
alter table public.jobs add column if not exists work_completed_at timestamptz;
alter table public.jobs add column if not exists qc_round integer not null default 0;
alter table public.jobs add column if not exists rework_count integer not null default 0;
alter table public.jobs add column if not exists mileage_out integer;
alter table public.jobs add column if not exists ready_to_invoice_at timestamptz;
alter table public.jobs add column if not exists ready_to_invoice_by uuid references public.staff (id);
alter table public.jobs add column if not exists ready_token text unique;
alter table public.jobs add column if not exists ready_sent_at timestamptz;
alter table public.jobs add column if not exists followup_due_at date;
alter table public.jobs add column if not exists followup_done_at timestamptz;
alter table public.jobs add column if not exists followup_notified_at timestamptz;

-- 9. Stamps, change log, no deletes, access ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'purchase_orders', 'purchase_order_lines', 'stock_items', 'stock_issues', 'job_files', 'work_lines', 'work_sessions', 'shifts', 'additional_work', 'qc_checks', 'washes', 'invoices', 'invoice_lines', 'payments'] loop
    execute format('create trigger %I_audit_columns before insert or update on public.%I for each row execute function public.set_audit_columns()', t, t);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function public.write_audit_log()', t, t);
    execute format('create trigger %I_no_delete before delete on public.%I for each row execute function public.prevent_delete()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Money tables: the owner, accounts and advisors. Parts see purchase orders and stock. Nobody else.
create policy suppliers_read on public.suppliers for select to authenticated using (public.has_role('owner', 'parts', 'accounts', 'service_advisor'));
create policy suppliers_write on public.suppliers for insert to authenticated with check (public.has_role('owner', 'parts'));
create policy suppliers_update on public.suppliers for update to authenticated using (public.has_role('owner', 'parts')) with check (public.has_role('owner', 'parts'));
create policy purchase_orders_read on public.purchase_orders for select to authenticated using (public.has_role('owner', 'parts', 'accounts', 'service_advisor'));
create policy purchase_orders_write on public.purchase_orders for insert to authenticated with check (public.has_role('owner', 'parts'));
create policy purchase_orders_update on public.purchase_orders for update to authenticated using (public.has_role('owner', 'parts', 'accounts')) with check (public.has_role('owner', 'parts', 'accounts'));
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated using (public.has_role('owner', 'parts', 'accounts', 'service_advisor'));
create policy purchase_order_lines_write on public.purchase_order_lines for insert to authenticated with check (public.has_role('owner', 'parts'));
create policy purchase_order_lines_update on public.purchase_order_lines for update to authenticated using (public.has_role('owner', 'parts', 'accounts')) with check (public.has_role('owner', 'parts', 'accounts'));
create policy stock_items_read on public.stock_items for select to authenticated using (public.has_role('owner', 'parts', 'accounts', 'service_advisor'));
create policy stock_items_write on public.stock_items for insert to authenticated with check (public.has_role('owner', 'parts'));
create policy stock_items_update on public.stock_items for update to authenticated using (public.has_role('owner', 'parts')) with check (public.has_role('owner', 'parts'));
create policy stock_issues_read on public.stock_issues for select to authenticated using (public.has_role('owner', 'parts', 'accounts', 'service_advisor'));
create policy stock_issues_write on public.stock_issues for insert to authenticated with check (public.has_role('owner', 'parts'));
create policy stock_issues_update on public.stock_issues for update to authenticated using (public.has_role('owner', 'parts')) with check (public.has_role('owner', 'parts'));
create policy invoices_read on public.invoices for select to authenticated using (public.has_role('owner', 'accounts', 'service_advisor'));
create policy invoices_write on public.invoices for insert to authenticated with check (public.has_role('owner', 'accounts'));
create policy invoices_update on public.invoices for update to authenticated using (public.has_role('owner', 'accounts')) with check (public.has_role('owner', 'accounts'));
create policy invoice_lines_read on public.invoice_lines for select to authenticated using (public.has_role('owner', 'accounts', 'service_advisor'));
create policy invoice_lines_write on public.invoice_lines for insert to authenticated with check (public.has_role('owner', 'accounts'));
create policy invoice_lines_update on public.invoice_lines for update to authenticated using (public.has_role('owner', 'accounts')) with check (public.has_role('owner', 'accounts'));
create policy payments_read on public.payments for select to authenticated using (public.has_role('owner', 'accounts', 'service_advisor'));
create policy payments_write on public.payments for insert to authenticated with check (public.has_role('owner', 'accounts'));
create policy payments_update on public.payments for update to authenticated using (public.has_role('owner', 'accounts')) with check (public.has_role('owner', 'accounts'));

-- Workshop tables carry no prices: the workshop reads them; writes by the people who do the work.
create policy job_files_read on public.job_files for select to authenticated using (true);
create policy job_files_write on public.job_files for insert to authenticated with check (true);
create policy work_lines_read on public.work_lines for select to authenticated using (true);
create policy work_lines_write on public.work_lines for insert to authenticated with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy work_lines_update on public.work_lines for update to authenticated using (public.has_role('owner', 'workshop_manager', 'technician')) with check (public.has_role('owner', 'workshop_manager', 'technician'));
create policy work_sessions_read on public.work_sessions for select to authenticated using (true);
create policy work_sessions_write on public.work_sessions for insert to authenticated with check (public.has_role('owner', 'workshop_manager', 'technician'));
create policy work_sessions_update on public.work_sessions for update to authenticated using (public.has_role('owner', 'workshop_manager', 'technician')) with check (public.has_role('owner', 'workshop_manager', 'technician'));
create policy shifts_read on public.shifts for select to authenticated using (true);
create policy shifts_write on public.shifts for insert to authenticated with check (auth.uid() = staff_id or public.has_role('owner', 'workshop_manager'));
create policy shifts_update on public.shifts for update to authenticated using (auth.uid() = staff_id or public.has_role('owner', 'workshop_manager')) with check (auth.uid() = staff_id or public.has_role('owner', 'workshop_manager'));
create policy additional_work_read on public.additional_work for select to authenticated using (true);
create policy additional_work_write on public.additional_work for insert to authenticated with check (public.has_role('owner', 'workshop_manager', 'technician'));
create policy additional_work_update on public.additional_work for update to authenticated using (public.has_role('owner', 'workshop_manager', 'service_advisor')) with check (public.has_role('owner', 'workshop_manager', 'service_advisor'));
create policy qc_checks_read on public.qc_checks for select to authenticated using (true);
create policy qc_checks_write on public.qc_checks for insert to authenticated with check (public.has_role('owner', 'qc_inspector', 'workshop_manager'));
create policy qc_checks_update on public.qc_checks for update to authenticated using (public.has_role('owner', 'qc_inspector', 'workshop_manager')) with check (public.has_role('owner', 'qc_inspector', 'workshop_manager'));
create policy washes_read on public.washes for select to authenticated using (true);
create policy washes_write on public.washes for insert to authenticated with check (public.has_role('owner', 'qc_inspector', 'workshop_manager', 'service_advisor'));
create policy washes_update on public.washes for update to authenticated using (public.has_role('owner', 'qc_inspector', 'workshop_manager', 'service_advisor')) with check (public.has_role('owner', 'qc_inspector', 'workshop_manager', 'service_advisor'));

-- Live updates
alter publication supabase_realtime add table public.purchase_orders;
alter publication supabase_realtime add table public.work_lines;
alter publication supabase_realtime add table public.work_sessions;
alter publication supabase_realtime add table public.qc_checks;
alter publication supabase_realtime add table public.washes;
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.payments;
alter publication supabase_realtime add table public.additional_work;

-- 10. Settings: company details, bank, documents, labour rate rules, labels, QC checks, follow-up
insert into public.settings (key, value, label, description) values
  ('company_legal_name', to_jsonb('O F J AUTOMOTIVE WORKS L.L.C'::text), 'Legal name', 'On every PDF header.'),
  ('company_legal_name_ar', to_jsonb('او اف جي اوتوموتيف وركس ش.ذ.م.م'::text), 'Legal name (Arabic)', 'On every PDF header.'),
  ('company_address_1', to_jsonb('Warehouse S02-S03, 24B Street'::text), 'Address line 1', 'PDF header.'),
  ('company_address_2', to_jsonb('Al Quoz Industrial Third'::text), 'Address line 2', 'PDF header.'),
  ('company_address_3', to_jsonb('Dubai, United Arab Emirates'::text), 'Address line 3', 'PDF header.'),
  ('company_website', to_jsonb('www.ofjauto.com'::text), 'Website', 'PDF footer.'),
  ('bank_name', to_jsonb('The National Bank of Ras Al Khaimah'::text), 'Bank', 'Bank transfer details on invoices.'),
  ('bank_account_name', to_jsonb('OFJ Automotive Works L L C'::text), 'Account name', 'Bank transfer details on invoices.'),
  ('bank_account_number', to_jsonb('0552886630001'::text), 'Account number', 'Bank transfer details on invoices.'),
  ('bank_iban', to_jsonb('AE44 0400 0005 5288 6630 001'::text), 'IBAN', 'Bank transfer details on invoices.'),
  ('bank_swift', to_jsonb('NRAKAEAK'::text), 'SWIFT', 'Bank transfer details on invoices.'),
  ('labour_rate_by_make', '{}'::jsonb, 'Labour rate per make', 'Standard mechanical rate for a make; the advisor can only go higher.'),
  ('labour_rate_bodyshop_aed', to_jsonb(''::text), 'Bodyshop labour rate', 'Left empty until the bodyshop path is built.'),
  ('next_invoice_number', '1'::jsonb, 'Next invoice number', 'Numbering continues from here.'),
  ('consumables_default_aed', '50'::jsonb, 'Consumables line (AED)', 'Default amount for the standard Consumables line.'),
  ('document_currency', to_jsonb('symbol'::text), 'Currency on documents', 'symbol: the dirham symbol; aed: the letters AED.'),
  ('label_width_mm', '50'::jsonb, 'Part label width (mm)', 'Thermal label size.'),
  ('label_height_mm', '30'::jsonb, 'Part label height (mm)', 'Thermal label size.'),
  ('qc_general_checks', '["No warning lights on the dashboard", "Fluid levels correct", "No leaks under the car", "Wheel bolts torqued", "Tyre pressures set", "Undertrays, covers and clips refitted", "Battery terminals tight", "No tools, rags or old parts left in the car", "Interior clean, no grease marks", "Protective covers removed", "Service indicator reset where a service was done", "Dash cam reconnected if fitted", "Old parts kept for the customer if requested", "Road test after repair"]'::jsonb, 'QC general checks', 'One per line.'),
  ('followup_days', '3'::jsonb, 'Follow-up after gate-out (days)', 'The advisor is reminded to follow up.'),
  ('whatsapp_ready_template', to_jsonb(E'Dear [name], your [make model] ([plate]) is ready for collection at OFJ Automotive. Your invoice and balance are here:\n[link]\nThank you, [advisor], OFJ Automotive'::text), 'Car ready message', 'WhatsApp message with the invoice link.'),
  ('whatsapp_followup_template', to_jsonb(E'Dear [name], thank you for choosing OFJ Automotive for your [make model] ([plate]). We hope everything is running well. If anything needs our attention, please let us know.\nThank you, [advisor], OFJ Automotive'::text), 'Follow-up message', 'WhatsApp message a few days after gate-out.')
on conflict (key) do nothing;
update public.settings set value = to_jsonb('+971 4 330 3113'::text) where key = 'company_phone' and (value = to_jsonb(''::text) or value is null);
update public.settings set value = to_jsonb('accounts@ofjauto.com'::text) where key = 'company_email' and (value = to_jsonb(''::text) or value is null);
update public.settings set value = to_jsonb('100520937200003'::text) where key = 'company_trn' and (value = to_jsonb(''::text) or value is null);
update public.settings set value = to_jsonb('Warehouse S02-S03, 24B Street, Al Quoz Industrial Third, Dubai, United Arab Emirates'::text) where key = 'company_address';
update public.settings set value = jsonb_build_object('gate_in', 2, 'inspection', 4, 'quote', 4, 'approval', 24, 'parts', 48, 'work', 24, 'qc', 2, 'wash', 2, 'ready', 24) where key = 'stage_target_hours' and value is null;
