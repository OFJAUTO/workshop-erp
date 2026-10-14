-- The bodyshop's photos (customer updates, the handover's after picture) and the removed-items pictures are job files
-- of their own kinds. The check on job_files.kind did not know them, so every such upload was refused.
alter table public.job_files drop constraint if exists job_files_kind_check;
alter table public.job_files add constraint job_files_kind_check check (kind in (
  'work_photo', 'additional_work', 'wash_photo', 'gate_out_photo', 'delivery_photo', 'handover_photo', 'supplier_invoice', 'qc_postscan', 'return_photo',
  'bodyshop_photo', 'bodyshop_removed'
));
