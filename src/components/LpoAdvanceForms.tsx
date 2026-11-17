"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Input } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { SupplierPayProof } from "@/components/SupplierPayProof";
import { newUuid } from "@/lib/uuid";

/**
 * "Pay in advance" (13 November 2026, Section 4): ONE window used on the LPO page, the Supplier invoices card and
 * Supplier payments. Owner and accounts record an advance for an LPO still waiting for its invoice: amount (the LPO
 * total suggested), method, date, reference, proof. The customer's deposit on the job is shown beside it.
 */
export function PayInAdvanceButton({ poId, poNumber, supplier, suggest, today, depositWords, methods, action }: { poId: string; poNumber: string; supplier: string; suggest: number; today: string; depositWords: string; methods: { value: string; label: string }[]; action: FormAction }) {
  const [open, setOpen] = useState(false);
  // 17 November 2026 (Section 1): the advance is saved under this id, so its proof belongs to the PAYMENT.
  const [paymentKey, setPaymentKey] = useState(() => newUuid());
  return (
    <>
      <button type="button" onClick={() => { setPaymentKey(newUuid()); setOpen(true); }} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-pay-in-advance={poId}>Pay in advance</button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={() => setOpen(false)}>
          <div className="flex w-full max-w-lg max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} data-pay-advance-window>
            <span className="text-lg font-extrabold">Pay in advance · {poNumber}</span>
            <p className="text-sm text-muted">{supplier} · before the invoice. When the invoice is entered, accounts apply this advance to it with one tap.</p>
            <p className="rounded-control bg-chip px-3 py-2 text-sm font-semibold" data-customer-deposit>{depositWords}</p>
            <ActionForm action={action} className="flex flex-col gap-3">
              {(v, state) =>
                state.success ? (
                  <div className="flex flex-col gap-2">
                    <p className="rounded-control bg-green-soft px-3 py-2 text-sm font-semibold text-green-text" data-pay-advance-done>{state.success}</p>
                    <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-control border border-line-strong px-4 text-sm font-bold">Close</button>
                  </div>
                ) : (
                  <>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Amount paid (incl. VAT)
                      <Input name="amount" defaultValue={v.amount ?? suggest.toFixed(2)} inputMode="decimal" required data-advance-amount />
                    </label>
                    <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">How was it paid?</span><ChoiceButtons name="method" required options={methods} /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Date<Input type="date" name="paid_on" defaultValue={v.paid_on ?? today} max={today} required data-advance-date /></label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Reference (optional)<Input name="reference" defaultValue={v.reference ?? ""} placeholder="transfer ref, cheque no…" data-advance-reference /></label>
                    </div>
                    <input type="hidden" name="payment_key" value={paymentKey} />
                    <SupplierPayProof paymentId={paymentKey} inForm />
                    <ConfirmSubmit label="Record the advance" title={`Record an advance to ${supplier}?`} lines={[`for ${poNumber}`, "the parts desk is told to confirm the order"]} live={[{ label: "AED", field: "amount" }, { field: "method" }, { field: "proof_path", proof: true }]} confirmLabel="Yes, record it" hook="pay-advance" />
                  </>
                )
              }
            </ActionForm>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** The parts desk: "Supplier needs payment first" (accounts get the task). */
export function PayFirstForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2" >
      {() => (
        <>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-semibold text-muted">Supplier needs payment first – note for accounts (optional)<Input name="note" placeholder="special order, pay before ordering…" data-pay-first-note /></label>
          <SubmitButton tone="secondary" data-pay-first>Supplier needs payment first</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** One tap after the invoice is entered: the advance pays it. */
export function ApplyAdvanceForm({ action, words }: { action: FormAction; words: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-center gap-2">
      {() => (
        <>
          <span className="text-sm font-semibold">{words}</span>
          <SubmitButton data-apply-lpo-advance>Apply the advance to this invoice</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
