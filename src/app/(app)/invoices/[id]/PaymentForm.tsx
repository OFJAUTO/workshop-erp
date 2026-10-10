"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input } from "@/components/ui";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "link", label: "Payment link" },
  { value: "cheque", label: "Cheque" },
];
const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function RecordButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="lg" disabled={pending}>{pending ? "Recording…" : label}</Button>;
}

/**
 * Three taps: the method, "Full amount" or "Partial", Record. A cheque asks for its number and date.
 * The button locks while it records; the same tap twice makes one receipt, not two. More than the
 * balance goes to the owner for approval unless the owner records it.
 */
export function PaymentForm({ invoiceId, jobId, balance, action, bankChargeCard, bankChargeLink, bankChargeCash = 0, bankChargeCheque = 0, returnTo = null, isOwner = false }: { bankChargeCash?: number; bankChargeCheque?: number; invoiceId: string | null; jobId: string | null; balance: number | null; action: (formData: FormData) => void; bankChargeCard: number; bankChargeLink: number; returnTo?: string | null; isOwner?: boolean }) {
  const [method, setMethod] = useState("cash");
  const [mode, setMode] = useState<"full" | "partial">(balance && balance > 0 ? "full" : "partial");
  const [amount, setAmount] = useState("");
  const [clientKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const charge = method === "card" ? bankChargeCard : method === "link" ? bankChargeLink : method === "cash" ? bankChargeCash : bankChargeCheque;
  const value = mode === "full" && balance ? balance : Number(amount) || 0;
  const over = balance !== null && value > balance + 0.005;
  return (
    <form action={action} className="flex flex-col gap-3">
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
      {invoiceId ? <input type="hidden" name="invoice_id" value={invoiceId} /> : null}
      {jobId ? <input type="hidden" name="job_id" value={jobId} /> : null}
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="client_key" value={clientKey} />
      <input type="hidden" name="amount" value={mode === "full" && balance ? balance.toFixed(2) : amount} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {METHODS.map((m) => (
          <button key={m.value} type="button" onClick={() => setMethod(m.value)} aria-pressed={method === m.value} className={`min-h-12 rounded-control border-2 text-sm font-bold ${method === m.value ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{m.label}</button>
        ))}
      </div>
      <p className="text-xs text-muted">{charge > 0 ? `Bank charge ${charge}% on ${METHODS.find((x) => x.value === method)?.label.toLowerCase()}${value > 0 ? ` (AED ${((value * charge) / 100).toFixed(2)})` : ""}, internal, never shown to the customer.` : `No bank charge on ${METHODS.find((x) => x.value === method)?.label.toLowerCase()}.`}</p>
      {balance && balance > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode("full")} aria-pressed={mode === "full"} className={`min-h-12 rounded-control border-2 text-sm font-bold ${mode === "full" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Full amount · {money(balance)}</button>
          <button type="button" onClick={() => setMode("partial")} aria-pressed={mode === "partial"} className={`min-h-12 rounded-control border-2 text-sm font-bold ${mode === "partial" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Partial</button>
        </div>
      ) : null}
      {mode === "partial" || !balance ? (
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Amount received (AED)</span><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="max-w-56 text-lg font-bold" /></label>
      ) : null}
      {method === "cheque" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque number</span><Input name="cheque_number" inputMode="numeric" required /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque date</span><Input name="cheque_date" type="date" required /></label>
        </div>
      ) : null}
      {method === "card" || method === "link" ? <Input name="reference" placeholder={method === "card" ? "Terminal slip number (optional)" : "Link reference (optional)"} className="max-w-72" /> : null}
      {charge ? <p className="text-xs text-muted">Bank charge {charge}% of the amount is recorded as an internal cost.</p> : null}
      {method === "cheque" ? <p className="text-xs text-muted">A cheque counts as unpaid until it is marked cleared.</p> : null}
      {over ? <p className="text-sm font-semibold text-amber">{isOwner ? "More than the balance: recorded as the owner." : "More than the balance: the owner is asked to approve it before it counts."}</p> : null}
      <div><RecordButton label={over && !isOwner ? "Request owner approval" : "Record"} /></div>
    </form>
  );
}
