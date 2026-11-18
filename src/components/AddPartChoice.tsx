"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Button, Input } from "@/components/ui";
import { stockForAdvisorAction } from "@/app/(app)/quotes/add-part-actions";

export type AddPartMode = "desk" | "own" | "stock" | "customer" | "provisional";
const CHOICES: { key: AddPartMode; title: string; words: string }[] = [
  { key: "desk", title: "Send to the parts desk to price", words: "As now: the parts desk finds the supplier and the price." },
  { key: "own", title: "I have the price", words: "You type the real supplier, the cost and the selling price. It skips the desk's pricing; the desk still orders it once the customer approves." },
  { key: "stock", title: "From our stock", words: "Pick the stock item: the cost comes from stock, nothing is ordered." },
  { key: "customer", title: "Customer supplies it", words: "No cost, no price. The customer's document says PART SUPPLIED BY CUSTOMER – NO WARRANTY ON THE PART." },
  { key: "provisional", title: "Provisional amount", words: "One line \"ADDITIONAL PARTS IF REQUIRED – UP TO AED X\", approved up front. Later it becomes real parts; whatever is not used is not charged." },
];

export type OwnPart = { description: string; qty: number; supplier: string; cost: number; sell: number | null };
type StockRow = { id: string; name: string; onHand: number; unitCost: number };
const num = (t: string) => { const n = Number(t.replace(/,/g, "").trim()); return t.trim() && Number.isFinite(n) ? n : null; };

/**
 * "+ Add a part" with a choice (19 November 2026, Section 5): five ways, none picked for the advisor, each with its own
 * small form. `convert` = turning an approved provisional amount into a real part: only "I have the price" and
 * "From our stock" (no new approval, never above what is left).
 */
export function AddPartChoice({ onClose, onDesk, onOwn, onStock, onCustomer, onProvisional, isEstimate, convert = null, minMarkup }: { onClose: () => void; onDesk: () => void; onOwn: (p: OwnPart) => void; onStock: (stockItemId: string, qty: number, item: StockRow) => void; onCustomer: (name: string, qty: number) => void; onProvisional: (upTo: number) => void; isEstimate: boolean; convert?: { left: number } | null; minMarkup: number }) {
  const [mode, setMode] = useState<AddPartMode | "">("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [supplier, setSupplier] = useState("");
  const [cost, setCost] = useState("");
  const [sell, setSell] = useState("");
  const [upTo, setUpTo] = useState("");
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [stockQ, setStockQ] = useState("");
  const [stockErr, setStockErr] = useState<string | null>(null);
  const choices = convert ? CHOICES.filter((c) => c.key === "own" || c.key === "stock") : CHOICES;
  useEffect(() => {
    if (mode !== "stock" || stock) return;
    let live = true;
    stockForAdvisorAction().then((r) => { if (live) { if (r.error) setStockErr(r.error); setStock(r.items ?? []); } }).catch(() => { if (live) setStockErr("No connection. Close and try again."); });
    return () => { live = false; };
  }, [mode, stock]);
  const q = num(qty) ?? 0;
  const c = num(cost);
  const s = num(sell);
  const floor = c !== null ? Math.round(c * (1 + minMarkup / 100) * 100) / 100 : null;
  const ownOk = !!name.trim() && q > 0 && !!supplier.trim() && c !== null && c > 0 && (s === null || (floor !== null && s + 0.004 >= floor));
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Add a part" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} data-add-part-choice>
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-card bg-white p-5">
        <div className="flex items-center justify-between gap-2"><span className="text-lg font-extrabold">{convert ? "Use the provisional amount" : "Add a part"}</span><Button type="button" tone="ghost" size="md" onClick={onClose} data-add-part-close>Close</Button></div>
        {convert ? <p className="text-sm font-semibold" data-convert-left>AED {convert.left.toLocaleString("en-GB", { minimumFractionDigits: 2 })} is left of the provisional amount the customer approved.</p> : null}
        <div className="flex flex-col gap-2" role="radiogroup">
          {choices.map((ch) => (
            <label key={ch.key} className={`flex cursor-pointer flex-col gap-0.5 rounded-control border-2 px-3 py-2 ${mode === ch.key ? "border-ink bg-chip" : "border-line-strong bg-white"} ${ch.key === "stock" && isEstimate ? "opacity-60" : ""}`}>
              <span className="flex items-center gap-2"><input type="radio" name="add-part-mode" checked={mode === ch.key} disabled={ch.key === "stock" && isEstimate} onChange={() => setMode(ch.key)} className="h-5 w-5 accent-ink" data-add-part-mode={ch.key} /><span className="text-sm font-extrabold uppercase">{ch.title}</span></span>
              <span className="pl-7 text-xs text-muted">{ch.key === "stock" && isEstimate ? "On an estimate the parts desk picks the stock item: send it to the desk." : ch.words}</span>
            </label>
          ))}
        </div>
        {mode === "desk" ? <div><Button type="button" size="md" onClick={onDesk} data-add-part-go>Pick the part</Button></div> : null}
        {mode === "own" ? (
          <div className="flex flex-wrap items-end gap-2 rounded-control border border-line p-3">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold uppercase text-muted">The part<Input value={name} onChange={(e) => setName(e.target.value)} data-own-name data-spell="" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">How many<Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" style={{ width: "5rem" }} data-own-qty /></label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-semibold uppercase text-muted">Real supplier<Input name="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} data-own-supplier /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">Cost each (before VAT)<Input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" style={{ width: "8rem" }} data-own-cost /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">Selling each<Input value={sell} onChange={(e) => setSell(e.target.value)} inputMode="decimal" placeholder={floor !== null ? `at least ${floor.toFixed(2)}` : ""} style={{ width: "8rem" }} data-own-sell /></label>
            {s !== null && floor !== null && s + 0.004 < floor ? <span className="basis-full text-xs font-bold text-red" data-own-below-min>Below the minimum markup ({minMarkup}%): at least AED {floor.toFixed(2)} each.</span> : null}
            <Button type="button" size="md" disabled={!ownOk} onClick={() => onOwn({ description: name.trim(), qty: q, supplier: supplier.trim(), cost: c ?? 0, sell: s })} data-own-save>Add the part</Button>
          </div>
        ) : null}
        {mode === "stock" ? (
          <div className="flex flex-col gap-2 rounded-control border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold uppercase text-muted">Search the stock list<Input value={stockQ} onChange={(e) => setStockQ(e.target.value)} data-stock-search /></label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">How many<Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" style={{ width: "5rem" }} data-stock-qty /></label>
            </div>
            {stockErr ? <span className="text-sm font-bold text-red">{stockErr}</span> : null}
            {stock === null ? <span className="text-sm text-muted">Loading the stock list…</span> : (
              <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto">
                {stock.filter((i) => !stockQ.trim() || i.name.toLowerCase().includes(stockQ.trim().toLowerCase())).slice(0, 40).map((i) => (
                  <li key={i.id}><button type="button" disabled={!(i.unitCost > 0) || q <= 0} onClick={() => onStock(i.id, q, i)} className="flex min-h-11 w-full items-center justify-between gap-2 px-2 text-left text-sm disabled:opacity-50" data-stock-pick={i.name}><span className="font-semibold uppercase">{i.name}</span><span className={`text-xs ${i.onHand < q ? "font-bold text-amber-text" : "text-muted"}`}>{i.onHand} on the shelf · AED {i.unitCost.toFixed(2)}{i.unitCost > 0 ? "" : " (no cost yet)"}</span></button></li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {mode === "customer" ? (
          <div className="flex flex-wrap items-end gap-2 rounded-control border border-line p-3">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold uppercase text-muted">The part the customer brings<Input value={name} onChange={(e) => setName(e.target.value)} data-customer-part-name data-spell="" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">How many<Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" style={{ width: "5rem" }} /></label>
            <Button type="button" size="md" disabled={!name.trim() || q <= 0} onClick={() => onCustomer(name.trim(), q)} data-customer-part-save>Add the line</Button>
            <span className="basis-full text-xs text-muted">The document says: PART SUPPLIED BY CUSTOMER – NO WARRANTY ON THE PART.</span>
          </div>
        ) : null}
        {mode === "provisional" ? (
          <div className="flex flex-wrap items-end gap-2 rounded-control border border-line p-3">
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted">Up to AED (before VAT)<Input value={upTo} onChange={(e) => setUpTo(e.target.value)} inputMode="decimal" style={{ width: "9rem" }} data-provisional-amount /></label>
            <Button type="button" size="md" disabled={!((num(upTo) ?? 0) > 0)} onClick={() => onProvisional(num(upTo) ?? 0)} data-provisional-save>Add the line</Button>
            <span className="basis-full text-xs text-muted">The customer approves it up front. Use it later on the approved quotation (&quot;Use the provisional amount&quot;); the unused part never reaches the tax invoice.</span>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * "Use the provisional amount" on an APPROVED quotation (19 November 2026, Section 5): each provisional line with what
 * is left, then "I have the price" or "From our stock". No new approval; never above what the customer approved.
 */
export function ProvisionalConvert({ quotationId, lines, minMarkup }: { quotationId: string; lines: { id: string; title: string; cap: number; left: number }[]; minMarkup: number }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ id: string; left: number } | null>(null);
  const [answer, setAnswer] = useState<{ ok?: boolean; words?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (op: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/quote/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotationId, opId: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()), convertProvisional: { lineId: open?.id, ...op } }) });
      const data = (await res.json()) as { ok?: boolean; words?: string; error?: string };
      setAnswer(data.ok ? { ok: true, words: data.words } : { error: data.error ?? "Not saved: try again." });
      if (data.ok) setOpen(null);
    } catch {
      setAnswer({ error: "No connection: try again." });
    } finally {
      setBusy(false);
    }
  };
  if (!lines.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-card border-2 border-amber-bar bg-amber-soft p-3" data-provisional-convert>
      {lines.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">{l.title}</span>
          <span data-provisional-left={l.id}>AED {l.left.toLocaleString("en-GB", { minimumFractionDigits: 2 })} left of AED {l.cap.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
          {l.left > 0.004 ? <Button type="button" size="md" tone="secondary" disabled={busy} onClick={() => { setAnswer(null); setOpen({ id: l.id, left: l.left }); }} data-provisional-use={l.id}>Use the provisional amount</Button> : null}
        </div>
      ))}
      {answer?.words ? <p className="text-sm font-bold text-green-text" data-provisional-done>{answer.words}</p> : null}
      {answer?.error ? <p className="text-sm font-bold text-red" data-provisional-error>{answer.error}</p> : null}
      {open ? (
        <AddPartChoice
          isEstimate={false}
          convert={{ left: open.left }}
          minMarkup={minMarkup}
          onClose={() => setOpen(null)}
          onDesk={() => setOpen(null)}
          onCustomer={() => setOpen(null)}
          onProvisional={() => setOpen(null)}
          onOwn={(p) => void send({ mode: "own", description: p.description, qty: p.qty, cost: p.cost, supplier: p.supplier, sell: p.sell }).then(() => router.refresh())}
          onStock={(id, qty) => void send({ mode: "stock", stockItemId: id, qty }).then(() => router.refresh())}
        />
      ) : null}
    </div>
  );
}
