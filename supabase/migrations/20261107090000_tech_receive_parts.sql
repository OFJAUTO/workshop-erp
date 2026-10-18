-- 18 October 2026 (afternoon), 1: the technician receives parts on his own tablet.
-- Parts only mark parts "Ready for handover"; the technician ticks them and confirms with his own PIN.
alter table public.part_items
  add column if not exists ready_for_handover_at timestamptz,
  add column if not exists ready_for_handover_by uuid references public.staff (id),
  add column if not exists ready_reminder_at timestamptz;

-- Handovers waiting for a PIN at the desk become "ready at the desk": the technician now confirms on his tablet.
update public.part_items set ready_for_handover_at = now() where pending_handover_id is not null;
update public.part_handovers set status = 'cancelled' where status = 'pending';
update public.part_items set pending_handover_id = null where pending_handover_id is not null;
