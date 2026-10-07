-- Jobs gated in before the two-video rule keep counting as complete.
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
$$;
