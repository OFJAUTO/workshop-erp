-- MIGRATION TEMPLATE (copy into supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql).
-- Since Supabase's change of 30 October 2026, a new table gets NO automatic API grants.
-- Every table this project creates must therefore say all three things itself:
--   1. RLS ON   2. policies by role   3. explicit grants (never anon).
-- `npm run test:security` fails the batch if any of this is forgotten.

create table public.example_things (
  id uuid primary key default gen_random_uuid(),
  -- … columns …
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id),
  is_active boolean not null default true
);

-- 1. RLS always on (without it the table is wide open to every API key).
alter table public.example_things enable row level security;

-- 2. Policies by role, mirroring src/lib/roles.ts. Patterns used in this project:
--    is_owner()                         the owner only (like staff_private)
--    has_role('owner','accounts')       named roles
--    auth.uid() is not null + has_role  any signed-in staff of those roles
create policy example_things_read on public.example_things
  for select to authenticated using (has_role('owner', 'service_advisor'));
create policy example_things_write on public.example_things
  for insert to authenticated with check (has_role('owner'));
-- (updates: for update using (...) with check (...). No delete policy: rows go inactive.)

-- 3. Explicit grants. service_role bypasses RLS and is what server code uses.
--    authenticated only when the user client (createClient) reads or writes the table.
--    anon NEVER (customer pages go through server routes, not open tables).
grant select, insert, update on public.example_things to authenticated;
grant all on public.example_things to service_role;

-- A table that only server code touches (tokens, links, secrets): NO policies and NO grants
-- to anon or authenticated at all — only: grant all ... to service_role;

-- 4. Housekeeping triggers this project expects on business tables:
-- create trigger example_things_audit  after insert or update on public.example_things for each row execute function write_audit_log();
-- create trigger example_things_nodel  before delete on public.example_things for each row execute function prevent_delete();
-- create trigger example_things_stamp  before insert or update on public.example_things for each row execute function set_audit_columns();

-- 5. Realtime (only if a screen live-refreshes on it): alter publication supabase_realtime add table public.example_things;
--    Remember: realtime respects RLS per subscriber — no policy means no live feed for that role.

notify pgrst, 'reload schema';
