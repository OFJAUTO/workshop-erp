"use client";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * The bar fixed to the bottom of the Parts screen while a car is being planned: "All in stock" and "Parts planned".
 * While pricing, the table draws its own bar (PartsTable), so the counter, the filter and the bar read one state.
 */
export function PartsBar({ planning }: { planning: { unplanned: number; planned: boolean; onAllInStock: Action; onPartsPlanned: Action } }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-60 z-40 border-t border-line bg-white px-4 py-2.5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        {planning.unplanned ? <form action={planning.onAllInStock}><input type="hidden" name="from" value="parts" /><button type="submit" className="min-h-12 rounded-control border border-line-strong bg-white px-4 text-sm font-bold">All in stock</button></form> : null}
        {planning.unplanned ? <span className="text-xs text-muted">{planning.unplanned} part{planning.unplanned === 1 ? "" : "s"} still to decide</span> : null}
        <form action={planning.onPartsPlanned} className="ml-auto"><input type="hidden" name="from" value="parts" /><button type="submit" disabled={planning.unplanned > 0} className={`min-h-12 rounded-control px-5 text-sm font-bold text-white ${planning.unplanned > 0 ? "bg-ink/40" : "bg-ink"}`}>{planning.planned ? "Parts planned again (date changed)" : "Parts planned"}</button></form>
      </div>
    </div>
  );
}
