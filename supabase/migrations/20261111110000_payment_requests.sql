-- 21 October 2026, part 1 section 1.4: every pay-request message carries OUR short link to /p/<token>,
-- never the gateway's own address. The page behind it lives here: what it is for, the amount, the
-- pasted gateway link (replaceable later - the same /p/ link keeps working), bank transfer and
-- pay-at-the-workshop stay on the page.
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  quotation_id uuid references public.quotations(id),
  invoice_id uuid references public.invoices(id),
  kind text not null default 'deposit' check (kind in ('deposit','proforma','invoice')),
  amount_aed numeric(12,2) not null,
  purpose text,
  gateway_url text,
  token text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);
alter table public.payment_requests enable row level security;
create index if not exists payment_requests_job_idx on public.payment_requests (job_id);

do $$ begin
  create trigger payment_requests_audit after insert or update on public.payment_requests for each row execute function public.write_audit_log();
exception when others then null; end $$;
do $$ begin
  create trigger payment_requests_no_delete before delete on public.payment_requests for each row execute function public.prevent_delete();
exception when others then null; end $$;
