"use client";

import { Input } from "@/components/ui";
import { UNIT_CHOICES, stepQuantity, type PartUnit } from "@/lib/part-units";

/**
 * THE quantity box of a part (section 9, 3 November 2026): − , the number, + and the unit (pieces, litres, sets) on
 * the Parts table, the estimate desk and the quotation editor alike. − and + step one unit from the number itself
 * (6.5 L + 1 = 7.5 L); litres may be typed as 6.5. The unit choice shows once the database keeps it (`showUnit`); until then a set or litre part says so in words.
 * The number box's width and padding are inline: `Input`'s own w-full and px-3.5 beat classes added here, and left
 * only 8 px for the number (an "8" showed cut in half; found at integration, 3 November 2026).
 */
export function QtyUnitBox({ qty, unit, onQty, onUnit, disabled = false, showUnit = false, label = "Quantity", hook = null }: { qty: string; unit: PartUnit; onQty: (text: string) => void; onUnit?: (u: PartUnit) => void; disabled?: boolean; showUnit?: boolean; label?: string; /** An extra data-* hook on the number box (the screens' own test hooks). */ hook?: string | null }) {
  const n = Number(String(qty).replace(",", ".")) || 0;
  return (
    <span className="inline-flex h-9 items-center gap-0.5" data-qty-unit>
      <button type="button" disabled={disabled || n <= 1} onClick={() => onQty(String(stepQuantity(n, -1)))} className="h-9 w-6 shrink-0 rounded-control border border-line-strong bg-white text-sm font-bold disabled:opacity-40" aria-label="One less">−</button>
      <Input value={qty} onChange={(e) => onQty(e.target.value)} inputMode="decimal" disabled={disabled} aria-label={label} className="h-9 min-h-9 px-0.5 text-center text-sm font-bold" style={{ width: "2.25rem", paddingInline: "0.125rem" }} data-part-qty {...(hook ? { [hook]: "" } : {})} />
      <button type="button" disabled={disabled} onClick={() => onQty(String(stepQuantity(n, 1)))} className="h-9 w-6 shrink-0 rounded-control border border-line-strong bg-white text-sm font-bold disabled:opacity-40" aria-label="One more">+</button>
      {showUnit ? (
        <select value={unit} onChange={(e) => onUnit?.(e.target.value as PartUnit)} disabled={disabled} aria-label="Unit" title="Pieces, litres or sets: the cost is per unit" className="h-9 shrink-0 rounded-control border border-line-strong bg-white px-0.5 text-xs font-bold disabled:opacity-60" style={{ width: "2.6rem" }} data-part-unit={unit}>
          {UNIT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.short}</option>)}
        </select>
      ) : unit === "set" ? <span className="text-[10px] text-muted">sets</span> : unit === "l" ? <span className="text-[10px] text-muted">L</span> : null}
    </span>
  );
}
