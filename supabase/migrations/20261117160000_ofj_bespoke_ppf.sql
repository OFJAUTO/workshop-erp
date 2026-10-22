-- Overnight batch 22 to 23 October 2026, section 8: the PPF product is called "OFJ Bespoke". The brand line on
-- the quotation, handover, warranty card and invoice reads "OFJ Bespoke PPF"; the warranty texts that named the
-- product "OFJ PPF" name it the same way. The cutting methods no longer use the word Bespoke (code).
update public.settings set value = to_jsonb('OFJ Bespoke PPF'::text) where key = 'ppf_brand_name' and value = to_jsonb('OFJ PPF'::text);
update public.settings set value = replace(value::text, 'OFJ PPF ', 'OFJ Bespoke PPF ')::jsonb where key in ('ppf_warranty_text', 'warranty_terms') and value::text like '%OFJ PPF %';
