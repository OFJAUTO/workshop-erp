-- Zoho phase 3/4 review round (27 October 2026): the go-live switch moves the sync queue per organization.
--
-- Every Zoho id the ERP stores (customers.zoho_contact_id, invoices.zoho_invoice_id, ...) belongs to the
-- organization it was made in. At the flip those ids are OFJ TEST's: handed to the REAL organization they would
-- fail every existing customer and supplier forever. So the switch, in ONE transaction:
--   1. waits for nothing — it refuses while a row is being posted (claimed in the last ten minutes);
--   2. archives the current queue under the organization it belongs to (zoho_outbox_archive);
--   3. puts back the target organization's own archived queue (empty on the first flip);
--   4. clears every stored Zoho id, then restores the target organization's ids from its synced rows;
--   5. sets the live switch.
-- The archive is server-only like the outbox (RLS on, no policies, nothing for anon or authenticated).

create table if not exists public.zoho_outbox_archive (
  org          text not null,
  id           uuid not null,
  kind         text not null,
  record_id    uuid not null,
  job_id       uuid,
  status       text not null,
  attempts     integer not null default 0,
  last_error   text,
  zoho_id      text,
  zoho_result  jsonb,
  enqueued_at  timestamptz not null,
  synced_at    timestamptz,
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz not null default now(),
  primary key (org, kind, record_id)
);
alter table public.zoho_outbox_archive enable row level security;
revoke all on public.zoho_outbox_archive from anon, authenticated;
grant all on public.zoho_outbox_archive to service_role;

create or replace function public.zoho_switch_org(p_from text, p_to text, p_live boolean, p_by uuid)
returns jsonb
language plpgsql
as $$
declare
  n_archived integer := 0;
  n_restored integer := 0;
  n_cleared integer := 0;
  n integer;
begin
  if coalesce(p_from, '') = '' or coalesce(p_to, '') = '' then
    raise exception 'Both organizations are needed for the switch.';
  end if;
  -- New claims wait until this transaction ends; a row already being posted stops the switch.
  lock table public.zoho_outbox in exclusive mode;
  if exists (select 1 from public.zoho_outbox where claimed_at > now() - interval '10 minutes') then
    raise exception 'The sync is posting a document right now: try again in a minute.';
  end if;

  insert into public.zoho_outbox_archive as a (org, id, kind, record_id, job_id, status, attempts, last_error, zoho_id, zoho_result, enqueued_at, synced_at, created_by, updated_at, archived_at)
    select p_from, o.id, o.kind, o.record_id, o.job_id, o.status, o.attempts, o.last_error, o.zoho_id, o.zoho_result, o.enqueued_at, o.synced_at, o.created_by, o.updated_at, now()
    from public.zoho_outbox o
  on conflict (org, kind, record_id) do update set
    id = excluded.id, job_id = excluded.job_id, status = excluded.status, attempts = excluded.attempts, last_error = excluded.last_error,
    zoho_id = excluded.zoho_id, zoho_result = excluded.zoho_result, enqueued_at = excluded.enqueued_at, synced_at = excluded.synced_at,
    created_by = excluded.created_by, updated_at = excluded.updated_at, archived_at = now();
  get diagnostics n_archived = row_count;
  delete from public.zoho_outbox where id is not null;

  insert into public.zoho_outbox (id, kind, record_id, job_id, status, attempts, last_error, zoho_id, zoho_result, enqueued_at, synced_at, created_by, updated_at)
    select id, kind, record_id, job_id, status, attempts, last_error, zoho_id, zoho_result, enqueued_at, synced_at, created_by, now()
    from public.zoho_outbox_archive where org = p_to;
  get diagnostics n_restored = row_count;
  delete from public.zoho_outbox_archive where org = p_to;

  -- The stored ids follow the organization: all cleared, then the target's own put back from its synced rows.
  update public.customers set zoho_contact_id = null where zoho_contact_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.suppliers set zoho_vendor_id = null where zoho_vendor_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.invoices set zoho_invoice_id = null where zoho_invoice_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.invoices set zoho_creditnote_id = null where zoho_creditnote_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.invoices set zoho_refund_id = null where zoho_refund_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.payments set zoho_payment_id = null where zoho_payment_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.purchase_orders set zoho_bill_id = null where zoho_bill_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.purchase_orders set zoho_billpayment_id = null where zoho_billpayment_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.part_items set zoho_vendorcredit_id = null where zoho_vendorcredit_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.commission_payments set zoho_expense_id = null where zoho_expense_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;
  update public.recovery_payouts set zoho_expense_id = null where zoho_expense_id is not null; get diagnostics n = row_count; n_cleared := n_cleared + n;

  update public.customers t set zoho_contact_id = o.zoho_id from public.zoho_outbox o where o.kind = 'contact' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.suppliers t set zoho_vendor_id = o.zoho_id from public.zoho_outbox o where o.kind = 'vendor' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.invoices t set zoho_invoice_id = o.zoho_id from public.zoho_outbox o where o.kind = 'invoice' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.invoices t set zoho_creditnote_id = o.zoho_id from public.zoho_outbox o where o.kind = 'creditnote' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.invoices t set zoho_refund_id = o.zoho_result ->> 'zoho_refund_id' from public.zoho_outbox o where o.kind = 'cnrefund' and o.record_id = t.id and o.status = 'synced' and (o.zoho_result ->> 'zoho_refund_id') is not null;
  update public.payments t set zoho_payment_id = o.zoho_id from public.zoho_outbox o where o.kind in ('payment', 'deposit') and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.purchase_orders t set zoho_bill_id = o.zoho_id from public.zoho_outbox o where o.kind = 'bill' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.purchase_orders t set zoho_billpayment_id = o.zoho_id from public.zoho_outbox o where o.kind = 'billpayment' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.part_items t set zoho_vendorcredit_id = o.zoho_id from public.zoho_outbox o where o.kind = 'vendorcredit' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.commission_payments t set zoho_expense_id = o.zoho_id from public.zoho_outbox o where o.kind = 'commission' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;
  update public.recovery_payouts t set zoho_expense_id = o.zoho_id from public.zoho_outbox o where o.kind = 'recovery' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null;

  update public.settings set value = to_jsonb(p_live), updated_by = p_by where key = 'zoho_live_enabled';
  return jsonb_build_object('archived', n_archived, 'restored', n_restored, 'ids_cleared', n_cleared);
end $$;

-- The server alone runs the switch (functions default to authenticated EXECUTE since the 21 October lockdown).
revoke all on function public.zoho_switch_org(text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.zoho_switch_org(text, text, boolean, uuid) to service_role;

notify pgrst, 'reload schema';
