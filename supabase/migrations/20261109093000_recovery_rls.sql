-- Recovery money is for the owner and accounts only: lock the tables at the database too.
alter table public.recovery_trips enable row level security;
alter table public.recovery_drivers enable row level security;

-- Trips and drivers (prices, phone numbers): owner and accounts read; everything else goes through the server.
drop policy if exists recovery_trips_read on public.recovery_trips;
create policy recovery_trips_read on public.recovery_trips for select to authenticated using (public.has_role('owner', 'accounts'));
drop policy if exists recovery_drivers_read on public.recovery_drivers;
create policy recovery_drivers_read on public.recovery_drivers for select to authenticated using (public.has_role('owner', 'accounts'));

-- Payout months were readable by every signed-in person: owner and accounts only now.
drop policy if exists recovery_payouts_read on public.recovery_payouts;
create policy recovery_payouts_read on public.recovery_payouts for select to authenticated using (public.has_role('owner', 'accounts'));
