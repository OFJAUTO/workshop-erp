"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { StockItemPicker, type PickedStockItem } from "@/components/StockItemPicker";
import { isOurStock, isPlaceholderSupplier, type SupplierOption } from "@/lib/parts-rows";
import { reloadIfStale } from "@/lib/app-version";
import { correctSettledCost } from "../actions";

/**
 * "Correct the cost…" (2 November 2026, J-00017's drain plug, J-00609's engine flush, J-00969's grill moulding: ordered
 * or received from "OFJ Additional" at AED 1.00): a part already ordered or received gets the cost that really stands,
 * before its invoice is made. It came off our shelf (pick the stock item: the shelf goes down, its average is the
 * cost), or it was bought from a supplier (the real supplier and its cost each; an LPO addressed to a stand-in supplier
 * is addressed to the real one). Our records only: the customer sees nothing. The answer shows in this window.
 */
export function CorrectCostDialog({ jobId, partId, name, why, onLpo, suppliers, onClose, onDone }: { jobId: string; partId: string; name: string; why: string; onLpo: boolean; suppliers: SupplierOption[]; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"stock" | "supplier" | null>(onLpo ? "supplier" : null);
  const [supplier, setSupplier] = useState("");
  const [cost, setCost] = useState("");
  const [ask, setAsk] = useState<{ words: string; cost: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The stock picker opens under the button that was tapped (kept as state: a ref is never read while drawing).
  const [picking, setPicking] = useState<HTMLElement | null>(null);
  const real = suppliers.filter((s) => !isOurStock(s.name) && !isPlaceholderSupplier(s.name));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !picking) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, picking]);

  async function send(input: Parameters<typeof correctSettledCost>[2]) {
    setBusy(true);
    setError(null);
    try {
      const r = await correctSettledCost(jobId, partId, input);
      setBusy(false);
      if (r.ask && input.kind === "supplier") { setAsk({ words: r.ask, cost: Number(String(input.cost).replace(/,/g, "")) }); return; }
      if (r.error || !r.ok) { setError(r.error ?? "Not saved. Try again."); return; }
      setAsk(null);
      setDone(r.message ?? "Cost corrected.");
    } catch (e) {
      setBusy(false);
      if (!reloadIfStale(e)) setError("Not saved: no connection. Try again.");
    }
  }
  const pick = (item: PickedStockItem) => {
    setPicking(null);
    void send({ kind: "stock", stockItemId: item.id });
  };
  const costNum = Number(cost.replace(/,/g, ""));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={() => { if (!picking) onClose(); }}>
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} data-correct-dialog>
        <span className="text-lg font-extrabold">Correct the cost: <span className="uppercase">{name}</span></span>
        {why ? <p className="text-sm font-semibold text-red" data-correct-why>{why}</p> : null}
        <p className="text-xs text-muted">Already {onLpo ? "ordered" : "ordered or received"}: put the cost that really stands, before the invoice is made. Only our records change; the customer sees nothing. It is written on the job.</p>
        {done ? (
          <>
            <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green" data-correct-message>{done}</p>
            <div><Button type="button" size="md" onClick={onDone} data-correct-close>Close</Button></div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {onLpo ? null : <Button type="button" size="md" tone={mode === "stock" ? "primary" : "secondary"} disabled={busy} onClick={(e) => { setMode("stock"); setPicking(e.currentTarget); }} data-correct-stock>It came from our stock…</Button>}
              <Button type="button" size="md" tone={mode === "supplier" ? "primary" : "secondary"} disabled={busy} onClick={() => setMode("supplier")} data-correct-supplier>Bought from a supplier</Button>
            </div>
            {picking ? <StockItemPicker anchor={picking} suggest={name} onPick={pick} onClose={() => setPicking(null)} /> : null}
            {mode === "supplier" ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold">Real supplier
                  <select value={supplier} onChange={(e) => { setSupplier(e.target.value); setAsk(null); }} className="min-h-11 rounded-control border border-line-strong bg-white px-2 text-sm" data-correct-supplier-select>
                    <option value="">Pick the supplier…</option>
                    {real.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold">Real cost of one, before VAT (AED)
                  <Input value={cost} onChange={(e) => { setCost(e.target.value); setAsk(null); }} inputMode="decimal" className="min-h-11" name="correct_cost" data-correct-cost-input />
                </label>
                {ask ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2" data-correct-ask>
                    <span className="min-w-0 flex-1 text-sm font-bold text-amber">{ask.words}</span>
                    <Button type="button" size="md" disabled={busy} onClick={() => void send({ kind: "supplier", supplier, cost, confirmCost: ask.cost })} data-correct-confirm>Yes, real price</Button>
                  </div>
                ) : null}
                <div><Button type="button" size="md" disabled={busy || !supplier || !(costNum > 0)} onClick={() => void send({ kind: "supplier", supplier, cost })} data-correct-save>{busy ? "Saving…" : "Save the real cost"}</Button></div>
              </div>
            ) : null}
            {busy && mode === "stock" ? <span className="text-xs text-muted">Saving…</span> : null}
            {error ? <p className="text-sm font-semibold text-red" data-correct-error>{error}</p> : null}
            <div><Button type="button" size="md" tone="ghost" onClick={onClose}>Close</Button></div>
          </>
        )}
      </div>
    </div>
  );
}
