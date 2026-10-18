-- 18 October 2026 (afternoon), 8: the advisor bonus (automatic, the owner decides).
insert into public.settings (key, value, label, description) values
  ('advisor_bonus_percent', '5'::jsonb, 'Advisor bonus (%)', 'The default bonus rate on a qualifying tax invoice''s pure profit. The owner can override any invoice with a reason.')
on conflict (key) do nothing;

-- The owner's per-invoice override: a different rate (more, less or zero) with a short reason.
create table if not exists public.advisor_bonus_overrides (
  invoice_id uuid primary key references public.invoices (id),
  rate_percent numeric(5,2) not null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
alter table public.advisor_bonus_overrides enable row level security;
drop policy if exists advisor_bonus_overrides_read on public.advisor_bonus_overrides;
create policy advisor_bonus_overrides_read on public.advisor_bonus_overrides for select to authenticated using (true);

-- One approved period (26th to 25th): the rows frozen as they were approved.
create table if not exists public.advisor_bonus_periods (
  period text primary key,
  rows jsonb not null,
  total_aed numeric(12,2) not null,
  approved_at timestamptz not null default now(),
  approved_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
alter table public.advisor_bonus_periods enable row level security;
drop policy if exists advisor_bonus_periods_read on public.advisor_bonus_periods;
create policy advisor_bonus_periods_read on public.advisor_bonus_periods for select to authenticated using (true);
