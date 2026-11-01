-- Record a payment any time (1 November 2026, batch "payments anytime", section 1).
-- A payment can now arrive for a customer with no job to attach it to: it is saved as an UNALLOCATED ADVANCE on the
-- customer's account (job_id and invoice_id empty, the note in `notes` says what it is for) and is allocated later in
-- one step. The car it came in for is kept, and so is who allocated it and when.
-- payments already has row level security, its policies and grants (owner, accounts, advisors read; owner and accounts
-- write); new columns inherit the table's grants. Nothing is removed.

alter table public.payments add column if not exists vehicle_id uuid references public.vehicles(id);
alter table public.payments add column if not exists allocated_at timestamptz;
alter table public.payments add column if not exists allocated_by uuid references public.staff(id);

create index if not exists payments_unallocated_idx on public.payments (customer_id) where job_id is null and invoice_id is null and is_active;
create index if not exists payments_vehicle_idx on public.payments (vehicle_id) where vehicle_id is not null;

-- The advisor's payment link for any amount (1.9) uses the /p/ payment page with its own kind.
alter table public.payment_requests drop constraint if exists payment_requests_kind_check;
alter table public.payment_requests add constraint payment_requests_kind_check check (kind in ('deposit', 'proforma', 'invoice', 'advance'));

insert into public.settings (key, label, value)
values ('whatsapp_payment_request_template', 'WhatsApp: payment link (any amount)', to_jsonb(E'Dear [name],\n\nHere is the payment link for your *[make model]* ([plate]): *AED [amount]*.\n\nPay here:\n[link]\n\nOFJ Automotive'::text))
on conflict (key) do nothing;

notify pgrst, 'reload schema';
