-- Zoho phase 3/4, second review round (27 October 2026).
--
-- 1. The go-live switch runs ONCE in the life of the books. After it, "stop" only pauses posting to the REAL book
--    (nothing is written anywhere, the queue keeps collecting) and "resume" restarts it: OFJ TEST is never written
--    again, so no REAL-era document or id can ever be handed back to the test book.
-- 2. The switch checks the state UNDER its lock (a second press, or two tabs, can never run it twice), records when
--    the books went live, removes the reconciliation rows of every day from the start date (they were compared with
--    OFJ TEST; they belong to the REAL book now and are checked again), and marks the follow-up (the replay of
--    documents from the start date) as pending until the server finishes it.
-- 3. A supplier bill keeps the VAT standing it was posted with (purchase_orders.zoho_bill_taxed): a later change of
--    the supplier's switch never re-figures history.

alter table public.purchase_orders add column if not exists zoho_bill_taxed boolean;

insert into public.settings (key, value, label, description) values
  ('zoho_went_live_at', '""'::jsonb, 'Zoho Books: went live at', 'Set once, by the go-live switch. After it OFJ TEST is never written again.'),
  ('zoho_golive_followup', '{}'::jsonb, 'Zoho Books: go-live follow-up', 'Pending while the documents from the start date are being queued for the REAL book.')
on conflict (key) do nothing;

drop function if exists public.zoho_switch_org(text, text, boolean, uuid);

create or replace function public.zoho_switch_org(p_from text, p_to text, p_live boolean, p_by uuid, p_start date)
returns jsonb
language plpgsql
as $$
declare
  n_archived integer := 0;
  n_restored integer := 0;
  n_cleared integer := 0;
  n_recon integer := 0;
  n integer;
  went text;
begin
  if coalesce(p_from, '') = '' or coalesce(p_to, '') = '' then
    raise exception 'Both organizations are needed for the switch.';
  end if;
  -- New claims wait until this transaction ends; a row already being posted stops the switch.
  lock table public.zoho_outbox in exclusive mode;
  -- Under the lock: the books may go live only once, and never twice at the same moment.
  select value #>> '{}' into went from public.settings where key = 'zoho_went_live_at';
  if coalesce(went, '') <> '' then
    raise exception 'The books already went live on %: the switch runs only once. Use Stop / Resume.', went;
  end if;
  if p_live and (select value from public.settings where key = 'zoho_live_enabled') = 'true'::jsonb then
    raise exception 'The books are already live.';
  end if;
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

  if p_live then
    -- Days from the start date belong to the REAL book now: their OFJ TEST comparisons go, and are checked again.
    if p_start is not null then
      delete from public.zoho_reconciliation where day >= p_start;
      get diagnostics n_recon = row_count;
    end if;
    update public.settings set value = to_jsonb(now()::text), updated_by = p_by where key = 'zoho_went_live_at';
    update public.settings set value = jsonb_build_object('pending', true, 'since', now()::text), updated_by = p_by where key = 'zoho_golive_followup';
  end if;
  update public.settings set value = to_jsonb(p_live), updated_by = p_by where key = 'zoho_live_enabled';
  return jsonb_build_object('archived', n_archived, 'restored', n_restored, 'ids_cleared', n_cleared, 'recon_days_reset', n_recon);
end $$;

revoke all on function public.zoho_switch_org(text, text, boolean, uuid, date) from public, anon, authenticated;
grant execute on function public.zoho_switch_org(text, text, boolean, uuid, date) to service_role;

notify pgrst, 'reload schema';
