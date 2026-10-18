-- 18 October 2026 (afternoon), 7: real road distances, the new trip form, and monthly driver payment.
alter table public.recovery_trips
  add column if not exists road_km numeric(7,1),
  add column if not exists km_source text check (km_source in ('route', 'manual')),
  add column if not exists recovery_kind text check (recovery_kind in ('flatbed', 'closed_box')),
  add column if not exists paid_month text;

-- Drivers and companies are paid by the month, never per trip.
create table if not exists public.recovery_payouts (
  id uuid primary key default gen_random_uuid(),
  who text not null,
  month text not null,
  total_aed numeric(12,2) not null,
  trip_count integer not null,
  paid_at timestamptz not null default now(),
  paid_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id),
  unique (who, month)
);
alter table public.recovery_payouts enable row level security;
drop policy if exists recovery_payouts_read on public.recovery_payouts;
create policy recovery_payouts_read on public.recovery_payouts for select to authenticated using (true);

-- External recovery companies, saved with their mobile for next time.
create table if not exists public.recovery_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
alter table public.recovery_companies enable row level security;
drop policy if exists recovery_companies_read on public.recovery_companies;
create policy recovery_companies_read on public.recovery_companies for select to authenticated using (true);
insert into public.recovery_companies (name)
select trim(x.value) from public.settings s, jsonb_array_elements_text(s.value) as x(value)
where s.key = 'recovery_companies' and trim(x.value) <> ''
on conflict (name) do nothing;
