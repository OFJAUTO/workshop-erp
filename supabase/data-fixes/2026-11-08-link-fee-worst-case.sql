-- Section 9 (8 November 2026): estimate payment-link fees at the worst case, 2.25% + AED 1 + VAT (STL-00012), until
-- Network International confirms the real rate. Only the stored setting moves (from 1.75 only); recorded settlements and
-- recorded payments are never changed; the real fee from each settlement still replaces the estimate. The owner can
-- change it again on Card settlements -> Bank fees.
update public.settings set value = to_jsonb(2.25::numeric)
 where key = 'bank_charge_link_percent' and value = to_jsonb(1.75::numeric);
