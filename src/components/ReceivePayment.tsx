"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Input } from "@/components/ui";
import { leftoverWords, splitPayment, type OpenDoc } from "@/lib/combined-pay-rules";
import { receivePaymentAction } from "@/app/(app)/customers/[id]/receive-actions";
import { newUuid } from "@/lib/uuid";

/*
 * Receive payment from the customer (9 November 2026, Section 3; AL ALI paid two Corollas with ONE cheque). ONE window
 * on the customer page: every open proforma and invoice of the customer, the one amount spread OLDEST FIRST (each share
 * can be changed), what is left over becomes an advance on the account. "Replace with combined payment" (from a
 * receipt) also ticks the earlier receipts of the same cheque to void them, with the reason.
 */

export type ReceiveDoc = OpenDoc & { title: string };
export type ReplaceableReceipt = { id: string; number: string; amount: number; method: string; chequeNumber: string | null; job: string | null; status: string };

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHODS = [["cheque", "Cheque"], ["transfer", "Bank transfer"], ["cash", "Cash"], ["card", "Card"], ["link", "Payment link"]] as const;

export function ReceivePaymentButton({ customerId, docs, receipts, ready, openOnLoad = false, firstJobTitle = null, replaceId = null }: { customerId: string; docs: ReceiveDoc[]; receipts: ReplaceableReceipt[]; ready: boolean; openOnLoad?: boolean; firstJobTitle?: string | null; replaceId?: string | null }) {
  const [open, setOpen] = useState(openOnLoad);
  return (
    <>
      <Button type="button" size="lg" onClick={() => setOpen(true)} data-receive-payment>Receive payment</Button>
      {open ? <ReceiveWindow customerId={customerId} docs={docs} receipts={receipts} ready={ready} firstJobTitle={firstJobTitle} replaceId={replaceId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ReceiveWindow({ customerId, docs, receipts, ready, firstJobTitle, replaceId, onClose }: { customerId: string; docs: ReceiveDoc[]; receipts: ReplaceableReceipt[]; ready: boolean; firstJobTitle: string | null; replaceId: string | null; onClose: () => void }) {
  const replaceFrom = receipts.find((r) => r.id === replaceId) ?? null;
  const [method, setMethod] = useState<string>(replaceFrom?.method ?? "cheque");
  const [amountText, setAmountText] = useState("");
  const [shares, setShares] = useState<Record<string, string> | null>(null);
  const [replace, setReplace] = useState<Set<string>>(() => new Set(replaceFrom ? receipts.filter((r) => r.id === replaceFrom.id || (!!replaceFrom.chequeNumber && r.chequeNumber === replaceFrom.chequeNumber)).map((r) => r.id) : []));
  const [key] = useState(() => newUuid());
  const [state, action, busy] = useActionState(receivePaymentAction.bind(null, customerId), null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const amount = Number(amountText.replace(/,/g, "")) || 0;
  // The shares follow the amount (oldest first) until accounts change one by hand.
  const ordered = useMemo(() => {
    const first = firstJobTitle ? docs.filter((d) => d.title === firstJobTitle) : [];
    return [...first, ...docs.filter((d) => !first.includes(d))];
  }, [docs, firstJobTitle]);
  const auto = useMemo(() => Object.fromEntries(splitPayment(amount, ordered.map((d, i) => ({ ...d, issuedAt: firstJobTitle ? String(i).padStart(4, "0") : d.issuedAt }))).shares.map((s) => [s.invoiceId, s.amount.toFixed(2)])), [amount, ordered, firstJobTitle]);
  const shown = shares ?? auto;
  const shareSum = Math.round(Object.values(shown).reduce((a, v) => a + (Number(String(v).replace(/,/g, "")) || 0), 0) * 100) / 100;
  const left = Math.round((amount - shareSum) * 100) / 100;
  const done = !!state?.message && !state.error;

  const box = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} data-receive-window>
        <span className="text-lg font-extrabold">{replaceFrom ? "Replace with combined payment" : "Receive payment from the customer"}</span>
        {done ? (
          <>
            <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-receive-done>{state!.message}</p>
            <div><Button type="button" size="md" onClick={() => { onClose(); window.location.reload(); }} data-receive-close>Close</Button></div>
          </>
        ) : !ready ? (
          <p className="text-sm font-semibold" data-receive-not-ready>One payment for several cars switches on with the database update of 9 November (WAITING FOR APPLY). Until then record each car&apos;s share on its own job.</p>
        ) : (
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="client_key" value={key} />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase text-muted">How was it paid?</span>
              <div className="flex flex-wrap gap-2">
                {METHODS.map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setMethod(k)} aria-pressed={method === k} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${method === k ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-receive-method={k}>{label}</button>
                ))}
              </div>
              <input type="hidden" name="method" value={method} />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Full amount received</span><Input name="amount" inputMode="decimal" required value={amountText} onChange={(e) => { setAmountText(e.target.value); setShares(null); }} className="w-40" data-receive-amount /></label>
              {method === "cheque" ? (
                <>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Cheque no.</span><Input name="cheque_number" required defaultValue={replaceFrom?.chequeNumber ?? ""} className="w-32" data-receive-cheque-number /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bank</span><Input name="cheque_bank" className="w-40" data-receive-cheque-bank /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Cheque date</span><Input name="cheque_date" type="date" required className="w-44" data-receive-cheque-date /></label>
                </>
              ) : method === "card" || method === "link" ? (
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Auth code (optional)</span><Input name="auth_code" className="w-32" data-receive-auth /></label>
              ) : method === "transfer" ? (
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Customer&apos;s reference</span><Input name="reference" className="w-48" data-receive-reference /></label>
              ) : null}
            </div>
            <div className="flex flex-col gap-1" data-receive-shares>
              <span className="text-xs font-semibold uppercase text-muted">Paid against (oldest first – change any share)</span>
              {ordered.length ? ordered.map((d) => (
                <label key={d.invoiceId} className="flex flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2 text-sm" data-receive-share={d.number}>
                  <input type="hidden" name="share_invoice" value={d.invoiceId} />
                  <span className="min-w-0 flex-1"><span className="font-bold uppercase">{d.title}</span> · {d.number} · owes {aed(d.due)}</span>
                  <Input name="share_amount" inputMode="decimal" value={shown[d.invoiceId] ?? ""} onChange={(e) => setShares({ ...shown, [d.invoiceId]: e.target.value })} className="w-32" aria-label={`Amount on ${d.number}`} data-receive-share-amount={d.number} />
                </label>
              )) : <p className="text-sm text-muted">No open proforma or invoice: the whole amount becomes an advance on the account.</p>}
              {left > 0.004 ? <p className="text-sm font-semibold text-amber-text" data-receive-leftover>{leftoverWords(left)}</p> : null}
              {left < -0.004 ? <p className="text-sm font-semibold text-red" data-receive-over>The shares come to {aed(shareSum)}, more than {aed(amount)}.</p> : null}
            </div>
            {receipts.length ? (
              <details className="rounded-control border border-line p-3" open={!!replaceFrom} data-receive-replace>
                <summary className="cursor-pointer text-sm font-bold">Replace earlier receipts of this payment ({replace.size} ticked)</summary>
                <p className="mt-1 text-xs text-muted">The ticked receipts are voided with the reason and linked to this one (for a cheque recorded on one car only, or twice).</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {receipts.map((r) => (
                    <li key={r.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="replace_id" value={r.id} checked={replace.has(r.id)} onChange={(e) => setReplace((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} className="h-5 w-5 accent-ink" data-receive-replace-id={r.number} />
                        <span className="font-bold">{r.number}</span> {aed(r.amount)} · {r.method}{r.chequeNumber ? ` ${r.chequeNumber}` : ""}{r.job ? ` · ${r.job}` : ""} · {r.status}
                      </label>
                    </li>
                  ))}
                </ul>
                {replace.size ? <Input name="replace_reason" required minLength={5} placeholder="Why (e.g. one cheque for two cars, recorded on one car only)" className="mt-2 w-full" data-receive-replace-reason /> : null}
              </details>
            ) : null}
            {state?.error ? <p className="text-sm font-semibold text-red" data-receive-error>{state.error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="md" disabled={busy || !(amount > 0) || left < -0.004} data-receive-save>{busy ? "Saving…" : `Record ${amount > 0 ? aed(amount) : ""}`}</Button>
              <Button type="button" tone="ghost" size="md" disabled={busy} onClick={onClose}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(box, document.body);
}
