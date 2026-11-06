-- Section 7 (6 November 2026): how a customer is addressed in every WhatsApp message ("Dr Jaffar", "Mr Ahmed").
-- Empty = the ERP's own rule (title + surname in normal case, else the first name). Owner and advisors edit it on the
-- customer form. The table keeps its existing RLS policies and grants; a plain column needs no new grant.
alter table public.customers add column if not exists address_as text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_address_as_length') then
    alter table public.customers add constraint customers_address_as_length check (address_as is null or char_length(address_as) between 1 and 80);
  end if;
end $$;

comment on column public.customers.address_as is 'How messages greet this customer (Dear <address_as>,). Empty = title + surname in normal case.';

notify pgrst, 'reload schema';
