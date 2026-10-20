-- Bodyshop packages (20 October 2026): one customer price, the included items as a snapshot on the line.
alter table public.quotation_lines add column if not exists package_key text;
alter table public.quotation_lines add column if not exists package_items jsonb;
