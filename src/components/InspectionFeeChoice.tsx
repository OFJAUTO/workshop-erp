"use client";

import { useState } from "react";
import { checkFee, FEE_CHIPS, feeWithVat, NO_FEE_REASONS, type FeeBounds, type FeeInput } from "@/lib/inspection-fee";
import { Input } from "./ui";

/**
 * THE inspection fee choice (30 October 2026): on the approval link and on the gate-in (when an advisor or the owner
 * does it), and the owner's change after approval. [Inspection fee] with the amount before VAT (quick buttons or typed,
 * the customer's total with VAT shown underneath), or [No inspection fee] with a reason and the inspection type
 * (Full inspection / Quick job). Writes its hidden form fields (fee_choice, inspection_fee, no_fee_reason, no_fee_note,
 * inspection_type) and tells the holder each change.
 */
export function InspectionFeeChoice({ initial, bounds, isOwner, onChange }: { initial: FeeInput; bounds: FeeBounds; isOwner: boolean; onChange?: (v: FeeInput) => void }) {
  const [v, setV] = useState<FeeInput>(initial);
  const [amountText, setAmountText] = useState(initial.amount !== null ? String(initial.amount) : String(bounds.suggested));
  const set = (patch: Partial<FeeInput>) => {
    const next = { ...v, ...patch };
    setV(next);
    onChange?.(next);
  };
  const amount = v.amount;
  const check = v.choice === "fee" ? checkFee(v, bounds, isOwner) : null;
  const rangeError = check && "error" in check && amount !== null ? check.error : null;
  const btn = (on: boolean) => `min-h-12 rounded-control border-2 px-4 text-left text-sm font-extrabold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`;
  const chip = (on: boolean) => `min-h-11 rounded-control border-2 px-3 text-sm font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`;
  const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="flex flex-col gap-3" data-fee-choice-box={v.choice ?? "none-chosen"}>
      <input type="hidden" name="fee_choice" value={v.choice ?? ""} />
      <input type="hidden" name="inspection_fee" value={v.choice === "fee" && amount !== null ? String(amount) : ""} />
      <input type="hidden" name="no_fee_reason" value={v.choice === "none" ? (v.reason ?? "") : ""} />
      <input type="hidden" name="no_fee_note" value={v.choice === "none" ? (v.note ?? "") : ""} />
      <input type="hidden" name="inspection_type" value={v.choice === "none" ? v.type : "full"} />
      <span className="text-sm font-semibold">Inspection fee <span className="font-normal text-muted">(required)</span></span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" aria-pressed={v.choice === "fee"} onClick={() => set({ choice: "fee", amount: Number(amountText.replace(/,/g, "")) || bounds.suggested })} className={btn(v.choice === "fee")} data-fee-choice="fee">Inspection fee</button>
        <button type="button" aria-pressed={v.choice === "none"} onClick={() => set({ choice: "none" })} className={btn(v.choice === "none")} data-fee-choice="none">No inspection fee</button>
      </div>
      {v.choice === "fee" ? (
        <div className="flex flex-col gap-2 rounded-control border border-line-strong p-3">
          <div className="flex flex-wrap items-center gap-2">
            {FEE_CHIPS.map((c) => (
              <button key={c} type="button" aria-pressed={amount === c} onClick={() => { setAmountText(String(c)); set({ amount: c }); }} className={chip(amount === c)} data-fee-chip={c}>
                AED {c.toLocaleString("en-GB")}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-sm font-semibold">
              or
              <Input value={amountText} onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ""); setAmountText(t); const n = Number(t.replace(/,/g, "")); set({ amount: t === "" || !Number.isFinite(n) ? null : Math.round(n * 100) / 100 }); }} inputMode="decimal" aria-label="Inspection fee in AED before VAT" className="text-right" style={{ width: "7.5rem" }} data-fee-amount />
              <span className="text-xs text-muted">AED before VAT</span>
            </label>
          </div>
          <span className="text-xs text-muted">From AED {bounds.min.toLocaleString("en-GB")} to {bounds.max.toLocaleString("en-GB")}{isOwner ? " (the owner can go outside it)" : ""}.</span>
          {amount !== null && amount > 0 ? <span className="text-sm font-bold" data-fee-total>The customer sees: AED {money(feeWithVat(amount, bounds.vatPercent))} including VAT (AED {amount.toLocaleString("en-GB")} + VAT)</span> : null}
          {rangeError ? <span className="text-sm font-semibold text-red" data-fee-range-error>{rangeError}</span> : null}
        </div>
      ) : null}
      {v.choice === "none" ? (
        <div className="flex flex-col gap-3 rounded-control border border-line-strong p-3">
          <span className="text-sm font-semibold">Why no fee?</span>
          <div className="flex flex-wrap gap-2">
            {NO_FEE_REASONS.map((r) => (
              <button key={r.key} type="button" aria-pressed={v.reason === r.key} onClick={() => set({ reason: r.key })} className={chip(v.reason === r.key)} data-no-fee-reason={r.key}>{r.label}</button>
            ))}
          </div>
          {v.reason ? <Input value={v.note ?? ""} onChange={(e) => set({ note: e.target.value })} placeholder={v.reason === "other" ? "Why (required)" : "Note (optional)"} data-no-fee-note /> : null}
          <span className="text-sm font-semibold">Inspection</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" aria-pressed={v.type === "full"} onClick={() => set({ type: "full" })} className={btn(v.type === "full")} data-inspection-type="full">Full inspection<span className={`block text-xs font-semibold ${v.type === "full" ? "text-white/80" : "text-muted"}`}>Shown as &quot;Free full inspection&quot;</span></button>
            <button type="button" aria-pressed={v.type === "quick"} onClick={() => set({ type: "quick" })} className={btn(v.type === "quick")} data-inspection-type="quick">Quick job – no full inspection<span className={`block text-xs font-semibold ${v.type === "quick" ? "text-white/80" : "text-muted"}`}>Straight to the quotation (e.g. change a tyre)</span></button>
          </div>
          <span className="text-xs text-muted">The customer&apos;s approval page says nothing about a fee.</span>
        </div>
      ) : null}
    </div>
  );
}
