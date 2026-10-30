-- Complimentary jobs: a reason, the owner's approval and the full cost to us (30 October 2026, night batch section 5).
--
-- A quotation with complimentary content (a line marked Complimentary, a 100% line discount, a free recovery without a
-- PPF package, or a total of nothing) needs a reason and the owner's approval before it can be sent:
--   comp_reason            our_mistake (rework: pick the original job) / goodwill (a note is required) / warranty (pick the original job)
--   comp_original_job_id   the job being reworked or claimed under warranty (shows on Comebacks; its cost is told on that job)
--   comp_note              why (goodwill), or any note
--   comp_status            pending / approved / rejected (the owner's decision on the complimentary part)
--   comp_decided_by/_at, comp_decision_note
--   comp_normal_aed        the normal price of the complimentary lines when the owner decided (what the customer sees as the value)
--   comp_cost_aed          the cost to us when the owner decided ("Approved at AED 229 → actual AED 260" afterwards)
--   comp_cost_detail       "labour 50 · film 29 · recovery 150"
-- settings.comp_tax_invoice: false (default) = a fully complimentary job gets no tax invoice, the customer gets a job
--   completion note "No charge" (Mathew to confirm the VAT treatment of goodwill work: docs/complimentary-vat-note.md).
alter table public.quotations add column if not exists comp_reason text check (comp_reason is null or comp_reason in ('our_mistake', 'goodwill', 'warranty'));
alter table public.quotations add column if not exists comp_original_job_id uuid references public.jobs (id);
alter table public.quotations add column if not exists comp_note text;
alter table public.quotations add column if not exists comp_status text check (comp_status is null or comp_status in ('pending', 'approved', 'rejected'));
alter table public.quotations add column if not exists comp_decided_by uuid references public.staff (id);
alter table public.quotations add column if not exists comp_decided_at timestamptz;
alter table public.quotations add column if not exists comp_decision_note text;
alter table public.quotations add column if not exists comp_normal_aed numeric(12,2);
alter table public.quotations add column if not exists comp_cost_aed numeric(12,2);
alter table public.quotations add column if not exists comp_cost_detail text;
create index if not exists quotations_comp_original_idx on public.quotations (comp_original_job_id) where comp_original_job_id is not null;

insert into public.settings (key, label, value)
values ('comp_tax_invoice', 'Complimentary jobs: issue a tax invoice at AED 0', 'false'::jsonb)
on conflict (key) do nothing;

comment on column public.quotations.comp_reason is 'Why the complimentary content is free (30 Oct 2026): our_mistake / goodwill / warranty.';
notify pgrst, 'reload schema';
