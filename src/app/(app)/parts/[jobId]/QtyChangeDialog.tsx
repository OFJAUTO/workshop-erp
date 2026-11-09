"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { reloadIfStale } from "@/lib/app-version";
import { QTY_REASONS } from "@/lib/qty-after-approval-rules";
import { changeQuantityAction } from "../qty-actions";

/**
 * "Change the quantity…" (Section 1 of 9 November 2026, the BMW REAR DIFFERENTIAL OIL quoted 3, bought and used 2):
 * the parts desk or the owner changes an approved, ordered, received or handed-over part's quantity until the tax
 * invoice is issued, with the one reason. Our cost, the LPO line and the proforma's cost follow; the advisor is told
 * to reduce the customer's price (down) or the quotation goes back for approval (up). Pieces received and not needed
 * go to stock or to a purchase return (asked here). After the tax invoice the answer offers the credit note.
 * Portalled to the body: the row behind it may be greyed.
 */
export function QtyChangeDialog({ jobId, partId, name, qty, unitWords, onClose, onDone }: { jobId: string; partId: string; name: string; qty: number; unitWords: string; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(String(qty));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState<"stock" | "return" | null>(null);
  const [needsExtras, setNeedsExtras] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditHref, setCreditHref] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const n = Number(value.replace(",", "."));
  const ready = Number.isFinite(n) && n > 0 && Math.abs(n - qty) > 0.004 && !!reason && (needsExtras === null || !!extras) && !busy;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await changeQuantityAction(jobId, partId, { qty: n, reason, note: note.trim() || null, extras });
      setBusy(false);
      if (r.needsExtras) { setNeedsExtras(r.needsExtras); setError(r.error ?? null); return; }
      if (r.error || !r.ok) { setError(r.error ?? "Not saved. Try again."); setCreditHref(r.creditNoteHref ?? null); return; }
      setDone(r.words ?? "Quantity changed.");
    } catch (e) {
      setBusy(false);
      if (!reloadIfStale(e)) setError("Not saved: no connection. Try again.");
    }
  }

  const box = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} data-qty-dialog>
        <span className="text-lg font-extrabold">Change the quantity: <span className="uppercase">{name}</span></span>
        <p className="text-xs text-muted">Approved at {qty}{unitWords}. Change it when fewer (or more) were bought or used. Our cost and the LPO follow at once; the advisor decides the customer&apos;s price. Written on the job.</p>
        {done ? (
          <>
            <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-qty-done>{done}</p>
            <div><Button type="button" size="md" onClick={onDone} data-qty-close>Close</Button></div>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs font-semibold">New quantity
              <span className="flex items-center gap-2">
                <button type="button" onClick={() => setValue(String(Math.max(0, (Number(value.replace(",", ".")) || 0) - 1)))} className="h-11 w-11 rounded-control border border-line-strong text-lg font-bold" aria-label="One less">−</button>
                <input value={value} onChange={(e) => { setValue(e.target.value); setNeedsExtras(null); setExtras(null); }} inputMode="decimal" className="h-11 w-24 rounded-control border border-line-strong px-2 text-center text-base font-bold" data-qty-new />
                <button type="button" onClick={() => setValue(String((Number(value.replace(",", ".")) || 0) + 1))} className="h-11 w-11 rounded-control border border-line-strong text-lg font-bold" aria-label="One more">+</button>
                <span className="text-sm text-muted">{unitWords.trim() || "pieces"}</span>
              </span>
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold">Why?</span>
              <div className="flex flex-wrap gap-2">
                {QTY_REASONS.map((r) => (
                  <button key={r.key} type="button" onClick={() => setReason(r.key)} aria-pressed={reason === r.key} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${reason === r.key ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-qty-reason={r.key}>{r.words[0].toUpperCase() + r.words.slice(1)}</button>
                ))}
              </div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note (optional)" className="mt-1 min-h-11 rounded-control border border-line-strong px-3 text-sm" data-spell="" data-qty-note />
            </div>
            {needsExtras !== null ? (
              <div className="flex flex-col gap-1 rounded-control border border-amber-bar bg-amber-soft/40 p-3" data-qty-extras>
                <span className="text-sm font-bold">{needsExtras} received and not needed: where do {needsExtras === 1 ? "it" : "they"} go?</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setExtras("stock")} aria-pressed={extras === "stock"} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${extras === "stock" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-qty-extras-choice="stock">To our stock</button>
                  <button type="button" onClick={() => setExtras("return")} aria-pressed={extras === "return"} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${extras === "return" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-qty-extras-choice="return">Back to the supplier (purchase return)</button>
                </div>
              </div>
            ) : null}
            {error && needsExtras === null ? <p className="text-sm font-semibold text-red" data-qty-error>{error}</p> : null}
            {creditHref ? <a href={creditHref} className="inline-flex min-h-11 items-center self-start rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-qty-credit-note>Credit note for the difference</a> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" disabled={!ready} onClick={() => void save()} data-qty-save>{busy ? "Saving…" : "Save the quantity"}</Button>
              <Button type="button" tone="ghost" size="md" disabled={busy} onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(box, document.body);
}
