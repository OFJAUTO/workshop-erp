-- 13 October 2026, afternoon: the change log kept small, the test-data clear widened, price imports with Undo, bulk delete on the Parts table.

-- 1. The change log: an update stores only the columns that changed (plus the id), and a run of saves by the same
--    person on the same row within a minute is one entry (the first "before", the latest "after"), so an autosave
--    that saves every pause does not fill the log with whole-row copies.
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_id  text;
  v_key text;
  v_diff_old jsonb := '{}'::jsonb;
  v_diff_new jsonb := '{}'::jsonb;
  v_prev_id bigint;
  v_prev_old jsonb;
  v_actor uuid := auth.uid();
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - 'pin_hash' - 'token_hash';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - 'pin_hash' - 'token_hash';
  end if;
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id',
                   v_new ->> 'staff_id', v_old ->> 'staff_id',
                   v_new ->> 'key', v_old ->> 'key');
  if tg_op = 'UPDATE' then
    -- Only what changed, never the bookkeeping columns.
    for v_key in select key from jsonb_each(v_new) loop
      if v_key in ('updated_at', 'updated_by') then continue; end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_diff_old := v_diff_old || jsonb_build_object(v_key, v_old -> v_key);
        v_diff_new := v_diff_new || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;
    if v_diff_new = '{}'::jsonb then
      return new;
    end if;
    v_diff_old := v_diff_old || jsonb_build_object('id', v_id);
    v_diff_new := v_diff_new || jsonb_build_object('id', v_id);
    -- The same person saving the same row again within a minute: one entry, kept up to date.
    select a.id, a.old_data into v_prev_id, v_prev_old
    from public.audit_log a
    where a.table_name = tg_table_name and a.record_id = v_id and a.action = 'UPDATE'
      and a.changed_by is not distinct from v_actor
      and a.changed_at > now() - interval '60 seconds'
    order by a.changed_at desc
    limit 1;
    if v_prev_id is not null then
      update public.audit_log
      set old_data = coalesce(v_prev_old, '{}'::jsonb) || (v_diff_old - (select coalesce(array_agg(k), '{}') from jsonb_object_keys(coalesce(v_prev_old, '{}'::jsonb)) k)),
          new_data = coalesce(new_data, '{}'::jsonb) || v_diff_new,
          changed_at = now()
      where id = v_prev_id;
      return new;
    end if;
    insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    values (tg_table_name, v_id, tg_op, v_diff_old, v_diff_new, v_actor);
    return new;
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name, v_id, tg_op, v_old, v_new, v_actor);
  return coalesce(new, old);
end
$function$;

-- 2. Price imports, with what each one added or changed, so "Undo last import" can put it back.
create table if not exists public.price_imports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  supplier_id uuid references public.suppliers(id),
  source text,
  format text,
  line_count integer not null default 0,
  applied_count integer not null default 0,
  undone_at timestamptz,
  undone_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);
create index if not exists price_imports_job_idx on public.price_imports (job_id, created_at desc);
alter table public.price_imports enable row level security;
drop policy if exists price_imports_read on public.price_imports;
create policy price_imports_read on public.price_imports for select to authenticated using (true);
drop trigger if exists price_imports_audit on public.price_imports;
create trigger price_imports_audit after insert or update or delete on public.price_imports for each row execute function public.write_audit_log();
drop trigger if exists price_imports_no_delete on public.price_imports;
create trigger price_imports_no_delete before delete on public.price_imports for each row execute function public.prevent_delete();

create table if not exists public.price_import_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.price_imports(id),
  part_id uuid references public.part_items(id),
  request_id uuid references public.part_requests(id),
  created boolean not null default false,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists price_import_lines_import_idx on public.price_import_lines (import_id);
alter table public.price_import_lines enable row level security;
drop policy if exists price_import_lines_read on public.price_import_lines;
create policy price_import_lines_read on public.price_import_lines for select to authenticated using (true);

-- 3. Bulk delete on the Parts table: deleted rows vanish (inactive) and can come back for a minute by batch.
alter table public.part_items add column if not exists deleted_at timestamptz;
alter table public.part_items add column if not exists deleted_by uuid references public.staff(id);
alter table public.part_items add column if not exists delete_batch uuid;
alter table public.part_items add column if not exists availability_note text;
alter table public.part_requests add column if not exists deleted_at timestamptz;
alter table public.part_requests add column if not exists deleted_by uuid references public.staff(id);
alter table public.part_requests add column if not exists delete_batch uuid;
create index if not exists part_items_delete_batch_idx on public.part_items (delete_batch) where delete_batch is not null;
create index if not exists part_requests_delete_batch_idx on public.part_requests (delete_batch) where delete_batch is not null;

-- 4. Clear test data: every table that belongs to cars, customers and jobs, found by following the foreign keys from
--    the base tables, minus what stays (staff, settings, lists, suppliers and their discounts, devices, the change log).
--    Runs in one transaction; the numbering restarts.
create or replace function public.clear_test_data()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t text;
  n bigint;
  counts jsonb := '{}'::jsonb;
  todo text[] := array[
    'jobs', 'vehicles', 'customers', 'appointments', 'inbound_scans', 'inbound_emails', 'notifications', 'quick_codes',
    'shifts', 'work_sessions', 'work_pauses', 'upload_links', 'price_imports', 'upload_failures'
  ];
  keep text[] := array[
    'audit_log', 'settings', 'staff', 'staff_private', 'roles', 'departments', 'devices', 'setup_links', 'notification_preferences',
    'suppliers', 'supplier_discount_changes', 'services', 'service_categories', 'packages', 'part_catalogue', 'stock_items',
    'vehicle_makes', 'vehicle_models'
  ];
  added boolean := true;
  r record;
begin
  -- Follow the foreign keys: any table pointing at one being cleared is cleared too, unless it is kept.
  while added loop
    added := false;
    for r in
      select distinct c.conrelid::regclass::text as child
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.confrelid::regclass::text = any(todo)
        and not (c.conrelid::regclass::text = any(todo))
    loop
      if r.child = any(keep) then
        raise exception 'Table % is kept but points at a table being cleared', r.child;
      end if;
      todo := todo || r.child;
      added := true;
    end loop;
  end loop;
  foreach t in array todo loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('select count(*) from public.%I', t) into n;
      counts := counts || jsonb_build_object(t, n);
    else
      todo := array_remove(todo, t);
    end if;
  end loop;
  execute 'truncate table ' || (select string_agg(format('public.%I', x), ', ') from unnest(todo) as x);
  update public.stock_items set quantity = 0 where quantity <> 0;
  alter sequence public.customer_number_seq restart with 1;
  alter sequence public.job_number_seq restart with 1;
  alter sequence public.quotation_number_seq restart with 1;
  alter sequence public.estimate_number_seq restart with 1;
  alter sequence public.po_number_seq restart with 1;
  alter sequence public.invoice_number_seq restart with 1;
  alter sequence public.proforma_number_seq restart with 1;
  alter sequence public.credit_note_number_seq restart with 1;
  alter sequence public.receipt_number_seq restart with 1;
  update public.settings set value = '1'::jsonb where key = 'next_invoice_number';
  return counts;
end $function$;
