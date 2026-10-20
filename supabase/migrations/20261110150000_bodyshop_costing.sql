-- Bodyshop costing (20 October 2026): film and tint by the roll, metres per car, the real profit.
create table if not exists public.film_rolls (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('film', 'tint')),
  film_key text,
  name text not null,
  length_m numeric(6,1),
  price_aed numeric(10,2) not null default 0,
  opened_at timestamptz not null default now(),
  finished_at timestamptz,
  finished_by uuid references public.staff (id),
  waste_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
alter table public.film_rolls enable row level security;
drop policy if exists film_rolls_read on public.film_rolls;
create policy film_rolls_read on public.film_rolls for select to authenticated using (public.has_role('owner', 'accounts'));

create table if not exists public.film_usage (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  roll_id uuid not null references public.film_rolls (id),
  metres numeric(6,1),
  cost_aed numeric(10,2) not null default 0,
  photo_path text,
  corrected boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
alter table public.film_usage enable row level security;
drop policy if exists film_usage_read on public.film_usage;
create policy film_usage_read on public.film_usage for select to authenticated using (public.has_role('owner', 'accounts'));
