"use client";

import { ActionForm, type FormAction } from "@/components/forms";
import { Button, Input } from "@/components/ui";

/**
 * 8.1 (3 November 2026): the real cost of a charge on a quotation, from the supplier's bill, with the supplier and their
 * TRN. Typed in the Charges section; the answer appears right here. An empty cost goes back to the quoted estimate.
 */
export function QuoteChargeCostForm({ action, cost, provider, trn, quoted }: { action: FormAction; cost: number | null; provider: string | null; trn: string | null; quoted: number | null }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2" initialValues={{ cost: cost !== null ? String(cost) : "", provider: provider ?? "", trn: trn ?? "" }}>
      {(values) => (
        <div className="flex flex-wrap items-end gap-2" data-charge-cost-form>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Real cost from the bill (AED, before VAT)
            <Input name="cost" defaultValue={values.cost} inputMode="decimal" placeholder={quoted !== null ? `quoted ${quoted.toFixed(2)}` : ""} className="w-40" data-charge-cost-input />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Supplier
            <Input name="provider" defaultValue={values.provider} textCase="upper" placeholder="Recovery company, station…" className="w-56" data-charge-cost-provider />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Supplier TRN
            <Input name="trn" defaultValue={values.trn} inputMode="numeric" placeholder="If VAT registered" className="w-44" />
          </label>
          <Button type="submit" size="lg" data-charge-cost-save>Save the cost</Button>
        </div>
      )}
    </ActionForm>
  );
}
