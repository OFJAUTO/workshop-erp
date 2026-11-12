-- 13 November 2026, Section 8: suppliers can be merged, and every earlier name stays searchable.
-- also_known_as: the names a supplier was known by (a rename, or a supplier merged into it).
-- merged_into: the supplier this one was merged into (it stays, inactive; nothing is deleted). Plain uuids, no new
-- foreign key (a second suppliers -> suppliers relation would make embeds ambiguous).
alter table public.suppliers add column if not exists also_known_as text[] not null default '{}';
alter table public.suppliers add column if not exists merged_into uuid;
alter table public.suppliers add column if not exists merged_at timestamptz;
alter table public.suppliers add column if not exists merged_by uuid;

notify pgrst, 'reload schema';
