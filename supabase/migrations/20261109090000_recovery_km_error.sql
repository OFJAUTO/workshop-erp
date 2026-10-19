-- Why a trip has no road distance (shown to the owner and accounts; never contains the API key).
alter table public.recovery_trips add column if not exists km_error text;
