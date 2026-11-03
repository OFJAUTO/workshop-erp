-- PAYMENT HAND-OVER (2 November 2026, evening batch, section 3; J-00969).
--
-- An advisor takes a payment at the counter (card slip, cash, a transfer screenshot) but only accounts and the owner
-- record money. "Payment received – send to accounts" on the job card's money tile makes a PAYMENT REPORT: the amount
-- (pre-filled with the balance), the method, the auth code or reference (optional), the photo of the slip, receipt or
-- transfer (required, a job file of kind payment_report tied to the report's id) and a note. Accounts and the owner are
-- told, see it on Waiting on you, and one tap opens the Record payment window pre-filled: they record it (the receipt's
-- client key is the report's id, so one report makes one receipt) or Query it back with a comment. A report not recorded
-- or queried within N working hours (setting payment_report_reminder_hours, default 4) reminds accounts and the owner once.
--
-- The screens read it live (advisors, accounts and the owner may SELECT it); every write goes through the server
-- (service role), so there is no insert or update policy. anon has nothing.

create table if not exists public.payment_reports (
  id uuid primary key default gen_random_uuid(),            -- the browser's form key: the slip photo is uploaded under it first
  job_id uuid not null references public.jobs(id),
  invoice_id uuid references public.invoices(id),           -- the live proforma or tax invoice at report time (information only)
  customer_id uuid not null references public.customers(id),
  vehicle_id uuid references public.vehicles(id),
  amount_aed numeric(12,2) not null check (amount_aed > 0),
  method text not null check (method in ('cash', 'card', 'link', 'transfer', 'cheque')),
  auth_code text check (auth_code is null or auth_code ~ '^[A-Z0-9]{6}$'),
  reference text,
  note text,
  proof_path text not null,                                 -- the first photo (job_files kind payment_report, ref_id = id)
  status text not null default 'waiting' check (status in ('waiting', 'recorded', 'queried', 'withdrawn')),
  reported_by uuid not null references public.staff(id),
  reported_at timestamptz not null default now(),
  payment_id uuid references public.payments(id),
  recorded_by uuid references public.staff(id),
  recorded_at timestamptz,
  query_note text,
  queried_by uuid references public.staff(id),
  queried_at timestamptz,
  replaces_id uuid references public.payment_reports(id),   -- "Send again" after a query
  withdrawn_reason text,
  withdrawn_by uuid references public.staff(id),
  withdrawn_at timestamptz,
  reminded_at timestamptz,                                  -- the working-hours reminder, once per report
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);

create unique index if not exists payment_reports_payment_idx on public.payment_reports (payment_id) where payment_id is not null;
create index if not exists payment_reports_job_idx on public.payment_reports (job_id) where is_active;
create index if not exists payment_reports_waiting_idx on public.payment_reports (reported_at) where status = 'waiting' and is_active;

-- 1. RLS on. 2. Read for the people who see the money (live job card, Invoices, Waiting on you); no write policy.
alter table public.payment_reports enable row level security;
drop policy if exists payment_reports_read on public.payment_reports;
create policy payment_reports_read on public.payment_reports
  for select to authenticated using (public.has_role('owner', 'accounts', 'service_advisor'));

-- 3. Grants: select for logged-in staff (the policy decides who), everything for the server, nothing for anon.
revoke all on public.payment_reports from anon, authenticated;
grant select on public.payment_reports to authenticated;
grant all on public.payment_reports to service_role;

-- 4. The usual triggers: audit (who and when), the stamps, and no delete (a report is withdrawn, never deleted).
drop trigger if exists payment_reports_audit on public.payment_reports;
create trigger payment_reports_audit after insert or update on public.payment_reports for each row execute function public.write_audit_log();
drop trigger if exists payment_reports_stamp on public.payment_reports;
create trigger payment_reports_stamp before insert or update on public.payment_reports for each row execute function public.set_audit_columns();
drop trigger if exists payment_reports_no_delete on public.payment_reports;
create trigger payment_reports_no_delete before delete on public.payment_reports for each row execute function public.prevent_delete();

-- 5. Live updates on the job card, the money pages and the dashboards (guarded: added once).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_reports') then
    alter publication supabase_realtime add table public.payment_reports;
  end if;
end $$;

-- The slip photo is a job file of its own kind (the same list as JOB_FILE_KINDS in src/lib/upload-targets/job-file.ts).
alter table public.job_files drop constraint if exists job_files_kind_check;
alter table public.job_files add constraint job_files_kind_check check (kind = any (array[
  'work_photo', 'additional_work', 'wash_photo', 'gate_out_photo', 'delivery_photo', 'handover_photo', 'supplier_invoice',
  'qc_postscan', 'return_photo', 'bodyshop_photo', 'bodyshop_removed', 'payment_proof', 'odometer_out', 'payment_report'
]));

-- The reminder (Settings > Money): a report not recorded or queried within this many WORKING hours.
insert into public.settings (key, value, label)
values ('payment_report_reminder_hours', to_jsonb(4), 'Payment reported by an advisor and not recorded: remind accounts and the owner after (working hours)')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
