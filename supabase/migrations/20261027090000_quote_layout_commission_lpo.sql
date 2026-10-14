-- 14 October 2026: estimated hours per labour line, the labour discount and round-off, commission (internal only),
-- Pricing done that locks and reopens, and the main LPO with its supplier LPOs.

-- Labour lines: the workshop's estimate beside the quoted hours (labour at cost uses it, then the clocked hours).
alter table public.quotation_lines add column if not exists hours_estimate numeric(6,2);

-- The labour discount: on our own labour lines only, a percentage or a fixed amount. Quotations without a kind keep the
-- old rule (a percentage of labour and services). Commission: who, how much (fixed or a percentage of the total before
-- VAT), the amount, and whether it was paid. Never shown to a customer.
alter table public.quotations add column if not exists discount_kind text check (discount_kind in ('percent', 'aed'));
alter table public.quotations add column if not exists discount_value numeric(12,2);
alter table public.quotations add column if not exists commission_to text;
alter table public.quotations add column if not exists commission_kind text check (commission_kind in ('aed', 'percent'));
alter table public.quotations add column if not exists commission_value numeric(12,2);
alter table public.quotations add column if not exists commission_aed numeric(12,2) not null default 0;
alter table public.quotations add column if not exists commission_paid_at timestamptz;
alter table public.quotations add column if not exists commission_paid_by uuid references public.staff(id);

-- Pricing done locks the Parts table; Edit reopens it until "Send updated prices".
alter table public.jobs add column if not exists parts_pricing_reopened_at timestamptz;
alter table public.jobs add column if not exists parts_pricing_reopened_by uuid references public.staff(id);

-- One main LPO per job (every supplier, grouped) approved by the owner or accounts; supplier LPOs made from it,
-- numbered LPO-00012-1, -2, -3, each with one supplier's parts only.
alter table public.purchase_orders add column if not exists kind text not null default 'supplier' check (kind in ('main', 'supplier'));
alter table public.purchase_orders add column if not exists parent_id uuid references public.purchase_orders(id);
alter table public.purchase_orders add column if not exists sub_number integer;
create index if not exists purchase_orders_parent_idx on public.purchase_orders (parent_id) where parent_id is not null;

-- Settings: the people we pay commission to; the minimum parts markup is 5% with no maximum.
insert into public.settings (key, value, label, description)
values ('commission_people', '[]'::jsonb, 'Commission: people', 'People we pay commission to, offered as one-tap choices in the internal box of a quotation. New names typed there are added.')
on conflict (key) do nothing;
update public.settings set value = '5'::jsonb where key = 'parts_min_markup_percent';
