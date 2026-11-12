-- 13 November 2026 (Section 2, option B): the stock purchases mapping pointed at Zoho's own "Inventory Asset", which
-- wants a Zoho item on every line ("Item field under stock account cannot be empty" on bill 9275779, LPO-00070,
-- MODEL AUTOMOTIVE PARTS EST). The ERP keeps the stock count; Zoho keeps only the VALUE in an Other Current Asset
-- account. OFJ TEST makes "Parts stock (ERP count)" by itself at the next Sync to Zoho.
-- Then bill 9275779 goes again at the next Sync to Zoho, and SPAY-00018 follows it (a payment waits for its bill).
-- Nothing is deleted. WAITING FOR APPLY: the owner runs it with the rest of the list (after the migration).
begin;
update public.settings
   set value = jsonb_set(value, '{purchases,stock}', to_jsonb('Parts stock (ERP count)'::text))
 where key = 'zoho_account_map'
   and coalesce(value #>> '{purchases,stock}', '') in ('', 'Inventory Asset');
update public.zoho_outbox
   set status = 'pending', last_error = null, attempts = 0, claimed_at = null, updated_at = now()
 where status = 'failed'
   and kind = 'bill'
   and (last_error ilike '%stock account%' or last_error ilike '%inventory account%');
commit;
