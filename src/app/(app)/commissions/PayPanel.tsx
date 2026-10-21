"use client";

import { useMemo, useState } from "react";
import { Button, Input } from "@/components/ui";

type ReadyRow = { quotationId: string; recipient: string; amount: number; label: string; sub: string };

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Section 2 (21 October): pay one or several READY commissions of one person in one payment.
 * Tick the rows (one recipient at a time), pick Cash or Bank transfer and the date; the amount is
 * pre-filled from the ticks. Cash prints a voucher to sign; a transfer wants its reference.
 */
export function PayPanel({ rows, action, today, isOwner }: { rows: ReadyRow[]; action: (formData: FormData) => Promise<void>; today: string; isOwner: boolean }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [amount, setAmount] = useState("");
  const recipient = useMemo(() => rows.find((r) => ticked.has(r.quotationId))?.recipient ?? null, [rows, ticked]);
  const total = useMemo(() => Math.round(rows.filter((r) => ticked.has(r.quotationId)).reduce((a, r) => a + r.amount, 0) * 100) / 100, [rows, ticked]);
  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <form action={action} className="flex flex-col gap-3" data-pay-panel>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const off = !!recipient && r.recipient !== recipient;
          return (
            <li key={r.quotationId} className={`py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${off ? "opacity-40" : ""}`} data-commission-row={r.label.split(" ")[0]}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="ids" value={r.quotationId} checked={ticked.has(r.quotationId)} disabled={off} onChange={() => toggle(r.quotationId)} className="h-5 w-5 accent-ink" data-pay-tick={r.quotationId} />
                <span className="font-bold">{r.recipient}</span>
              </label>
              <span className="text-muted">{r.sub}</span>
              <span className="ml-auto font-extrabold">{aed(r.amount)}</span>
            </li>
          );
        })}
      </ul>
      {ticked.size ? (
        <div className="flex flex-wrap items-end gap-3 rounded-card border-2 border-ink bg-white p-3" data-pay-box>
          <span className="text-sm font-bold">Pay {recipient}: {ticked.size} commission{ticked.size === 1 ? "" : "s"}</span>
          <div className="flex gap-2">
            {(["cash", "transfer"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} data-pay-method={m} className={`min-h-11 rounded-control border-2 px-4 text-sm font-bold ${method === m ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                {m === "cash" ? "Cash" : "Bank transfer"}
              </button>
            ))}
          </div>
          <input type="hidden" name="method" value={method} />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Date</span>
            <Input name="paid_on" type="date" defaultValue={today} required className="w-40" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Amount (AED)</span>
            <Input name="amount" inputMode="decimal" value={amount || String(total)} onChange={(e) => setAmount(e.target.value)} readOnly={!isOwner} className="w-32 text-right font-bold" data-pay-amount />
          </label>
          {method === "transfer" ? (
            <label className="flex flex-col gap-1 min-w-56 flex-1">
              <span className="text-xs font-semibold text-muted">Transfer reference (required)</span>
              <Input name="reference" required placeholder="Bank reference" data-pay-reference />
            </label>
          ) : null}
          <label className="flex flex-col gap-1 min-w-48 flex-1">
            <span className="text-xs font-semibold text-muted">Note (optional)</span>
            <Input name="note" placeholder="Anything worth writing down" />
          </label>
          <Button type="submit" size="lg" data-pay-save>{method === "cash" ? "Record cash payment (voucher follows)" : "Record transfer"}</Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Tick the commissions to pay. One payment covers one person; ticking someone greys the others out.</p>
      )}
    </form>
  );
}
