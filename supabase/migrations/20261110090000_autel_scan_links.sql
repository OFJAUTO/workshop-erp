-- Autel sends a LINK instead of an attachment: the fetched report remembers where it came from,
-- its Report ID, and the car hint from the subject ("2011 Porsche") for unmatched suggestions.
alter table public.inbound_scans add column if not exists source_url text;
alter table public.inbound_scans add column if not exists report_id text;
alter table public.inbound_scans add column if not exists car_hint text;
