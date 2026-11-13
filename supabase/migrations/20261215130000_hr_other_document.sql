-- 13 November 2026 (Section 13): HR "Other document" with its own name (e.g. Trade licence, Medical fitness).
-- Server-only table already (RLS on, no policies, no grants to the login role); nothing else changes.
alter table public.hr_documents drop constraint if exists hr_documents_kind_check;
alter table public.hr_documents add constraint hr_documents_kind_check
  check (kind in ('photo', 'emirates_id', 'passport', 'visa', 'labour_card', 'health_insurance', 'driving_licence', 'other'));
alter table public.hr_documents add column if not exists other_label text;
alter table public.hr_documents drop constraint if exists hr_documents_other_label_check;
alter table public.hr_documents add constraint hr_documents_other_label_check
  check ((kind = 'other') = (other_label is not null and length(trim(other_label)) >= 2));
notify pgrst, 'reload schema';
