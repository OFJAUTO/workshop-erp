"use client";

import { useActionState, useState } from "react";
import { closeDifferenceAction, correctSupplierPaymentAction, type PayState } from "@/app/(app)/parts/supplier-payment-actions";
import { differenceChoices } from "@/lib/supplier-payment-rules";
import { SupplierPayProof } from "@/components/SupplierPayProof";
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
/** What the payment left owing on its invoice: close it as rounding or a discount from the supplier (20 November 2026). */
function CloseDifference({ id, owed, limit }: { id: string; owed: { poId: string; label: string; due: number }; limit: number }) {
  const [state, action] = useActionState<PayState, FormData>(closeDifferenceAction.bind(null, id, owed.poId), null);
  const [kind, setKind] = useState("");
  const choices = differenceChoices(owed.due, limit).filter((c) => c.key !== "owed");
  const needsReason = !!choices.find((c) => c.key === kind)?.needsReason;
  return (
    <form action={action} className="flex flex-col gap-2 rounded-control border-2 border-amber-bar bg-amber-soft p-3" data-close-difference>
      <span className="text-sm font-bold">AED {owed.due.toFixed(2)} still owed on {owed.label}. Was it rounding or a discount from the supplier?</span>
      {choices.map((c) => (
        <label key={c.key} className={`flex min-h-11 items-start gap-2 rounded-control border bg-white px-3 py-2 text-sm ${kind === c.key ? "border-ink" : "border-line"} ${c.allowed ? "" : "opacity-55"}`} data-close-diff={c.key} data-allowed={c.allowed ? "yes" : "no"}>
          <input type="radio" name="diff_kind" value={c.key} required disabled={!c.allowed} checked={kind === c.key} onChange={() => setKind(c.key)} className="mt-1 h-4 w-4" />
          <span className="flex flex-col"><span className="font-bold">{c.label}</span><span className="text-xs text-muted">{c.allowed ? c.help : c.why}</span></span>
        </label>
      ))}
      {kind ? <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Why{needsReason ? " (compulsory)" : " (optional)"}<Input name="diff_reason" required={needsReason} minLength={needsReason ? 5 : undefined} data-close-diff-reason /></label> : null}
      <div><ConfirmSubmit label="Close the difference" title={`Close AED ${owed.due.toFixed(2)} on ${owed.label}?`} cancelLabel="GO BACK AND EDIT" lines={["The invoice is not changed; the difference is written off and the invoice closes."]} live={[{ field: "diff_kind" }]} confirmLabel="Yes, close it" hook="close-difference" /></div>
      {state?.error ? <p className="text-sm font-bold text-red" data-close-diff-error>{state.error}</p> : null}
      {state?.ok ? <p className="text-sm font-bold text-green-text" data-close-diff-done>{state.message}</p> : null}
    </form>
  );
}

export function CorrectSupplierPayment({ id, number, method, paidOn, reference, today, owed = null, roundingLimit = 1 }: { id: string; number: string; method: string; paidOn: string; reference: string | null; today: string; owed?: { poId: string; label: string; due: number } | null; roundingLimit?: number }) {
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
        <SupplierPayProof paymentId={id} inForm />
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Why is it corrected? (compulsory – kept in the history)</span><Textarea name="reason" required minLength={5} rows={2} placeholder="e.g. it was paid in cash, not by transfer" data-correct-reason /></label>
        <div>
          <ConfirmSubmit label="Save the correction" title={`Correct ${number}?`} cancelLabel="GO BACK AND EDIT" lines={[`${number}: the old values stay in its history`]} live={[{ field: "method" }, { label: "on", field: "paid_on" }, { label: "ref", field: "reference" }, { label: "why:", field: "reason" }]} confirmLabel="YES, CORRECT IT" size="md" hook="correct-payment" />
        </div>
        {state?.error ? <p className="text-sm font-bold text-red" data-correct-error>{state.error}</p> : null}
        {state?.ok ? <p className="text-sm font-bold text-green-text" data-correct-done>{state.message}</p> : null}
      </form>
      {owed && owed.due > 0.004 ? <div className="mt-2"><CloseDifference id={id} owed={owed} limit={roundingLimit} /></div> : null}
    </details>
  );
}
