-- 21 October 2026, overnight part 1 section 1.1: the Record deposit panel takes SEVERAL proof files
-- (card slips, transfer screenshots). They live in job_files as their own kind, tied to the payment.
alter table public.job_files drop constraint if exists job_files_kind_check;
alter table public.job_files add constraint job_files_kind_check
  check (kind = any (array['work_photo','additional_work','wash_photo','gate_out_photo','delivery_photo','handover_photo','supplier_invoice','qc_postscan','return_photo','bodyshop_photo','bodyshop_removed','payment_proof']::text[]));
