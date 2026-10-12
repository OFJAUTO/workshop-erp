-- Every LPO gets its verification token at birth (the QR on the supplier copy).
alter table public.purchase_orders alter column verify_token set default encode(gen_random_bytes(18), 'hex');
update public.purchase_orders set verify_token = encode(gen_random_bytes(18), 'hex') where verify_token is null;
