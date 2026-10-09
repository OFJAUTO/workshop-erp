"use client";

import { useState } from "react";
import { Button, Input, Textarea } from "@/components/ui";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "link", label: "Payment link" },
  { value: "cheque", label: "Cheque" },
];

/** Record a payment: method as one-tap buttons, the amount, a reference, cheque details when needed. */
export function PaymentForm({ invoiceId, jobId, balance, action, bankChargeCard, bankChargeLink, returnTo = null }: { invoiceId: string | null; jobId: string | null; balance: number | null; action: (formData: FormData) => void; bankChargeCard: number; bankChargeLink: number; returnTo?: string | null }) {
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(balance && balance > 0 ? balance.toFixed(2) : "");
  const charge = method === "card" ? bankChargeCard : method === "link" ? bankChargeLink : 0;
  return (
    <form action={action} className="flex flex-col gap-3">
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
      {invoiceId ? <input type="hidden" name="invoice_id" value={invoiceId} /> : null}
      {jobId ? <input type="hidden" name="job_id" value={jobId} /> : null}
      <input type="hidden" name="method" value={method} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {METHODS.map((m) => (
          <button key={m.value} type="button" onClick={() => setMethod(m.value)} aria-pressed={method === m.value} className={`min-h-12 rounded-control border-2 text-sm font-bold ${method === m.value ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{m.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Amount received (AED)</span><Input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Reference <span className="font-medium">(optional)</span></span><Input name="reference" placeholder={method === "card" ? "Terminal slip number" : method === "link" ? "Link reference" : "Note"} /></label>
      </div>
      {method === "cheque" ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque number</span><Input name="cheque_number" required /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Bank</span><Input name="cheque_bank" required /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque date</span><Input name="cheque_date" type="date" required /></label>
        </div>
      ) : null}
      {charge ? <p className="text-xs text-muted">Bank charge {charge}% of the amount is recorded as an internal cost.</p> : null}
      {method === "cheque" ? <p className="text-xs text-muted">A cheque counts as unpaid until it is marked cleared.</p> : null}
      <Textarea name="notes" rows={1} placeholder="Note (optional)" />
      <div><Button type="submit" size="lg">Record payment</Button></div>
    </form>
  );
}
