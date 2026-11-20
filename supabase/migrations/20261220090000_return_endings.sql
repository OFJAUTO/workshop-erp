-- HOW A PURCHASE RETURN ENDS (20 November 2026, Section 1; LPO-00103-1). Every way a return can end, stored on the
-- part: credit note / refund / advance / returned before invoicing / exchange, the advance asked by Parts and confirmed
-- by accounts, and every correction kept in a history (nothing is deleted). An LPO whose parts all went back before
-- invoicing waits for no invoice any more ("not_expected": no "Invoice missing" tag, no reminder, no bill).

alter table public.part_items
  add column if not exists return_ending text,
  add column if not exists return_ending_at timestamptz,
  add column if not exists return_ending_by uuid references public.staff (id),
  add column if not exists return_ending_note text,
  add column if not exists return_advance_aed numeric(14,2),
  add column if not exists return_advance_status text,
  add column if not exists return_advance_at timestamptz,
  add column if not exists return_advance_by uuid references public.staff (id),
  add column if not exists return_ending_history jsonb not null default '[]'::jsonb;

alter table public.part_items drop constraint if exists part_items_return_ending_check;
alter table public.part_items add constraint part_items_return_ending_check
  check (return_ending is null or return_ending in ('credit_note', 'refund', 'advance', 'before_invoice', 'exchange'));
alter table public.part_items drop constraint if exists part_items_return_advance_status_check;
alter table public.part_items add constraint part_items_return_advance_status_check
  check (return_advance_status is null or return_advance_status in ('asked', 'confirmed', 'refused'));

-- The LPO's invoice state gains "not_expected" (every part went back before invoicing).
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.purchase_orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%supplier_invoice_status%' loop
    execute format('alter table public.purchase_orders drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.purchase_orders add constraint purchase_orders_supplier_invoice_status_check
  check (supplier_invoice_status in ('none', 'to_follow', 'received', 'not_expected'));

-- Purchase returns can close as an advance or "returned before invoicing", and a wrong ending is voided (kept).
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.purchase_returns'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%requested%' loop
    execute format('alter table public.purchase_returns drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.purchase_returns add constraint purchase_returns_status_check
  check (status in ('requested', 'sent', 'credited', 'refunded', 'replaced', 'refused', 'advance', 'before_invoice'));

notify pgrst, 'reload schema';
