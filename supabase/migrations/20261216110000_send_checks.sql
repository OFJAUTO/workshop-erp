-- 13 November 2026: CHECK BEFORE YOU SEND. One row per confirmation in the parts desk's "check before you send" window
-- (prices back to the advisor, an LPO for approval, an LPO to the supplier, a receipt): who, when, and which flags were
-- showing - the approver of an LPO sees the same flags. Server-only.

create table if not exists public.send_checks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('prices', 'lpo_approval', 'lpo_supplier', 'receipt')),
  job_id uuid,
  po_id uuid,
  part_ids uuid[] not null default '{}',
  -- [{ key, name, flags: [..] }]: only the lines that were highlighted.
  flags jsonb not null default '[]'::jsonb,
  flag_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);
create index if not exists send_checks_po_idx on public.send_checks (po_id, created_at desc);
create index if not exists send_checks_parts_idx on public.send_checks using gin (part_ids);

alter table public.send_checks enable row level security;
revoke all on public.send_checks from anon, authenticated;
grant all on public.send_checks to service_role;

drop trigger if exists send_checks_audit on public.send_checks;
create trigger send_checks_audit after insert or update on public.send_checks for each row execute function public.write_audit_log();
drop trigger if exists send_checks_stamp on public.send_checks;
create trigger send_checks_stamp before insert or update on public.send_checks for each row execute function public.set_audit_columns();
drop trigger if exists send_checks_no_delete on public.send_checks;
create trigger send_checks_no_delete before delete on public.send_checks for each row execute function public.prevent_delete();

notify pgrst, 'reload schema';
