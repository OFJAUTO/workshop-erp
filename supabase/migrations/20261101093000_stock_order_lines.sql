-- A stock order's lines point at stock items, not at a job's parts: the part column may be empty on those lines.
alter table public.purchase_order_lines alter column part_item_id drop not null;
