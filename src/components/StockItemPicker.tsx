"use client";

import { useEffect, useState } from "react";
import { FloatingMenu } from "@/components/FloatingMenu";
import { Button, Input } from "@/components/ui";
import { stockItemQuick, stockItemsForPicker } from "@/app/(app)/parts/actions";
import { reloadIfStale } from "@/lib/app-version";

export type PickedStockItem = { id: string; name: string; partNumber: string | null; unit: string; onHand: number; unitCost: number; words: string };

/**
 * "From our stock…" (2 November 2026, 2.3): THE picker of a stock item, on the Parts table and on the parts desk for
 * estimates. Search by name or part number; each item shows what is on the shelf and its average cost each, which
 * becomes the part's cost (never a stand-in supplier). An item with no cost yet asks for its cost each first; "+ Add
 * to the stock list" adds one that is not on it yet (with what is on the shelf). A cost typed here (not from deliveries)
 * is judged on the row like any typed cost ("Is this the real price?"); an item with fewer on the shelf than the part
 * needs shows amber.
 */
export function StockItemPicker({ anchor, onPick, onClose, suggest = "", need = 0 }: { anchor: HTMLElement | null; onPick: (item: PickedStockItem) => void; onClose: () => void; /** The part's name: offered as the new item's name. */ suggest?: string; /** How many the part needs: an item with fewer on the shelf shows amber (never a block). */ need?: number }) {
  const [items, setItems] = useState<PickedStockItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // The small form: a new item, or the cost each of an item that has none yet.
  const [form, setForm] = useState<null | { id: string | null; name: string; partNumber: string; unit: string; cost: string; shelf: string }>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; item: PickedStockItem } | null>(null);
  useEffect(() => {
    let live = true;
    stockItemsForPicker()
      .then((r) => { if (live) { if (r.error) setError(r.error); setItems(r.items ?? []); } })
      .catch((e) => { if (!reloadIfStale(e) && live) setError("No connection. Close and try again."); });
    return () => { live = false; };
  }, []);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const compact = (s: string | null) => String(s ?? "").replace(/[\s\-._/]/g, "").toLowerCase();
  const shown = (items ?? []).filter((i) => words.every((w) => i.name.toLowerCase().includes(w) || compact(i.partNumber).includes(compact(w))));
  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const r = await stockItemQuick({ id: form.id, name: form.name, partNumber: form.partNumber, unit: form.unit, unitCost: form.cost, onShelf: form.shelf });
      setBusy(false);
      if (r.error || !r.item) { setError(r.error ?? "Could not save."); return; }
      // Already on the list with its own cost: said here first, then "Use it" picks it at that cost.
      if (r.note) { setNote({ text: r.note, item: r.item }); setForm(null); return; }
      onPick(r.item);
    } catch (e) {
      setBusy(false);
      if (!reloadIfStale(e)) setError("Not saved: no connection. Try again.");
    }
  }
  return (
    <FloatingMenu anchor={anchor} onClose={onClose} width={340} label="From our stock" data-stock-picker="">
      <div className="flex flex-col gap-2 p-2">
        <span className="text-sm font-extrabold">From our stock</span>
        {note ? (
          <div className="flex flex-col gap-2 rounded-control border border-amber-bar bg-amber-soft p-2" data-stock-note>
            <span className="text-xs font-semibold text-amber-text">{note.text}</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" onClick={() => onPick(note.item)} data-stock-note-use>Use it</Button>
              <Button type="button" size="md" tone="ghost" onClick={() => setNote(null)}>Back</Button>
            </div>
          </div>
        ) : form ? (
          <div className="flex flex-col gap-2" data-stock-form>
            <span className="text-xs text-muted">{form.id ? `${form.name}: type its cost each (before VAT). Later costs come from the deliveries.` : "A part we keep on the shelf: its cost each before VAT, and how many are there now."}</span>
            {form.id ? null : (
              <>
                <label className="flex flex-col gap-0.5 text-xs font-semibold">Name<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} textCase="upper" className="min-h-11" data-stock-new-name /></label>
                <label className="flex flex-col gap-0.5 text-xs font-semibold">Part number (optional)<Input value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} textCase="upper" className="min-h-11" name="stock_part_number" /></label>
                <label className="flex flex-col gap-0.5 text-xs font-semibold">Unit<Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="min-h-11" name="stock_unit" spell={false} /></label>
              </>
            )}
            <label className="flex flex-col gap-0.5 text-xs font-semibold">Cost each, before VAT (AED)<Input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} inputMode="decimal" className="min-h-11" name="stock_unit_cost" data-stock-new-cost /></label>
            {form.id ? null : <label className="flex flex-col gap-0.5 text-xs font-semibold">On the shelf now<Input value={form.shelf} onChange={(e) => setForm({ ...form, shelf: e.target.value })} inputMode="decimal" className="min-h-11" name="stock_on_shelf" data-stock-new-shelf /></label>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" disabled={busy || !(Number(form.cost.replace(",", ".")) > 0) || (!form.id && form.name.trim().length < 2)} onClick={() => void save()} data-stock-new-save>{busy ? "Saving…" : form.id ? "Use this cost" : "Add and use"}</Button>
              <Button type="button" size="md" tone="ghost" onClick={() => setForm(null)}>Back</Button>
            </div>
          </div>
        ) : (
          <>
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or part number" className="min-h-11" aria-label="Search the stock list" autoFocus data-stock-search />
            {items === null ? <span className="text-xs text-muted">Loading the stock list…</span> : null}
            {items !== null && !shown.length ? <span className="text-xs text-muted">{items.length ? "Nothing matches." : "The stock list is empty."}</span> : null}
            <div className="flex flex-col">
              {shown.slice(0, 40).map((i) => (
                <button key={i.id} type="button" onClick={() => (i.unitCost > 0 ? onPick(i) : setForm({ id: i.id, name: i.name, partNumber: i.partNumber ?? "", unit: i.unit, cost: "", shelf: "" }))} className="min-h-11 rounded-control px-2 py-1 text-left hover:bg-chip" data-stock-item={i.id}>
                  <span className="block text-sm font-bold uppercase leading-tight">{i.name}{i.partNumber ? <span className="font-normal text-muted"> · {i.partNumber}</span> : null}</span>
                  <span className={`block text-xs ${i.unitCost > 0 && i.onHand + 1e-9 >= need ? "text-muted" : "font-semibold text-amber-text"}`} data-stock-item-short={i.onHand + 1e-9 < need ? "1" : "0"}>{i.onHand.toLocaleString("en-GB")} {i.unit} on hand{i.onHand + 1e-9 < need ? ` (needs ${need.toLocaleString("en-GB")}: count it, or order more)` : ""} · {i.unitCost > 0 ? `AED ${i.unitCost.toFixed(2)} each (average)` : "no cost yet: tap to type it"}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setForm({ id: null, name: suggest.toUpperCase(), partNumber: "", unit: "pc", cost: "", shelf: "" })} className="min-h-11 rounded-control border border-dashed border-line-strong px-2 text-left text-sm font-bold" data-stock-add>+ Add to the stock list</button>
          </>
        )}
        {error ? <span className="text-xs font-semibold text-red" data-stock-error>{error}</span> : null}
      </div>
    </FloatingMenu>
  );
}
