-- A bodyshop car quoted before it arrives sits on a booked job. Its gate-in stamp is a placeholder until the car
-- is actually gated in, so the stamp may change once: while the job is still 'booked'. After that it never changes.
create or replace function public.protect_job_stamps()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'booked' and (new.gated_in_at is distinct from old.gated_in_at or new.gated_in_by is distinct from old.gated_in_by) then
    raise exception 'Gate-in time and user are set automatically and cannot be changed.' using errcode = 'P0001';
  end if;
  if old.gated_out_at is not null and
     (new.gated_out_at is distinct from old.gated_out_at or new.gated_out_by is distinct from old.gated_out_by) then
    raise exception 'Gate-out time and user are set automatically and cannot be changed.' using errcode = 'P0001';
  end if;
  return new;
end
$$;
