-- 27 October 2026, Zoho phase 2 review fix: the zoho_* id columns steer where documents and attachments land in
-- Zoho, so only the server (service_role) may write them. Staff keep their ordinary updates on these tables; a
-- change to a zoho id through the user client is refused.
create or replace function public.erp_protect_zoho_ids() returns trigger
language plpgsql as $$
declare
  col text;
begin
  if current_user <> 'authenticated' then return new; end if;
  foreach col in array tg_argv loop
    if (to_jsonb(new) ->> col) is distinct from (to_jsonb(old) ->> col) then
      raise exception 'The Zoho reference (%) is set by the sync, not by hand.', col;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.erp_protect_zoho_ids() from public;

drop trigger if exists customers_zoho_protect on public.customers;
create trigger customers_zoho_protect before update on public.customers for each row execute function public.erp_protect_zoho_ids('zoho_contact_id');
drop trigger if exists invoices_zoho_protect on public.invoices;
create trigger invoices_zoho_protect before update on public.invoices for each row execute function public.erp_protect_zoho_ids('zoho_invoice_id', 'zoho_creditnote_id');
drop trigger if exists payments_zoho_protect on public.payments;
create trigger payments_zoho_protect before update on public.payments for each row execute function public.erp_protect_zoho_ids('zoho_payment_id');
drop trigger if exists suppliers_zoho_protect on public.suppliers;
create trigger suppliers_zoho_protect before update on public.suppliers for each row execute function public.erp_protect_zoho_ids('zoho_vendor_id');
drop trigger if exists purchase_orders_zoho_protect on public.purchase_orders;
create trigger purchase_orders_zoho_protect before update on public.purchase_orders for each row execute function public.erp_protect_zoho_ids('zoho_bill_id', 'zoho_billpayment_id');
drop trigger if exists commission_payments_zoho_protect on public.commission_payments;
create trigger commission_payments_zoho_protect before update on public.commission_payments for each row execute function public.erp_protect_zoho_ids('zoho_expense_id');
drop trigger if exists recovery_payouts_zoho_protect on public.recovery_payouts;
create trigger recovery_payouts_zoho_protect before update on public.recovery_payouts for each row execute function public.erp_protect_zoho_ids('zoho_expense_id');

notify pgrst, 'reload schema';
