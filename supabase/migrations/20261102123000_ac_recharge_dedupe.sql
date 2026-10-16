-- 16 October 2026: the A/C gas recharge service lives under Servicing (the copy under Air conditioning is retired).
update public.services set is_active = false where is_active and lower(name) like 'a/c gas recharge%' and category_id in (select id from public.service_categories where lower(name) = 'air conditioning');
