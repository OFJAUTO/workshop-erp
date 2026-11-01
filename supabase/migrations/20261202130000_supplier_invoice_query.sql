-- Supplier invoices tab (1 November 2026): accounts can "Query" a supplier invoice back to the parts desk with a
-- comment. The query sits on each LPO the invoice was entered on until Parts correct the invoice (or accounts check it).

alter table public.purchase_orders
  add column if not exists supplier_invoice_query text,
  add column if not exists supplier_invoice_query_at timestamptz,
  add column if not exists supplier_invoice_query_by uuid references public.staff(id);

comment on column public.purchase_orders.supplier_invoice_query is 'Accounts'' question on the supplier invoice, back to the parts desk (1 Nov 2026). Cleared when the invoice is corrected or checked.';

notify pgrst, 'reload schema';
