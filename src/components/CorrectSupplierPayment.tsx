"use client";

import { useActionState, useState } from "react";
import { correctSupplierPaymentAction, type PayState } from "@/app/(app)/parts/supplier-payment-actions";
import { SupplierProofUpload } from "@/app/(app)/parts/orders/[id]/SupplierProofUpload";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { MoneyDate } from "@/components/MoneyDate";
import { ChoiceButtons, Input, Textarea } from "@/components/ui";
import { SUPPLIER_PAY_METHOD_KEYS, SUPPLIER_PAY_METHOD_LABELS } from "@/lib/supplier-payment-rules";

/**
 * "Correct this payment" (15 November 2026, Section 5): the ONE correction window for a recorded supplier payment, on
 * the LPO's payment history and on Supplier payments. Accounts and the owner change the method, date, reference or
 * proof with a reason; the old values stay in the payment's history. The method is NOT pre-selected: the person picks
 * the real one. The amount and the supplier are not here (void it and record a new payment instead).
 */
export function CorrectSupplierPayment({ id, number, method, paidOn, reference, today, proofScope }: { id: string; number: string; method: string; paidOn: string; reference: string | null; today: string; /** An LPO the payment paid (the proof is filed under it); null = no proof here. */ proofScope: string | null }) {
  const [state, action] = useActionState<PayState, FormData>(correctSupplierPaymentAction.bind(null, id), null);
  const [open, setOpen] = useState(false);
  const was = (SUPPLIER_PAY_METHOD_LABELS as Record<string, string>)[method] ?? method;
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-correct-payment={number}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-bold underline underline-offset-4 [&::-webkit-details-marker]:hidden" data-correct-open>Correct this payment</summary>
      <form action={action} className="mt-2 flex flex-col gap-3 rounded-control border border-line bg-white p-3">
        <p className="text-xs text-muted">Now: {was} · {paidOn}{reference ? ` · ${reference}` : ""}. The amount and the supplier cannot change here – void it and record a new payment for that.</p>
        <div data-correct-method>
          <span className="text-xs font-semibold text-muted">How was it really paid?</span>
          <ChoiceButtons name="method" columns={3} required options={SUPPLIER_PAY_METHOD_KEYS.map((k) => ({ value: k, label: SUPPLIER_PAY_METHOD_LABELS[k] }))} />
        </div>
        <MoneyDate name="paid_on" label="Paid on" defaultValue={paidOn} max={today} hook="data-correct-date" />
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Reference</span><Input name="reference" defaultValue={reference ?? ""} spell={false} data-correct-reference /></label>
        {proofScope ? <SupplierProofUpload poId={proofScope} inForm /> : null}
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Why is it corrected? (compulsory – kept in the history)</span><Textarea name="reason" required minLength={5} rows={2} placeholder="e.g. it was paid in cash, not by transfer" data-correct-reason /></label>
        <div>
          <ConfirmSubmit label="Save the correction" title={`Correct ${number}?`} cancelLabel="GO BACK AND EDIT" lines={[`${number}: the old values stay in its history`]} live={[{ field: "method" }, { label: "on", field: "paid_on" }, { label: "ref", field: "reference" }, { label: "why:", field: "reason" }]} confirmLabel="YES, CORRECT IT" size="md" hook="correct-payment" />
        </div>
        {state?.error ? <p className="text-sm font-bold text-red" data-correct-error>{state.error}</p> : null}
        {state?.ok ? <p className="text-sm font-bold text-green-text" data-correct-done>{state.message}</p> : null}
      </form>
    </details>
  );
}
