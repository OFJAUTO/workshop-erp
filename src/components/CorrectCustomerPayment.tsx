"use client";

import { useActionState, useState } from "react";
import { correctCustomerPaymentAction, type CorrectState } from "@/app/(app)/invoices/payment-correct-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { MoneyDate } from "@/components/MoneyDate";
import { ProofFileInput } from "@/components/ProofFileInput";
import { ChoiceButtons, Input, Textarea } from "@/components/ui";
import { showDay } from "@/lib/payment-date-rules";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card machine" },
  { value: "link", label: "Payment link" },
  { value: "transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
];
const LABEL: Record<string, string> = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));

/** Today in Dubai (outside the component: the render stays free of clock calls). */
function todayIso() {
  return new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
}

/**
 * "Correct this payment" for a CUSTOMER payment (17 November 2026, Section 3; the ONE correction window, on the job's
 * money page, the invoice page and the customer's credit). Accounts and the owner change the date, the method, the
 * reference or the proof, with a reason; the old values stay in the history. The method is NOT pre-selected (the real
 * one is picked). The amount and the customer are not here: void it and record it again for that.
 */
export function CorrectCustomerPayment({ paymentId, number, method, day, reference, allocate = null }: { paymentId: string; number: string; method: string; day: string; reference: string | null; /** 21 November 2026: the job's final document it can be put on (never ticked by itself). */ allocate?: { id: string; number: string } | null }) {
  const [state, action] = useActionState<CorrectState, FormData>(correctCustomerPaymentAction.bind(null, paymentId), null);
  const [open, setOpen] = useState(false);
  const [today] = useState(todayIso);
  const [newDay, setNewDay] = useState(day);
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="basis-full no-underline" data-correct-customer-payment={number}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-bold underline underline-offset-4 [&::-webkit-details-marker]:hidden" data-correct-open>Correct this payment</summary>
      <form action={action} className="mt-2 flex max-w-xl flex-col gap-3 rounded-control border border-line bg-white p-3" data-correct-form>
        <p className="text-xs text-muted">Now: {showDay(day)} · {LABEL[method] ?? method}{reference ? ` · ${reference}` : ""}. The amount and the customer cannot change here – void it and record it again for that.</p>
        <MoneyDate name="paid_on" label="Payment date" value={newDay} onChange={setNewDay} max={today} hook="data-correct-date" />
        {allocate ? (
          <label className="flex min-h-11 items-center gap-2 rounded-control border border-line px-3 text-sm font-semibold" data-correct-allocate>
            <input type="checkbox" name="allocate_to" value={allocate.id} className="h-5 w-5" />
            Put it on the final invoice {allocate.number} (not another deposit)
          </label>
        ) : null}
        <div data-correct-method>
          <span className="text-xs font-semibold text-muted">How was it really paid?{allocate ? " (only if it changes)" : ""}</span>
          <ChoiceButtons name="method" columns={3} required={!allocate} options={METHODS} />
        </div>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Reference</span><Input name="reference" defaultValue={reference ?? ""} spell={false} data-correct-reference /></label>
        <ProofFileInput label="New proof (optional)" required={false} name="proof" />
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Why is it corrected? (compulsory – kept in the history)</span><Textarea name="reason" required minLength={5} rows={2} placeholder="e.g. the customer paid on 14 Nov, it was recorded today" data-correct-reason /></label>
        <div>
          <ConfirmSubmit label="Save the correction" title={`Correct ${number}?`} cancelLabel="GO BACK AND EDIT" lines={[`${number}: the old values stay in its history`, "if it is already in Zoho, it is taken back and posted again"]} live={[{ label: "dated", field: "paid_on" }, { field: "method" }, { label: "ref", field: "reference" }, { label: "why:", field: "reason" }]} confirmLabel="YES, CORRECT IT" size="md" hook="correct-customer-payment" />
        </div>
        {state?.error ? <p className="text-sm font-bold text-red" data-correct-error>{state.error}</p> : null}
        {state?.ok ? <p className="text-sm font-bold text-green-text" data-correct-done>{state.message}</p> : null}
      </form>
    </details>
  );
}

/** The corrections already made (who, when, old → new, why), under the payment. */
export function PaymentCorrections({ list }: { list: { at: string; by: string; reason: string; changes: { field: string; old: string; new: string }[] }[] }) {
  if (!list.length) return null;
  return (
    <span className="basis-full flex flex-col gap-0.5 no-underline" data-payment-corrections>
      {list.map((c, i) => (
        <span key={i} className="text-xs text-muted" data-payment-correction>
          Corrected {new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} by {c.by}: {c.changes.map((x) => `${x.field} ${x.old || "—"} → ${x.new || "—"}`).join("; ")} ({c.reason})
        </span>
      ))}
    </span>
  );
}
