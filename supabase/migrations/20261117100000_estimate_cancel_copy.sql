-- Overnight batch 22 to 23 October 2026, section 4: estimates can be deleted while being prepared, cancelled with a
-- reason once sent (never deleted: the customer saw it), copied, and extended when expired.
alter table public.quotations add column if not exists cancelled_at timestamptz;
alter table public.quotations add column if not exists cancelled_by uuid references public.staff(id);
alter table public.quotations add column if not exists cancel_reason text;
alter table public.quotations add column if not exists deleted_at timestamptz;
alter table public.quotations add column if not exists deleted_by uuid references public.staff(id);
alter table public.quotations add column if not exists copied_from_id uuid references public.quotations(id);
alter table public.quotations add column if not exists extended_at timestamptz;
alter table public.quotations add column if not exists extended_by uuid references public.staff(id);

notify pgrst, 'reload schema';
