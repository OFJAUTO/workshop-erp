-- MONEY FROM THE ESTIMATE, Part 3 (4 November 2026): changes and cancellations.
--
-- One COMBINED proforma can bill a base estimate together with its additional estimates (the advisor's
-- choice). The proforma belongs to the base (invoices.estimate_id) and names every other estimate it
-- covers here, so each estimate's page can say "billed on PRO-xxxxx with E-xxxxx" and the money is never
-- counted twice. Read only once applied (estimateCombineReady).

alter table public.invoices add column if not exists covers_estimate_ids uuid[];
create index if not exists invoices_covers_idx on public.invoices using gin (covers_estimate_ids) where covers_estimate_ids is not null;

notify pgrst, 'reload schema';
