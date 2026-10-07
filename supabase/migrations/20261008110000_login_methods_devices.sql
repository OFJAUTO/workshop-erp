-- Login methods per person (PC, handheld, or both) and shared/personal devices.

alter table public.staff drop constraint if exists staff_login_type_check;
alter table public.staff add constraint staff_login_type_check check (login_type in ('password', 'pin', 'both'));

alter table public.devices
  add column if not exists kind text not null default 'shared' check (kind in ('shared', 'personal')),
  add column if not exists staff_id uuid references public.staff (id),
  add column if not exists removed_at timestamptz;
alter table public.devices drop constraint if exists devices_location_check;
alter table public.devices add constraint devices_location_check check (location in ('workshop', 'bodyshop', 'office', 'personal'));

-- Everyone who is logged in may see which devices exist (name and kind), so a
-- personal device can show its owner's name; writes stay owner-only.
drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated using (true);
