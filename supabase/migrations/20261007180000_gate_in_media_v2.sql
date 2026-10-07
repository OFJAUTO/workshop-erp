-- Gate-in changes from staff testing on 7 October 2026:
-- two videos (exterior, interior), two keys photos (front, back), major-damage question,
-- cars without a number plate.

-- 1. Media kinds
alter table public.gate_in_media drop constraint if exists gate_in_media_kind_check;
alter table public.gate_in_media add constraint gate_in_media_kind_check
  check (kind in ('video', 'video_exterior', 'video_interior', 'dashboard_photo',
                  'keys_photo', 'keys_photo_front', 'keys_photo_back', 'damage_photo', 'gate_out_photo'));

-- 2. Major damage question
alter table public.gate_ins add column if not exists major_damage boolean not null default false;

-- 3. Cars without a plate
alter table public.vehicles add column if not exists has_plate boolean not null default true;
alter table public.vehicles alter column plate_number drop not null;
alter table public.vehicles drop constraint if exists vehicles_uae_plate_needs_emirate;
alter table public.vehicles add constraint vehicles_plate_rules
  check (
    (has_plate = false and plate_number is null)
    or (has_plate = true and plate_number is not null and (plate_country <> 'UAE' or plate_emirate is not null))
  );
drop index if exists vehicles_active_plate_idx;
create unique index vehicles_active_plate_idx on public.vehicles
  (plate_country, coalesce(plate_emirate, ''), coalesce(plate_code, ''), plate_number)
  where is_active and has_plate;

-- 4. Completion rule: both videos, dashboard photo, both keys photos, and at least one
--    damage photo when major damage was ticked.
create or replace function public.gate_in_is_complete(p_job uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'video_exterior')
     and exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'video_interior')
     and exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'dashboard_photo')
     and exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'keys_photo_front')
     and exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'keys_photo_back')
     and (
       not coalesce((select major_damage from public.gate_ins where job_id = p_job), false)
       or exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'damage_photo')
     )
$$;

create or replace function public.refresh_gate_in_completion()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_job uuid := new.job_id;
begin
  if public.gate_in_is_complete(v_job) then
    update public.gate_ins set is_complete = true, completed_at = coalesce(completed_at, now())
      where job_id = v_job and is_complete = false;
    update public.jobs set status = 'pending_approval'
      where id = v_job and status = 'gate_in_pending';
  else
    update public.gate_ins set is_complete = false where job_id = v_job and is_complete = true;
    update public.jobs set status = 'gate_in_pending'
      where id = v_job and status = 'pending_approval' and first_approval_at is null;
  end if;
  return new;
end
$$;

-- Re-check when the major-damage answer changes.
drop trigger if exists gate_ins_completion on public.gate_ins;
create trigger gate_ins_completion after update of major_damage on public.gate_ins
  for each row execute function public.refresh_gate_in_completion();
