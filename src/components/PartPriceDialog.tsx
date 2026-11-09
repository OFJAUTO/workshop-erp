"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cleanNumberText, parseNumberText } from "./NumericInput";
import { Button, Input, controlClass } from "./ui";

/**
 * ENTER PRICE MYSELF (5 November 2026): the one pricing window for a part line, on estimates and job
 * quotations alike. A CENTRE window, never a row inside the sideways-scrolling parts table - that is
 * what glitched: on a phone or tablet scrolled right, the old in-table box opened off-screen to the
 * left and the price could not be entered.
 *
 * Cost (compulsory, never 0) + optional supplier; markup in % or AED (the editor's minimum stays), or
 * type the selling price and the markup is worked out. Selling below cost, or a cost under AED 5,
 * warns in red and asks for a tick before Save. The number boxes update on every key (nothing here
 * saves while typing), so "Use this price" works the moment a cost is typed.
 */

export type PartPriceFields = { cost: number; supplier: string; markupMode: "percent" | "aed"; markupValue: number | null; confirmLow: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** A plain money box: digits, one dot or comma; "2,5" is 2.5 and "5,611" is 5611 (the shared number rules). */
function MoneyBox({ value, onChange, onFocus, onBlur, label, width, autoFocus, hook }: { value: string; onChange: (t: string) => void; onFocus?: () => void; onBlur?: () => void; label: string; width?: string; autoFocus?: boolean; hook: string }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(cleanNumberText(e.target.value, true))}
      onFocus={onFocus}
      onBlur={onBlur}
      className={`${controlClass} text-right`}
      style={width ? { width } : undefined}
      aria-label={label}
      autoFocus={autoFocus}
      {...{ [hook]: "" }}
    />
  );
}

export function PartPriceDialog({ title, qtyWords, minMarkup, isOwner, initial, saving, error, onSave, onClose }: {
  title: string;
  /** "× 1 pc" - the quantity the line asks for (the cost is per unit). */
  qtyWords: string;
  /** The minimum parts markup (%): an advisor's figure below it is put back up by the server. */
  minMarkup: number;
  isOwner: boolean;
  initial: { cost: string; supplier: string; markupMode: "percent" | "aed"; markupValue: string };
  saving: boolean;
  error: string | null;
  onSave: (f: PartPriceFields) => void;
  onClose: () => void;
}) {
  const [cost, setCost] = useState(initial.cost);
  const [supplier, setSupplier] = useState(initial.supplier);
  const [mode, setMode] = useState<"percent" | "aed">(initial.markupMode);
  const [markup, setMarkup] = useState(initial.markupValue);
  const [confirmLow, setConfirmLow] = useState(false);
  /** The selling box while it has the cursor: exactly what is typed (the worked-out figure shows once it is left). */
  const [sellTyping, setSellTyping] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const costNum = parseNumberText(cost);
  const markupNum = parseNumberText(markup);
  const sell = costNum !== null && costNum > 0 ? (mode === "percent" ? r2(costNum * (1 + (markupNum ?? 0) / 100)) : r2(costNum + (markupNum ?? 0))) : null;
  const sellText = sell === null ? "" : sell.toFixed(2);
  const fromSell = (t: string) => {
    const s = parseNumberText(t);
    if (s === null || costNum === null || costNum <= 0) return;
    setMarkup(mode === "percent" ? pct((s / costNum - 1) * 100) : String(r2(s - costNum)));
  };
  const lowCost = costNum !== null && costNum > 0 && costNum < 5;
  const belowCost = sell !== null && costNum !== null && sell < costNum - 0.005;
  const needsTick = lowCost || belowCost;
  const belowMin = !isOwner && costNum !== null && costNum > 0 && (mode === "percent" ? (markupNum ?? 0) < minMarkup : sell !== null && sell < r2(costNum * (1 + minMarkup / 100)));
  const canSave = costNum !== null && costNum > 0 && (!needsTick || confirmLow) && !saving;

  const body = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Enter the price" onClick={onClose} data-price-dialog>
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-card bg-white p-4 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Enter price myself</span>
            <span className="text-sm font-extrabold uppercase break-words">{title || "Part"} <span className="font-semibold text-muted normal-case">{qtyWords}</span></span>
          </div>
          <Button type="button" tone="ghost" size="md" onClick={onClose} data-price-close>Close</Button>
        </div>
        <p className="text-xs text-muted">A price you already have (a dealer on the phone). It shows as &quot;Priced by&quot; you inside the workshop only; the parts desk can still look at it later.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold">Cost each, before VAT (AED) – required
            <MoneyBox value={cost} onChange={(t) => { setCost(t); setConfirmLow(false); }} label="Cost each, before VAT" autoFocus hook="data-price-cost" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Supplier (optional)
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} textCase="title" className="min-h-11" data-price-supplier />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="inline-flex shrink-0 rounded-control border border-line-strong p-0.5" data-price-mode={mode}>
            {(["percent", "aed"] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); if (costNum && sell !== null) setMarkup(m === "percent" ? pct((sell / costNum - 1) * 100) : String(r2(sell - costNum))); }} className={`min-h-9 rounded-control px-3 text-xs font-bold ${mode === m ? "bg-ink text-on-dark" : ""}`}>{m === "percent" ? "Markup %" : "Markup AED"}</button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold">{mode === "percent" ? "Markup (%)" : "Markup (AED each)"}
            <MoneyBox value={markup} onChange={setMarkup} label={mode === "percent" ? "Markup percent" : "Markup AED each"} width="8rem" hook="data-price-markup" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Selling price each (AED)
            <MoneyBox value={sellTyping ?? sellText} onFocus={() => setSellTyping(sellText)} onChange={(t) => { setSellTyping(t); fromSell(t); }} onBlur={() => setSellTyping(null)} label="Selling price each" width="9rem" hook="data-price-selling" />
          </label>
        </div>
        {sell !== null ? <p className="text-sm font-bold" data-price-sell-line>Sells at AED {money(sell)} each{costNum ? ` · cost AED ${money(costNum)}` : ""}</p> : null}
        {belowMin ? <p className="rounded-control border border-amber-bar bg-amber-soft px-3 py-2 text-xs font-semibold" data-price-min-note>The minimum markup is {minMarkup}%: a lower figure is put back up when it saves (the owner can go below).</p> : null}
        {lowCost ? (
          <label className="flex items-start gap-2 rounded-control border border-red-bar bg-red-soft px-3 py-2 text-sm font-semibold text-red" data-price-low-warning>
            <input type="checkbox" checked={confirmLow} onChange={(e) => setConfirmLow(e.target.checked)} className="mt-0.5 h-5 w-5 accent-ink" data-price-confirm />
            <span>AED {money(costNum ?? 0)} is very low for a part. Tick to confirm it is the real cost, before VAT.</span>
          </label>
        ) : belowCost ? (
          <label className="flex items-start gap-2 rounded-control border border-red-bar bg-red-soft px-3 py-2 text-sm font-semibold text-red" data-price-below-warning>
            <input type="checkbox" checked={confirmLow} onChange={(e) => setConfirmLow(e.target.checked)} className="mt-0.5 h-5 w-5 accent-ink" data-price-confirm />
            <span>The selling price is BELOW the cost. Tick to continue anyway{isOwner ? "" : " (the owner may still be asked)"}.</span>
          </label>
        ) : null}
        {error ? <p className="text-sm font-semibold text-red" data-price-error>{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button type="button" size="lg" disabled={!canSave} onClick={() => onSave({ cost: costNum ?? 0, supplier: supplier.trim(), markupMode: mode, markupValue: markupNum, confirmLow })} data-price-save>{saving ? "Saving…" : "Use this price"}</Button>
          <Button type="button" tone="ghost" size="lg" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
