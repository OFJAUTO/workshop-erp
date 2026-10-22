-- Evening batch of 21 October 2026, section 5: NOTHING changes the capitals a person typed.
-- The tidy helpers stop title-casing and sentence-casing (they only trim and collapse spaces now), so
-- every *_tidy trigger that calls them keeps "OFJ" as OFJ. Codes (plates, VINs, part numbers) still go
-- UPPER through erp_upper_code - uppercasing never destroys what was meant. Screens and PDFs keep
-- DISPLAYING names in capitals by CSS and textTransform (the 15 October rule), the stored text is the
-- person's own. The known converted names ("Ofj", "Ppf") are put back below.

create or replace function public.erp_title_case(t text) returns text language sql stable as $$
  select case when t is null then null else btrim(regexp_replace(t, '\s+', ' ', 'g')) end;
$$;

create or replace function public.erp_sentence_case(t text) returns text language sql stable as $$
  select case when t is null then null else btrim(t) end;
$$;

-- Put back what the old conversion broke: the brand words written as "Ofj"/"Ppf" become OFJ/PPF again.
-- The bodyshop packages live whole in the settings row.
update public.settings
  set value = regexp_replace(regexp_replace(value::text, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g')::jsonb
  where key = 'bodyshop_packages' and (value::text like '%Ofj%' or value::text like '%Ppf%');
update public.services set name = regexp_replace(regexp_replace(name, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g') where name like '%Ofj%' or name like '%Ppf%';
update public.quotation_lines set title = regexp_replace(regexp_replace(title, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g') where title like '%Ofj%' or title like '%Ppf%';
update public.quotation_lines set details = regexp_replace(regexp_replace(details, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g') where details like '%Ofj%' or details like '%Ppf%';
update public.quotation_lines set package_items = regexp_replace(regexp_replace(package_items::text, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g')::jsonb where package_items::text like '%Ofj%' or package_items::text like '%Ppf%';
update public.part_items set description = regexp_replace(regexp_replace(description, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g') where description like '%Ofj%' or description like '%Ppf%';
update public.part_catalogue set name = regexp_replace(regexp_replace(name, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g') where name like '%Ofj%' or name like '%Ppf%';
update public.invoice_lines set description = regexp_replace(regexp_replace(description, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g') where description like '%Ofj%' or description like '%Ppf%';
update public.suppliers set name = regexp_replace(regexp_replace(name, '\mOfj\M', 'OFJ', 'g'), '\mPpf\M', 'PPF', 'g') where name like '%Ofj%' or name like '%Ppf%';
