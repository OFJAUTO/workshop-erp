-- 18 October 2026 (afternoon), 2: the proof photo on a payment (card slip, transfer proof).
alter table public.payments add column if not exists proof_path text;
