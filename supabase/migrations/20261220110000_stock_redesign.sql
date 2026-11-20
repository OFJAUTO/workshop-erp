-- STOCK PAGE REDESIGN, VIEW ACCESS AND THE STOCK COUNT (20 November 2026, Section 5).
-- Categories (editable by the owner and the parts desk), a brand, a photo and an archive mark on each stock item, a
-- merge mark for duplicates (history kept), a personal "Can view stock" switch on the team record (view only: no
-- costs, no value, no actions), and the stock count: entered item by item, saved and continued, applied only after the
-- owner approves the batch (the approval box). Nothing is deleted or reset; nothing posts to Zoho.

create table if not exists public.stock_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create unique index if not exists stock_categories_name_active on public.stock_categories (lower(name)) where is_active;
alter table public.stock_categories enable row level security;
revoke all on public.stock_categories from anon, authenticated;
grant all on public.stock_categories to service_role;
drop trigger if exists stock_categories_audit on public.stock_categories;
create trigger stock_categories_audit after insert or update on public.stock_categories for each row execute function public.write_audit_log();
drop trigger if exists stock_categories_stamp on public.stock_categories;
create trigger stock_categories_stamp before insert or update on public.stock_categories for each row execute function public.set_audit_columns();
drop trigger if exists stock_categories_no_delete on public.stock_categories;
create trigger stock_categories_no_delete before delete on public.stock_categories for each row execute function public.prevent_delete();

insert into public.stock_categories (name, position)
select v.name, v.position from (values
  ('Engine oil and lubricants', 1), ('Filters', 2), ('Coolants', 3), ('Brake and cleaning chemicals', 4), ('Transmission fluids', 5),
  ('AC products', 6), ('Tyre service materials', 7), ('PPF and tint film', 8), ('Workshop safety and hygiene', 9), ('Branding and accessories', 10)
) as v(name, position)
where not exists (select 1 from public.stock_categories c where lower(c.name) = lower(v.name));

alter table public.stock_items
  add column if not exists category_id uuid references public.stock_categories (id),
  add column if not exists brand text,
  add column if not exists photo_path text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.staff (id),
  add column if not exists archive_reason text,
  add column if not exists merged_into uuid references public.stock_items (id);

alter table public.staff add column if not exists can_view_stock boolean not null default false;

create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  counted_on date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'refused')),
  submitted_at timestamptz,
  submitted_by uuid references public.staff (id),
  decided_at timestamptz,
  decided_by uuid references public.staff (id),
  decision_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id)
);
create table if not exists public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts (id),
  stock_item_id uuid not null references public.stock_items (id),
  system_qty numeric(14,3) not null default 0,
  counted_qty numeric(14,3),
  not_found boolean not null default false,
  unit_cost numeric(14,2) not null default 0,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id),
  unique (count_id, stock_item_id)
);
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
revoke all on public.stock_counts from anon, authenticated;
revoke all on public.stock_count_lines from anon, authenticated;
grant all on public.stock_counts to service_role;
grant all on public.stock_count_lines to service_role;
drop trigger if exists stock_counts_audit on public.stock_counts;
create trigger stock_counts_audit after insert or update on public.stock_counts for each row execute function public.write_audit_log();
drop trigger if exists stock_counts_stamp on public.stock_counts;
create trigger stock_counts_stamp before insert or update on public.stock_counts for each row execute function public.set_audit_columns();
drop trigger if exists stock_counts_no_delete on public.stock_counts;
create trigger stock_counts_no_delete before delete on public.stock_counts for each row execute function public.prevent_delete();
drop trigger if exists stock_count_lines_audit on public.stock_count_lines;
create trigger stock_count_lines_audit after insert or update on public.stock_count_lines for each row execute function public.write_audit_log();
drop trigger if exists stock_count_lines_stamp on public.stock_count_lines;
create trigger stock_count_lines_stamp before insert or update on public.stock_count_lines for each row execute function public.set_audit_columns();
drop trigger if exists stock_count_lines_no_delete on public.stock_count_lines;
create trigger stock_count_lines_no_delete before delete on public.stock_count_lines for each row execute function public.prevent_delete();

notify pgrst, 'reload schema';
