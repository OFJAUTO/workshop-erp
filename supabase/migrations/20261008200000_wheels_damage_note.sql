-- Gate-in changes from staff testing on 8 October 2026:
-- four wheel photos with a condition each, and an optional damage note.

-- 1. Wheel photo kinds, and the condition chosen under each wheel photo.
alter table public.gate_in_media drop constraint if exists gate_in_media_kind_check;
alter table public.gate_in_media add constraint gate_in_media_kind_check
  check (kind in ('video', 'video_exterior', 'video_interior', 'dashboard_photo',
                  'keys_photo', 'keys_photo_front', 'keys_photo_back', 'damage_photo', 'gate_out_photo',
                  'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'));
alter table public.gate_in_media add column if not exists wheel_condition text[];
alter table public.gate_in_media drop constraint if exists gate_in_media_wheel_condition_check;
alter table public.gate_in_media add constraint gate_in_media_wheel_condition_check
  check (wheel_condition is null or wheel_condition <@ array['none', 'curbed', 'scratched', 'paint_fade', 'bent']::text[]);

-- The wheel condition is written by the server (master key) through /api/media/details; staff still cannot change media rows directly.

-- 2. Damage note, and whether wheel photos are required (jobs gated in before this change are not held up).
alter table public.gate_ins add column if not exists damage_note text;
alter table public.gate_ins add column if not exists wheels_required boolean not null default true;
alter table public.gate_ins disable trigger user;
update public.gate_ins set wheels_required = false;
alter table public.gate_ins enable trigger user;

-- 3. Completion rule: everything before, plus all four wheel photos each with a condition when required.
create or replace function public.wheel_done(p_job uuid, p_kind text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select cardinality(m.wheel_condition) > 0
    from public.gate_in_media m
    where m.job_id = p_job and m.kind = p_kind
    order by m.taken_at desc
    limit 1
  ), false)
$$;

create or replace function public.gate_in_is_complete(p_job uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select (exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'video_exterior')
          or exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'video'))
     and (exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'video_interior')
          or exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'video'))
     and exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'dashboard_photo')
     and (exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'keys_photo_front')
          or exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'keys_photo'))
     and (exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'keys_photo_back')
          or exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'keys_photo'))
     and (
       not coalesce((select major_damage from public.gate_ins where job_id = p_job), false)
       or exists (select 1 from public.gate_in_media where job_id = p_job and kind = 'damage_photo')
     )
     and (
       not coalesce((select wheels_required from public.gate_ins where job_id = p_job), false)
       or (public.wheel_done(p_job, 'wheel_fl') and public.wheel_done(p_job, 'wheel_fr')
           and public.wheel_done(p_job, 'wheel_rl') and public.wheel_done(p_job, 'wheel_rr'))
     )
$$;

-- Re-check when a wheel condition is chosen, not only when a file is added.
drop trigger if exists gate_in_media_completion on public.gate_in_media;
create trigger gate_in_media_completion after insert or update of wheel_condition on public.gate_in_media
  for each row execute function public.refresh_gate_in_completion();
