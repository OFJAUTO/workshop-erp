-- Final km and the instrument-cluster photo at gate-out (30 October 2026, batch 2 section 2).
--
-- gate_outs.mileage_out: the final reading in km (the car's own unit is kept in mileage_out_unit, and the miles as read
--   in mileage_out_miles for a car whose dashboard shows miles), compared with the gate-in reading.
-- gate_outs.mileage_unreadable_reason / _note: the reading could not be taken (battery dead, cluster not working, the
--   car leaves on a recovery truck, other) - the photo is still required and the owner is told.
-- gate_outs.odometer_file_id: the photo of the whole instrument cluster (km, fuel, warning lights), a job_files row
--   of the new kind 'odometer_out' (internal only, never on a customer document).
-- settings.mileage_alert_km: driven more than this while with us -> the owner is told (default 30 km).
-- gate_outs has column-level select grants for the login role (customer privacy, 29 October): the new columns get theirs.
alter table public.gate_outs add column if not exists mileage_out integer check (mileage_out is null or mileage_out >= 0);
alter table public.gate_outs add column if not exists mileage_out_unit text check (mileage_out_unit is null or mileage_out_unit in ('km', 'mi'));
alter table public.gate_outs add column if not exists mileage_out_miles integer check (mileage_out_miles is null or mileage_out_miles >= 0);
alter table public.gate_outs add column if not exists mileage_unreadable_reason text;
alter table public.gate_outs add column if not exists mileage_unreadable_note text;
alter table public.gate_outs add column if not exists odometer_file_id uuid;
alter table public.gate_outs add column if not exists mileage_alert_at timestamptz;
grant select (mileage_out, mileage_out_unit, mileage_out_miles, mileage_unreadable_reason, mileage_unreadable_note, odometer_file_id, mileage_alert_at) on public.gate_outs to authenticated;

alter table public.job_files drop constraint if exists job_files_kind_check;
alter table public.job_files add constraint job_files_kind_check check (kind = any (array[
  'work_photo', 'additional_work', 'wash_photo', 'gate_out_photo', 'delivery_photo', 'handover_photo', 'supplier_invoice',
  'qc_postscan', 'return_photo', 'bodyshop_photo', 'bodyshop_removed', 'payment_proof', 'odometer_out'
]));

insert into public.settings (key, value, label, description)
values ('mileage_alert_km', '30', 'Driven while with us: tell the owner above (km)', 'At gate-out, a car driven more than this many km since gate-in is reported to the owner with both dashboard photos.')
on conflict (key) do nothing;

comment on column public.gate_outs.mileage_out is 'Final reading at gate-out in km (30 Oct 2026); compared with gate_ins.mileage.';
notify pgrst, 'reload schema';
