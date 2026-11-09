"use client";

import { useActionState } from "react";
import { voidSupplierPaymentAction, type PayState } from "@/app/(app)/parts/supplier-payment-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Input } from "@/components/ui";
import { SUPPLIER_PAY_METHOD_LABELS, type SupplierPayMethod } from "@/lib/supplier-payment-rules";

type Row = { id: string; number: string; paidOn: string; method: string; reference: string | null; amount: number; onThis: number; status: string; voidReason: string | null; laterAdvance: boolean };
const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The payments on one supplier invoice (6 November 2026): who, when, how, how much; Void with a remark (owner, accounts). */
export function SupplierPaymentHistory({ rows, canChange }: { rows: Row[]; canChange: boolean }) {
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col gap-2" data-supplier-pay-history>
      {rows.map((r) => (
        <li key={`${r.id}-${r.onThis}`} className={`flex flex-col gap-1 rounded-control border px-3 py-2 text-sm ${r.status === "void" ? "border-line bg-canvas text-muted line-through" : "border-line"}`} data-supplier-pay-row={r.number}>
          <span className="font-semibold">
            {r.number} · {r.paidOn} · {SUPPLIER_PAY_METHOD_LABELS[r.method as SupplierPayMethod] ?? r.method}{r.reference ? ` · ${r.reference}` : ""} · AED {fmt(r.onThis)} on this invoice{Math.abs(r.amount - r.onThis) > 0.004 ? ` (payment AED ${fmt(r.amount)})` : ""}{r.laterAdvance ? " · from an advance" : ""}
          </span>
          {r.status === "void" ? <span className="text-xs no-underline">Voided: {r.voidReason}</span> : canChange ? <VoidForm id={r.id} number={r.number} /> : null}
        </li>
      ))}
    </ul>
  );
}

function VoidForm({ id, number }: { id: string; number: string }) {
  const [state, action] = useActionState<PayState, FormData>(voidSupplierPaymentAction.bind(null, id), null);
  return (
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-bold text-red underline underline-offset-4 [&::-webkit-details-marker]:hidden">Void {number}</summary>
      <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
        <Input name="remark" required minLength={5} placeholder="Why? (stays in the history)" className="w-72" aria-label={`Why void ${number}`} />
        <ConfirmSubmit label="Void" title={`Void ${number}?`} lines={["Its invoices are unpaid again; if it reached Zoho Books, the payment is taken back there too."]} live={[{ label: "why:", field: "remark" }]} confirmLabel="Yes, void it" tone="danger" size="md" hook="supplier-pay-void" />
        {state?.error ? <span className="text-xs font-bold text-red">{state.error}</span> : null}
        {state?.ok ? <span className="text-xs font-bold text-green-text">{state.message}</span> : null}
      </form>
    </details>
  );
}
