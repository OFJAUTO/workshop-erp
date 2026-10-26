-- 26 October 2026: the receipt redesigned to the owner's mock. The grey note at the end of every receipt is the
-- owner's wording in Settings (a new setting needs its stored row or changes are silently dropped).
insert into public.settings (key, label, value) values
  ('receipt_footer_note', 'Receipt footer note', to_jsonb('This is a payment receipt, not a tax invoice. The tax invoice is issued when the job is paid in full, with this amount deducted.'::text))
on conflict (key) do nothing;
