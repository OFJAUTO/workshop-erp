-- The recovery driver calls the customer (30 October 2026). A trip made on the Recovery page before the car has a job
-- (a pick-up from a villa) had no customer on record, so the driver saw only the address. The trip now carries the
-- person to call and his mobile: the customer, or the pick-up contact when it is someone else (the driver of the
-- family, a building guard). The driver's page shows them for his own open trip only, never after it is done.
-- recovery_trips keeps its row level security and grants (owner and accounts read; the driver's page reads through
-- the server).

alter table public.recovery_trips add column if not exists contact_name text;
alter table public.recovery_trips add column if not exists contact_phone text;

comment on column public.recovery_trips.contact_name is 'The person the driver calls for this trip when it is not (or not only) the job''s customer (30 Oct 2026).';

notify pgrst, 'reload schema';
