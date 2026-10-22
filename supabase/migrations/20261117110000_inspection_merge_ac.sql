-- Overnight batch 22 to 23 October 2026, section 6: one A/C gas item and the duplicate items merged.
-- "A/C gas level" (Good/Average/Bad) and "A/C gas recharge" (OK/Required) become ONE item "A/C gas" with the
-- style 'gas' (Good / Low / Empty / N/A), recharge ticked by itself when low or empty. Each "... service due" /
-- "... change due" job item folds into its fluid item as a "Service due?" switch. The data itself is moved by
-- scripts/migrate-inspection-merge-23-oct.mjs; old rows that were folded in keep their answers and are marked
-- merged_into (they cannot be deleted), so every screen and document reads only the merged item.
alter table public.inspection_items drop constraint if exists inspection_items_style_check;
alter table public.inspection_items add constraint inspection_items_style_check check (style in ('grade', 'job', 'gas'));
alter table public.inspection_items add column if not exists service_due boolean not null default false;
alter table public.inspection_items add column if not exists recharge_needed boolean not null default false;
alter table public.inspection_items add column if not exists merged_into text;

notify pgrst, 'reload schema';
