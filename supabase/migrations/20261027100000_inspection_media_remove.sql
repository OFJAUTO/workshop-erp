-- Inspection photos can be taken off again (the X on a thumbnail): the row is marked removed, never deleted.
alter table public.inspection_media add column if not exists removed_at timestamptz;
alter table public.inspection_media add column if not exists removed_by uuid references public.staff(id);
create index if not exists inspection_media_live_idx on public.inspection_media (inspection_id) where removed_at is null;
