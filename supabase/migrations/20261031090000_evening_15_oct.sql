-- Evening of 15 October 2026: a declined quotation can send the car to gate-out ("Declined, car going out"), with an
-- optional charge invoiced before it leaves.
alter table public.jobs add column if not exists declined_out_at timestamptz;
alter table public.jobs add column if not exists declined_charge_invoice_id uuid references public.invoices (id);
