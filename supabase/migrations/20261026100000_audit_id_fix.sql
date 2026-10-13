-- The slimmed change log: the "id" added to an update entry is the row's own id only. A table keyed by a word
-- (settings.key, staff_private.staff_id) keeps its own key column instead, so nothing that reads an uuid out of
-- the entry can trip over a word. Entries written this afternoon with a word under "id" are corrected.
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
  v_keep text;
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
    -- The row's own key column travels with the diff: id, else staff_id, else key.
    v_keep := case when v_new ? 'id' then 'id' when v_new ? 'staff_id' then 'staff_id' when v_new ? 'key' then 'key' else null end;
    if v_keep is not null then
      v_diff_old := v_diff_old || jsonb_build_object(v_keep, v_old -> v_keep);
      v_diff_new := v_diff_new || jsonb_build_object(v_keep, v_new -> v_keep);
    end if;
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

-- Entries of this afternoon that carry a word under "id": the word moves back to its own column.
update public.audit_log
set new_data = (new_data - 'id') || jsonb_build_object('key', new_data -> 'id'),
    old_data = case when old_data ? 'id' then (old_data - 'id') || jsonb_build_object('key', old_data -> 'id') else old_data end
where table_name = 'settings' and action = 'UPDATE' and new_data ? 'id' and not (new_data ->> 'id') ~ '^[0-9a-fA-F-]{36}$';
update public.audit_log
set new_data = (new_data - 'id') || jsonb_build_object('staff_id', new_data -> 'id'),
    old_data = case when old_data ? 'id' then (old_data - 'id') || jsonb_build_object('staff_id', old_data -> 'id') else old_data end
where table_name = 'staff_private' and action = 'UPDATE' and new_data ? 'id' and not (new_data ? 'staff_id');
