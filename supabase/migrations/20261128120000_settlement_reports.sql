-- 29 October 2026, section 5: Network International's Merchant Transaction Reports, uploaded on Card settlements.
-- The file stays in the private `settlement-reports` bucket; its reading (header, lines, summary, flags) in this
-- server-only table; Record links the settlements it made. Every screen reads it through the server.
create table if not exists public.settlement_reports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null,
  parsed jsonb not null,
  uploaded_by uuid references public.staff(id),
  settlement_ids uuid[] not null default '{}',
  recorded_at timestamptz,
  recorded_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);

alter table public.settlement_reports enable row level security;
revoke all on public.settlement_reports from anon, authenticated;
grant all on public.settlement_reports to service_role;

drop trigger if exists settlement_reports_audit on public.settlement_reports;
create trigger settlement_reports_audit after insert or update on public.settlement_reports for each row execute function write_audit_log();
drop trigger if exists settlement_reports_nodel on public.settlement_reports;
create trigger settlement_reports_nodel before delete on public.settlement_reports for each row execute function prevent_delete();
drop trigger if exists settlement_reports_stamp on public.settlement_reports;
create trigger settlement_reports_stamp before insert or update on public.settlement_reports for each row execute function set_audit_columns();

alter table public.card_settlements drop constraint if exists card_settlements_report_fk;
alter table public.card_settlements add constraint card_settlements_report_fk foreign key (report_id) references public.settlement_reports(id);

-- The files: private, read and written by the server only.
insert into storage.buckets (id, name, public) values ('settlement-reports', 'settlement-reports', false) on conflict (id) do nothing;

notify pgrst, 'reload schema';
