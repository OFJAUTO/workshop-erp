-- Overnight build, part 2: several technicians on one car can all read it (job_technicians), not only
-- the one in jobs.assigned_to. Advisors record payments. Pauses and technicians readable by everyone signed in.

create or replace function public.can_see_job(p_job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_technician()
      or exists (select 1 from public.jobs j where j.id = p_job and j.assigned_to = auth.uid())
      or exists (select 1 from public.job_technicians t where t.job_id = p_job and t.staff_id = auth.uid() and t.is_active and t.left_at is null)
$$;

drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select to authenticated
  using (not public.is_technician() or assigned_to = auth.uid()
         or exists (select 1 from public.job_technicians t where t.job_id = jobs.id and t.staff_id = auth.uid() and t.is_active and t.left_at is null));

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated
  using (
    case public.current_staff_role()
      when 'technician' then exists (select 1 from public.jobs j where j.vehicle_id = vehicles.id and (j.assigned_to = auth.uid()
                                     or exists (select 1 from public.job_technicians t where t.job_id = j.id and t.staff_id = auth.uid() and t.is_active and t.left_at is null)))
      when 'workshop_manager' then exists (select 1 from public.jobs j where j.vehicle_id = vehicles.id and j.is_open)
      when 'qc_inspector' then exists (select 1 from public.jobs j where j.vehicle_id = vehicles.id and j.is_open)
      else true end
  );
drop policy if exists vehicle_photos_read on public.vehicle_photos;
create policy vehicle_photos_read on public.vehicle_photos for select to authenticated
  using (not public.is_technician() or exists (select 1 from public.jobs j where j.vehicle_id = vehicle_photos.vehicle_id and (j.assigned_to = auth.uid()
         or exists (select 1 from public.job_technicians t where t.job_id = j.id and t.staff_id = auth.uid() and t.is_active and t.left_at is null))));

-- Settings for the new screens.
insert into public.settings (key, value, label, description) values
  ('comeback_loss_warn_aed', '0'::jsonb, 'Comeback loss warning', 'Not used yet.')
on conflict (key) do nothing;
