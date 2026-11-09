"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { previewBySupplier, type SelectRow } from "@/lib/lpo-select";
import { addSupplierMoney, supplierMoney, supplierMoneyText } from "@/lib/supplier-money";
import { reloadIfStale } from "@/lib/app-version";

const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * SEND LPO FOR SELECTED (8 November 2026, Peter): the parts desk ticks only the parts it orders now. Only an approved,
 * finished line on no LPO can be ticked; every other line says why (a repeated part number or an unfinished line in
 * red). Before sending, the preview shows each supplier's parts and the amount incl. VAT; the rest stay "Approved – to
 * order" for a later LPO.
 */
export function LpoSelect({ rows, vatSupplierNames, pendingNumber, send }: { rows: SelectRow[]; vatSupplierNames: string[]; pendingNumber: string | null; send: (ids: string[]) => Promise<{ error?: string; message?: string }> }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState(false);
  const [answer, setAnswer] = useState<{ error?: string; message?: string } | null>(null);
  const [busy, start] = useTransition();
  const eligible = rows.filter((r) => r.eligible);
  const suppliers = Array.from(new Set(eligible.map((r) => r.supplier))).sort();
  const vat = useMemo(() => new Set(vatSupplierNames.map((n) => n.trim().toLowerCase())), [vatSupplierNames]);
  const blocks = previewBySupplier(rows, ticked);
  const moneyOf = (supplier: string, net: number) => supplierMoney(net, { chargesVat: vat.has(supplier.trim().toLowerCase()) });
  const total = addSupplierMoney(blocks.map((b) => moneyOf(b.supplier, b.net)));
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const n = blocks.reduce((a, b) => a + b.parts.length, 0);
  const go = () =>
    start(async () => {
      try {
        const r = await send(Array.from(ticked));
        setAnswer(r);
        if (!r.error) { setTicked(new Set()); setPreview(false); router.refresh(); }
      } catch (e) {
        if (reloadIfStale(e)) return;
        setAnswer({ error: "No connection – nothing was sent. Try again." });
      }
    });
  return (
    <div className="flex flex-col gap-3" data-lpo-select>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Tick the parts you are ordering now</span>
        <Button type="button" size="md" tone="secondary" onClick={() => setTicked(new Set(eligible.map((r) => r.id)))} disabled={!eligible.length} data-lpo-select-all>Select all approved</Button>
        {suppliers.length > 1 ? suppliers.map((s) => (
          <Button key={s} type="button" size="md" tone="secondary" onClick={() => setTicked(new Set(eligible.filter((r) => r.supplier === s).map((r) => r.id)))} data-lpo-select-supplier={s}>Only {s}</Button>
        )) : null}
        {ticked.size ? <Button type="button" size="md" tone="secondary" onClick={() => setTicked(new Set())} data-lpo-select-clear>Clear</Button> : null}
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line">
        {rows.map((r) => (
          <li key={r.id} className={`flex flex-wrap items-start gap-3 px-3 py-2 ${r.eligible ? "" : "bg-chip/60"}`} data-lpo-line={r.id} data-lpo-eligible={r.eligible ? "1" : "0"}>
            <label className="flex min-h-11 flex-1 min-w-0 cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ticked.has(r.id)} disabled={!r.eligible || busy} onChange={() => toggle(r.id)} data-lpo-pick={r.id} />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-bold uppercase">{r.name}</span>
                <span className="text-xs text-muted">{r.supplier || "No supplier"} · qty {r.quantity} · AED {aed(r.cost * r.quantity)} before VAT</span>
                {r.why ? <span className={`text-xs font-semibold ${r.red ? "text-red" : "text-muted"}`} data-lpo-why data-lpo-why-red={r.red ? "1" : "0"}>{r.why}</span> : <span className="text-xs font-semibold text-green-text">Approved – to order</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" disabled={!n || busy} onClick={() => { setAnswer(null); setPreview(true); }} data-send-lpo-selected>{pendingNumber ? `Add selected to ${pendingNumber} (${n})` : `Send LPO for selected (${n})`}</Button>
        {n ? <span className="text-sm text-muted" data-lpo-select-total>{supplierMoneyText(total)}</span> : null}
      </div>
      {answer?.error ? <p className="text-sm font-semibold text-red" role="alert" data-lpo-selected-error>{answer.error}</p> : null}
      {answer?.message ? <p className="text-sm font-semibold text-green-text" data-lpo-selected-done>{answer.message}</p> : null}
      {preview && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={() => !busy && setPreview(false)}>
              <div role="dialog" aria-modal="true" className="flex w-full max-w-lg max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape" && !busy) setPreview(false); }} data-lpo-preview>
                <span className="text-lg font-extrabold">{pendingNumber ? `Add ${n} part${n === 1 ? "" : "s"} to ${pendingNumber}?` : `Send ${n} part${n === 1 ? "" : "s"} for approval?`}</span>
                {blocks.map((b) => (
                  <div key={b.supplier} className="flex flex-col gap-1 rounded-card border border-line p-3" data-lpo-preview-supplier={b.supplier}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-extrabold">{b.supplier}</span>
                      <span className="text-sm font-bold" data-lpo-preview-amount>{supplierMoneyText(moneyOf(b.supplier, b.net))}</span>
                    </div>
                    {b.parts.map((p) => <span key={p.id} className="text-xs uppercase">{p.name} × {p.quantity} · AED {aed(p.net)}</span>)}
                  </div>
                ))}
                <p className="text-sm font-bold" data-lpo-preview-total>Total {supplierMoneyText(total)}</p>
                {rows.length - n > 0 ? <p className="text-xs text-muted">{rows.length - n} other line{rows.length - n === 1 ? "" : "s"} stay{rows.length - n === 1 ? "s" : ""} as they are for a later LPO.</p> : null}
                {answer?.error ? <p className="text-sm font-semibold text-red" role="alert">{answer.error}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="md" tone="secondary" onClick={() => setPreview(false)} disabled={busy} data-lpo-preview-cancel autoFocus>Go back</Button>
                  <Button type="button" size="md" onClick={go} disabled={busy} data-lpo-preview-confirm>{busy ? "Sending…" : pendingNumber ? "Add to the LPO" : "Send for approval"}</Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
