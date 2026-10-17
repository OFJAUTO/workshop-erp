-- 17 October 2026, C1: every commission needs the owner's approval (the owner's own are approved automatically).
-- Pending ones are not counted in cost or profit; declined ones are removed with the owner's note.
alter table public.quotations add column if not exists commission_status text check (commission_status is null or commission_status in ('pending', 'approved', 'declined'));
alter table public.quotations add column if not exists commission_set_by uuid references public.staff (id);
alter table public.quotations add column if not exists commission_set_at timestamptz;
alter table public.quotations add column if not exists commission_decided_by uuid references public.staff (id);
alter table public.quotations add column if not exists commission_decided_at timestamptz;
alter table public.quotations add column if not exists commission_decision_note text;

-- Commissions set before this rule stand as approved.
update public.quotations set commission_status = 'approved' where commission_to is not null and commission_status is null;
