-- Phase 4 rule: the Parts role prices parts and sees part costs, but no customer contact details.
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
  using (not public.has_role('technician', 'workshop_manager', 'qc_inspector', 'parts'));
drop policy if exists customer_contacts_read on public.customer_contacts;
create policy customer_contacts_read on public.customer_contacts for select to authenticated
  using (not public.has_role('technician', 'workshop_manager', 'qc_inspector', 'parts'));
