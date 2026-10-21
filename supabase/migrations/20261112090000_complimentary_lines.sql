-- Complimentary / Included lines (21 October 2026, batch section 1): a line sold at 0 on purpose.
-- price_display: 'normal' | 'complimentary' | 'included'. A complimentary line sells for nothing,
-- passes "Before sending", keeps its internal cost (profit stays correct) and prints the word
-- instead of a price on every customer document.
alter table public.quotation_lines add column if not exists price_display text not null default 'normal';
do $$ begin
  alter table public.quotation_lines add constraint quotation_lines_price_display_check check (price_display in ('normal', 'complimentary', 'included'));
exception when duplicate_object then null; end $$;

-- The invoice is a straight copy of the approved quotation: it carries the same word, and the
-- line's own discount so the documents can show "Discount 22%: -AED 4,840.00" under the line.
alter table public.invoice_lines add column if not exists price_display text not null default 'normal';
do $$ begin
  alter table public.invoice_lines add constraint invoice_lines_price_display_check check (price_display in ('normal', 'complimentary', 'included'));
exception when duplicate_object then null; end $$;
alter table public.invoice_lines add column if not exists discount_percent numeric(5,2) not null default 0;

-- Free recovery on open quotations: plain words, marked complimentary (approved ones are locked and keep their wording).
update public.quotation_lines l set price_display = 'complimentary', title = 'Complimentary pick-up & drop-off'
  from public.quotations q
  where q.id = l.quotation_id and l.line_type = 'recovery' and l.recovery_mention_free = true
    and coalesce(l.unit_price, 0) = 0 and l.is_active and q.is_active and q.status in ('draft', 'sent', 'opened');

-- Zero-priced service lines on drafts were stuck at "enter the price": they are the included items.
update public.quotation_lines l set price_display = 'complimentary'
  from public.quotations q
  where q.id = l.quotation_id and l.line_type = 'package' and l.unit_price = 0 and l.fee_kind is null
    and l.is_active and q.is_active and q.status = 'draft' and l.price_display = 'normal';

notify pgrst, 'reload schema';
