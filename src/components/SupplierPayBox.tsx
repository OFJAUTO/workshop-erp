"use client";

import { useActionState, useMemo, useState } from "react";
import { recordSupplierPaymentAction, type PayState } from "@/app/(app)/parts/supplier-payment-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { ChoiceButtons, Field, Input, controlClass } from "@/components/ui";
import { advanceWords, splitOldestFirst, SUPPLIER_PAY_METHOD_KEYS, SUPPLIER_PAY_METHOD_LABELS } from "@/lib/supplier-payment-rules";

type Inv = { poId: string; label: string; date: string | null; due: number; gross: number; paid: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * THE supplier payment box (6 November 2026, Section 4, Mathew): the amount actually paid (prefilled with what is due
 * incl. VAT, editable), how it is spread over the supplier's invoices (oldest first, editable), the method with payment
 * link, and what happens to any excess (an advance with the supplier, or a fee / charge). Advances already held with the
 * supplier are offered for accounts to confirm.
 */
export function SupplierPayBox({ supplierId, supplierName, invoices, advances, preselect, today }: { supplierId: string | null; supplierName: string; invoices: Inv[]; advances: { paymentId: string; number: string; left: number }[]; preselect?: string | null; today: string }) {
  const [state, action] = useActionState<PayState, FormData>(recordSupplierPaymentAction, null);
  const start = preselect ? invoices.filter((i) => i.poId === preselect) : invoices;
  const [ticked, setTicked] = useState<Set<string>>(new Set(start.map((i) => i.poId)));
  const dueTicked = r2(invoices.filter((i) => ticked.has(i.poId)).reduce((a, i) => a + i.due, 0));
  const [amountText, setAmountText] = useState(fmt(dueTicked).replace(/,/g, ""));
  const [manual, setManual] = useState<Record<string, string>>({});
  const [useAdv, setUseAdv] = useState<Record<string, boolean>>({});
  // After a payment the page sends the new dues: the box starts again from them (the answer line stays).
  const dueKey = invoices.map((i) => `${i.poId}:${i.due}`).join("|") + "#" + advances.map((a) => `${a.paymentId}:${a.left}`).join("|");
  const [seenKey, setSeenKey] = useState(dueKey);
  if (seenKey !== dueKey) {
    setSeenKey(dueKey);
    const kept = invoices.filter((i) => ticked.has(i.poId));
    const next = kept.length ? kept : start;
    setTicked(new Set(next.map((i) => i.poId)));
    setAmountText(fmt(r2(next.reduce((a, i) => a + i.due, 0))).replace(/,/g, ""));
    setManual({});
    setUseAdv({});
  }
  const amount = Number(amountText.replace(/,/g, "")) || 0;
  const advTotal = r2(advances.filter((a) => useAdv[a.paymentId]).reduce((s, a) => s + a.left, 0));
  // The spread: oldest first over the ticked invoices, unless an amount was typed by hand.
  const auto = useMemo(() => splitOldestFirst(amount, invoices.filter((i) => ticked.has(i.poId))), [amount, invoices, ticked]);
  const allocOf = (poId: string) => (manual[poId] !== undefined ? Number(manual[poId].replace(/,/g, "")) || 0 : (auto.lines.find((l) => l.poId === poId)?.amount ?? 0));
  const put = r2(invoices.filter((i) => ticked.has(i.poId)).reduce((a, i) => a + allocOf(i.poId), 0));
  const excess = r2(amount - put);
  const short = r2(dueTicked - put - advTotal);
  if (!invoices.length && !advances.length) return <p className="text-sm text-muted" data-supplier-pay-none>Nothing owed to {supplierName}.</p>;
  return (
    <form action={action} className="flex flex-col gap-3" data-supplier-pay-box>
      <input type="hidden" name="supplier_id" value={supplierId ?? ""} />
      <input type="hidden" name="supplier_name" value={supplierName} />
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
        {invoices.map((i) => (
          <li key={i.poId} className="flex flex-wrap items-center gap-2 px-3 py-2" data-supplier-pay-invoice={i.poId}>
            <label className="flex min-h-11 flex-1 items-center gap-2 text-sm">
              <input type="checkbox" checked={ticked.has(i.poId)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(i.poId); else n.delete(i.poId); setTicked(n); }} className="h-5 w-5 accent-ink" />
              <span className="font-semibold">{i.label}</span>
              <span className="text-muted">{i.date ?? ""} · due AED {fmt(i.due)}{i.paid > 0.004 ? ` (paid ${fmt(i.paid)} of ${fmt(i.gross)})` : ""}</span>
            </label>
            {ticked.has(i.poId) ? (
              <input name={`alloc__${i.poId}`} value={manual[i.poId] ?? String(allocOf(i.poId))} onChange={(e) => setManual({ ...manual, [i.poId]: e.target.value })} inputMode="decimal" aria-label={`Amount on ${i.label}`} className="h-11 w-32 rounded-control border border-line-strong px-2 text-right" data-supplier-pay-alloc={i.poId} data-spell="" />
            ) : null}
          </li>
        ))}
      </ul>
      {advances.length ? (
        <div className="flex flex-col gap-1 rounded-control border border-green bg-green-soft px-3 py-2" data-supplier-advances>
          {advances.map((a) => (
            <label key={a.paymentId} className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={!!useAdv[a.paymentId]} onChange={(e) => setUseAdv({ ...useAdv, [a.paymentId]: e.target.checked })} className="h-5 w-5 accent-ink" data-use-advance={a.number} />
              Use {advanceWords(supplierName, a.left)} ({a.number}) on these invoices
              {useAdv[a.paymentId] ? <input type="hidden" name={`advance__${a.paymentId}`} value={String(a.left)} /> : null}
            </label>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Amount paid (AED, incl. VAT)">
          {/* A plain box (not the shared delayed number box): the spread, the excess and part-paid lines follow every key. */}
          <input name="amount" value={amountText} onChange={(e) => { setAmountText(e.target.value.replace(/[^0-9.,]/g, "")); setManual({}); }} inputMode="decimal" required className={controlClass} data-spell="" data-supplier-pay-amount />
        </Field>
        <Field label="Paid on">
          <Input name="paid_on" type="date" defaultValue={today} required data-supplier-pay-date />
        </Field>
      </div>
      <Field label="How it was paid">
        <ChoiceButtons name="method" columns={3} defaultValue="transfer" options={SUPPLIER_PAY_METHOD_KEYS.map((k) => ({ value: k, label: SUPPLIER_PAY_METHOD_LABELS[k] }))} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Reference" optional>
          <Input name="reference" placeholder="Bank reference, link receipt, cheque number" />
        </Field>
        <Field label="Note" optional>
          <Input name="note" />
        </Field>
      </div>
      {excess > 0.004 ? (
        <div className="flex flex-col gap-2 rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2" data-supplier-pay-excess>
          <span className="text-sm font-bold">AED {fmt(excess)} more than the invoices. What is it?</span>
          <ChoiceButtons name="excess_kind" columns={2} defaultValue="advance" options={[{ value: "advance", label: `Advance with ${supplierName}` }, { value: "fee", label: "Fee / charge (an expense)" }]} />
        </div>
      ) : null}
      {short > 0.004 && excess <= 0.004 ? <p className="text-sm font-semibold text-amber" data-supplier-pay-short>Part paid · balance AED {fmt(short)} stays owed.</p> : null}
      {state?.error ? <p className="text-sm font-bold text-red" data-supplier-pay-error>{state.error}</p> : null}
      {state?.ok ? <p className="text-sm font-bold text-green" data-supplier-pay-done>{state.message}</p> : null}
      <div>
        <ConfirmSubmit
          label="Record the payment"
          title={`Record AED ${fmt(amount)} paid to ${supplierName}?`}
          lines={[`${ticked.size} invoice${ticked.size === 1 ? "" : "s"} · AED ${fmt(put)}`, excess > 0.004 ? `AED ${fmt(excess)} over the invoices` : short > 0.004 ? `Part paid: AED ${fmt(short)} still owed` : "Settles them in full"]}
          live={[{ field: "method" }, { label: "ref", field: "reference" }]}
          confirmLabel="Yes, record it"
          hook="supplier-pay"
          attrs={{ "data-supplier-pay-save": "" }}
        />
      </div>
    </form>
  );
}
