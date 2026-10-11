"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * The bar fixed to the bottom of the Parts screen: "Pricing done" while pricing (asking first when parts
 * still have no price), "All in stock" and "Parts planned" while planning. One place for the main action.
 */
export function PartsBar({ mode, openCount, pricingDoneAt, onPricingDone, planning }: { mode: "pricing" | "planning"; openCount: number; pricingDoneAt: string | null; onPricingDone: Action; planning?: { unplanned: number; planned: boolean; onAllInStock: Action; onPartsPlanned: Action } | null }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur px-4 py-2.5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        {mode === "planning" && planning ? (
          <>
            {planning.unplanned ? <form action={planning.onAllInStock}><input type="hidden" name="from" value="parts" /><button type="submit" className="min-h-12 rounded-control border border-line-strong bg-white px-4 text-sm font-bold">All in stock</button></form> : null}
            {planning.unplanned ? <span className="text-xs text-muted">{planning.unplanned} part{planning.unplanned === 1 ? "" : "s"} still to decide</span> : null}
            <form action={planning.onPartsPlanned} className="ml-auto"><input type="hidden" name="from" value="parts" /><button type="submit" disabled={planning.unplanned > 0} className={`min-h-12 rounded-control px-5 text-sm font-bold text-white ${planning.unplanned > 0 ? "bg-ink/40" : "bg-ink"}`}>{planning.planned ? "Parts planned again (date changed)" : "Parts planned"}</button></form>
          </>
        ) : (
          <>
            {pricingDoneAt ? <span className="text-sm font-semibold text-green">✓ Sent to the advisor, {formatDateTime(pricingDoneAt)}</span> : <span className="text-xs text-muted">{openCount ? `${openCount} part${openCount === 1 ? "" : "s"} still without a price` : "Every part has a price or is marked not available"}</span>}
            {asking ? (
              <form action={onPricingDone} className="ml-auto flex flex-wrap items-center gap-2">
                <input type="hidden" name="force" value="1" />
                <span className="text-sm font-semibold">{openCount} part{openCount === 1 ? " has" : "s have"} no price yet. Send what you have?</span>
                <button type="submit" className="min-h-12 rounded-control bg-ink px-4 text-sm font-bold text-white">Send what I have</button>
                <button type="button" onClick={() => setAsking(false)} className="min-h-12 rounded-control px-3 text-sm font-semibold text-muted">Not yet</button>
              </form>
            ) : openCount > 0 ? (
              <button type="button" onClick={() => setAsking(true)} className="ml-auto min-h-12 rounded-control bg-ink px-5 text-sm font-bold text-white">{pricingDoneAt ? "Pricing done again" : "Pricing done"}</button>
            ) : (
              <form action={onPricingDone} className="ml-auto"><input type="hidden" name="force" value="" /><button type="submit" className="min-h-12 rounded-control bg-ink px-5 text-sm font-bold text-white">{pricingDoneAt ? "Pricing done again" : "Pricing done"}</button></form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
