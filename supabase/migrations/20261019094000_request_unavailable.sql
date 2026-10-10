-- D2: a part request can be marked not available by Parts.
alter table public.part_requests drop constraint if exists part_requests_status_check;
alter table public.part_requests add constraint part_requests_status_check check (status in ('open', 'listed', 'done', 'rejected', 'unavailable'));
