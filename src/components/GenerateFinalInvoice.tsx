"use client";

import Link from "next/link";
import { useActionState } from "react";
import { generateFinalTaxInvoiceAction, type FinalState } from "@/app/(app)/invoices/final-invoice-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * "Generate the final tax invoice" (21 November 2026, J-01013): accounts and the owner, once the job is done, whether or
 * not the balance is paid. The answer shows here, next to the button.
 */
export function GenerateFinalInvoice({ jobId, advanceNumbers, jobTotal, advanceTotal, paid }: { jobId: string; advanceNumbers: string; jobTotal: number; advanceTotal: number; paid: number }) {
  const [state, action] = useActionState<FinalState, FormData>(generateFinalTaxInvoiceAction.bind(null, jobId), null);
  const thisInvoice = Math.max(0, Math.round((jobTotal - advanceTotal) * 100) / 100);
  const due = Math.max(0, Math.round((jobTotal - paid) * 100) / 100);
  return (
    <form action={action} className="flex flex-col gap-2 rounded-control border-2 border-ink bg-white p-3" data-generate-final>
      <p className="text-sm font-semibold">
        The job is done. {advanceNumbers} is the advance tax invoice only: the final tax invoice carries the real lines (job total {aed(jobTotal)}), takes off the advance {aed(advanceTotal)} and invoices {aed(thisInvoice)}{due > 0.004 ? `; ${aed(due)} is still to pay` : " – already paid in full"}.
      </p>
      {state?.ok ? (
        <p className="text-sm font-bold text-green-text" data-generate-final-done>
          {state.message} <Link href={`/jobs/${jobId}/invoice`} className="underline underline-offset-4">Refresh</Link>
        </p>
      ) : (
        <div>
          <ConfirmSubmit
            label="Generate the final tax invoice"
            title="Generate the final tax invoice?"
            cancelLabel="GO BACK"
            lines={[`Job total ${aed(jobTotal)}`, `Less the advance already invoiced (${advanceNumbers}) ${aed(advanceTotal)}`, `This invoice ${aed(thisInvoice)}`, "A tax invoice is never cancelled or deleted: corrections are by credit note"]}
            confirmLabel="YES, GENERATE IT"
            hook="generate-final"
          />
        </div>
      )}
      {state?.error ? <p className="text-sm font-bold text-red" data-generate-final-error>{state.error}</p> : null}
    </form>
  );
}
