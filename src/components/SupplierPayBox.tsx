"use client";

import { useActionState, useMemo, useState } from "react";
import { recordSupplierPaymentAction, type PayState } from "@/app/(app)/parts/supplier-payment-actions";
import { SupplierProofUpload } from "@/app/(app)/parts/orders/[id]/SupplierProofUpload";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { ChoiceButtons, Field, Input, controlClass } from "@/components/ui";
import { advanceLeftAfter, advanceLeftWords, likelyInvoiceOf, splitOldestFirst, suggestAdvanceUses, SUPPLIER_PAY_METHOD_KEYS, SUPPLIER_PAY_METHOD_LABELS, type AdvanceHeld, type AdvanceUse } from "@/lib/supplier-payment-rules";
import { MoneyDate } from "@/components/MoneyDate";

type Inv = { poId: string; label: string; date: string | null; due: number; gross: number; paid: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numOf = (t: string) => Number(String(t).replace(/,/g, "")) || 0;

/**
 * THE supplier payment box (6 November 2026, Section 4, Mathew; advances reworked 11 November 2026, Section 3).
 * Tick the invoices. Tick an advance held with the supplier and say how much of it goes on each ticked invoice
 * (suggested: its likely invoice first, then the rest oldest first; "Left on this advance" moves with every key).
 * Only what the advances leave unpaid needs a new payment: the amount and how it was paid show for that remainder
 * alone. Advances covering everything = "Apply advance", no new payment, nothing red to fill in.
 */
export function SupplierPayBox({ supplierId, supplierName, invoices, advances, preselect, today, paidFromWords, proofScope }: { supplierId: string | null; supplierName: string; invoices: Inv[]; advances: AdvanceHeld[]; preselect?: string | null; today: string; paidFromWords?: string; proofScope?: string | null }) {
  const [state, action] = useActionState<PayState, FormData>(recordSupplierPaymentAction, null);
  const start = preselect ? invoices.filter((i) => i.poId === preselect) : invoices;
  const [ticked, setTicked] = useState<Set<string>>(new Set(start.map((i) => i.poId)));
  const [useAdv, setUseAdv] = useState<Set<string>>(new Set());
  // Typed advance amounts per "<advance>|<invoice>" (unset = the suggestion).
  const [advTyped, setAdvTyped] = useState<Record<string, string>>({});
  const [amountText, setAmountText] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  // After a payment the page sends the new dues: the box starts again from them (the answer line stays).
  const dueKey = invoices.map((i) => `${i.poId}:${i.due}`).join("|") + "#" + advances.map((a) => `${a.paymentId}:${a.left}`).join("|");
  const [seenKey, setSeenKey] = useState(dueKey);
  if (seenKey !== dueKey) {
    setSeenKey(dueKey);
    const kept = invoices.filter((i) => ticked.has(i.poId));
    setTicked(new Set((kept.length ? kept : start).map((i) => i.poId)));
    setUseAdv(new Set());
    setAdvTyped({});
    setAmountText(null);
    setManual({});
  }
  const tickedInv = invoices.filter((i) => ticked.has(i.poId));
  const usedAdv = advances.filter((a) => useAdv.has(a.paymentId));
  const suggested = useMemo(() => suggestAdvanceUses(usedAdv, tickedInv), [usedAdv, tickedInv]);
  const uses: AdvanceUse[] = usedAdv.flatMap((a) =>
    tickedInv
      .map((i) => {
        const k = `${a.paymentId}|${i.poId}`;
        const amount = advTyped[k] !== undefined ? numOf(advTyped[k]) : (suggested.find((u) => u.paymentId === a.paymentId && u.poId === i.poId)?.amount ?? 0);
        return { paymentId: a.paymentId, poId: i.poId, amount: r2(amount) };
      })
      .filter((u) => u.amount > 0.004),
  );
  const leftAfter = advanceLeftAfter(usedAdv, uses);
  const advOn = (poId: string) => r2(uses.filter((u) => u.poId === poId).reduce((s, u) => s + u.amount, 0));
  const dueTicked = r2(tickedInv.reduce((a, i) => a + i.due, 0));
  const advTotal = r2(uses.reduce((s, u) => s + u.amount, 0));
  const remainder = r2(Math.max(0, dueTicked - advTotal));
  const amount = amountText === null ? remainder : numOf(amountText);
  const shownAmount = amountText ?? (remainder > 0 ? remainder.toFixed(2) : "");
  // The new money spread over what each ticked invoice still owes after the advances, oldest first (or as typed).
  const afterAdv = tickedInv.map((i) => ({ ...i, due: r2(Math.max(0, i.due - advOn(i.poId))) }));
  const auto = splitOldestFirst(amount, afterAdv);
  const allocOf = (poId: string) => (manual[poId] !== undefined ? numOf(manual[poId]) : (auto.lines.find((l) => l.poId === poId)?.amount ?? 0));
  const put = r2(tickedInv.reduce((a, i) => a + allocOf(i.poId), 0));
  const excess = r2(amount - put);
  const short = r2(dueTicked - advTotal - put);
  // A new payment only when the advances leave something, or accounts typed an amount (or there is no advance at all).
  const newMoney = remainder > 0.004 || amount > 0.004 || !usedAdv.length;
  const overAdvance = Array.from(leftAfter.values()).some((v) => v < -0.004);
  return (
    <form action={action} className="flex flex-col gap-3" data-supplier-pay-box>
      <input type="hidden" name="supplier_id" value={supplierId ?? ""} />
      <input type="hidden" name="supplier_name" value={supplierName} />
      {!invoices.length ? <p className="text-sm text-muted" data-supplier-pay-none>No invoice due to {supplierName} yet. What you record here is kept as an advance with them.</p> : null}
      {invoices.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
          {invoices.map((i) => (
            <li key={i.poId} className="flex flex-wrap items-center gap-2 px-3 py-2" data-supplier-pay-invoice={i.poId}>
              <label className="flex min-h-11 flex-1 items-center gap-2 text-sm">
                <input type="checkbox" checked={ticked.has(i.poId)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(i.poId); else n.delete(i.poId); setTicked(n); setAmountText(null); setManual({}); }} className="h-5 w-5 accent-ink" />
                <span className="font-semibold">{i.label}</span>
                <span className="text-muted">{i.date ?? ""} · due AED {fmt(i.due)}{i.paid > 0.004 ? ` (paid ${fmt(i.paid)} of ${fmt(i.gross)})` : ""}</span>
              </label>
              {ticked.has(i.poId) && newMoney ? (
                <input name={`alloc__${i.poId}`} value={manual[i.poId] ?? String(allocOf(i.poId))} onChange={(e) => setManual({ ...manual, [i.poId]: e.target.value })} inputMode="decimal" aria-label={`New payment on ${i.label}`} className="h-11 w-32 rounded-control border border-line-strong px-2 text-right" data-supplier-pay-alloc={i.poId} data-spell="" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {advances.length && invoices.length ? (
        <div className="flex flex-col gap-2 rounded-control border border-green bg-green-soft px-3 py-2" data-supplier-advances>
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-green-text">Advances held with {supplierName}</span>
          {advances.map((a) => {
            const likely = likelyInvoiceOf(a, invoices);
            const likelyLabel = invoices.find((i) => i.poId === likely)?.label ?? null;
            const on = useAdv.has(a.paymentId);
            const left = leftAfter.get(a.paymentId) ?? 0;
            return (
              <div key={a.paymentId} className="flex flex-col gap-1" data-advance-block={a.number}>
                <label className="flex min-h-11 flex-wrap items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={on} onChange={(e) => { const n = new Set(useAdv); if (e.target.checked) n.add(a.paymentId); else n.delete(a.paymentId); setUseAdv(n); setAmountText(null); setManual({}); }} className="h-5 w-5 accent-ink" data-use-advance={a.number} />
                  {a.number} · AED {fmt(a.left)}
                  {likelyLabel ? <span className="text-xs font-semibold text-muted" data-advance-likely={likely ?? ""}>likely for {likelyLabel}</span> : null}
                </label>
                {on ? (
                  <div className="flex flex-col gap-1 pl-7">
                    {tickedInv.map((i) => {
                      const k = `${a.paymentId}|${i.poId}`;
                      const sug = suggested.find((u) => u.paymentId === a.paymentId && u.poId === i.poId)?.amount ?? 0;
                      return (
                        <label key={k} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1">on {i.label}</span>
                          <input name={`use__${a.paymentId}__${i.poId}`} value={advTyped[k] ?? (sug > 0 ? sug.toFixed(2) : "")} placeholder="0.00" onChange={(e) => { setAdvTyped({ ...advTyped, [k]: e.target.value.replace(/[^0-9.,]/g, "") }); setAmountText(null); setManual({}); }} inputMode="decimal" aria-label={`From ${a.number} on ${i.label}`} className="h-11 w-32 rounded-control border border-line-strong bg-white px-2 text-right" data-advance-use={`${a.number}|${i.poId}`} data-spell="" />
                        </label>
                      );
                    })}
                    <span className={`text-sm font-bold ${left < -0.004 ? "text-red" : "text-green-text"}`} data-advance-left={a.number} data-advance-left-aed={left.toFixed(2)}>
                      {left < -0.004 ? `More than ${a.number} holds (AED ${fmt(a.left)})` : advanceLeftWords(left)}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {newMoney ? (
        <>
          {usedAdv.length ? <p className="text-sm font-semibold" data-supplier-pay-remainder>The advances leave AED {fmt(remainder)} to pay.</p> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={usedAdv.length ? "Amount paid now (AED, incl. VAT)" : "Amount paid (AED, incl. VAT)"}>
              {/* A plain box (not the shared delayed number box): the spread, the excess and part-paid lines follow every key. */}
              <input name="amount" value={shownAmount} onChange={(e) => { setAmountText(e.target.value.replace(/[^0-9.,]/g, "")); setManual({}); }} inputMode="decimal" required className={controlClass} data-spell="" data-supplier-pay-amount />
            </Field>
            <MoneyDate name="paid_on" label="Paid on" defaultValue={today} max={today} hook="data-supplier-pay-date" />
          </div>
          <Field label="How it was paid">
            <div data-pay-method>
              <ChoiceButtons name="method" columns={3} defaultValue="transfer" options={SUPPLIER_PAY_METHOD_KEYS.map((k) => ({ value: k, label: SUPPLIER_PAY_METHOD_LABELS[k] }))} />
              {paidFromWords ? <p className="pt-1 text-xs text-muted" data-pay-paid-from>Paid from in Zoho — {paidFromWords}</p> : null}
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Reference" optional>
              <Input name="reference" placeholder="Bank reference, link receipt, cheque number" />
            </Field>
            <Field label="Note" optional>
              <Input name="note" />
            </Field>
          </div>
          {proofScope ? (
            <div className="flex flex-col gap-1 rounded-control border border-dashed border-line-strong p-3" data-pay-proof-area>
              <span className="text-xs font-semibold text-muted">Proof (bank slip, card slip, link receipt, cheque copy) – optional now, or add it later</span>
              <SupplierProofUpload poId={proofScope} inForm />
            </div>
          ) : null}
          {excess > 0.004 ? (
            <div className="flex flex-col gap-2 rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2" data-supplier-pay-excess>
              <span className="text-sm font-bold">AED {fmt(excess)} more than the invoices. What is it?</span>
              <ChoiceButtons name="excess_kind" columns={2} defaultValue="advance" options={[{ value: "advance", label: `Advance with ${supplierName}` }, { value: "fee", label: "Fee / charge (an expense)" }]} />
            </div>
          ) : null}
          {short > 0.004 && excess <= 0.004 ? <p className="text-sm font-semibold text-amber-text" data-supplier-pay-short>Part paid · balance AED {fmt(short)} stays owed.</p> : null}
        </>
      ) : (
        <>
          {/* No new payment: the advances settle everything ticked. */}
          <input type="hidden" name="paid_on" value={today} />
          <input type="hidden" name="amount" value="0" />
          <p className="text-sm font-semibold text-green-text" data-supplier-pay-covered>The advances cover the ticked invoices: no new payment is needed.</p>
        </>
      )}
      {state?.error ? <p className="text-sm font-bold text-red" data-supplier-pay-error>{state.error}</p> : null}
      {state?.ok ? <p className="text-sm font-bold text-green-text" data-supplier-pay-done>{state.message}</p> : null}
      <div>
        <ConfirmSubmit
          label={newMoney ? (usedAdv.length ? "Apply advance and record the payment" : "Record the payment") : "Apply advance"}
          title={newMoney ? `Record AED ${fmt(amount)} paid to ${supplierName}${usedAdv.length ? ` and apply AED ${fmt(advTotal)} of advances` : ""}?` : `Apply AED ${fmt(advTotal)} of advances to ${supplierName}'s invoices?`}
          lines={[
            ...usedAdv.map((a) => `${a.number}: AED ${fmt(r2(a.left - (leftAfter.get(a.paymentId) ?? 0)))} used · ${advanceLeftWords(leftAfter.get(a.paymentId) ?? 0)}`),
            newMoney ? `${ticked.size} invoice${ticked.size === 1 ? "" : "s"} · new payment AED ${fmt(put)}` : "No new payment",
            short > 0.004 && excess <= 0.004 ? `Part paid: AED ${fmt(short)} still owed` : excess > 0.004 ? `AED ${fmt(excess)} over the invoices` : "Settles them in full",
          ]}
          live={newMoney ? [{ field: "method" }, { label: "ref", field: "reference" }, ...(proofScope ? [{ field: "proof_path", proof: true }] : [])] : []}
          confirmLabel={newMoney ? "Yes, record it" : "Yes, apply it"}
          hook="supplier-pay"
          attrs={{ "data-supplier-pay-save": "", ...(overAdvance ? { "data-over-advance": "" } : {}) }}
        />
      </div>
    </form>
  );
}
