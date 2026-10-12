"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input } from "@/components/ui";
import { PART_TYPE_LABELS } from "@/lib/quotes";
import { discountOf, netOf, rowComplete, supplierDiscount, type RowValues, type SupplierOption } from "@/lib/parts-rows";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { addSupplierQuick, askManager, attachDiagram, autoSavePartRow, closePartRequest, coverRequest, markRequestUnavailable, removePart, splitPart } from "../actions";

export type TableRow = {
  key: string;
  requestId: string | null;
  partId: string | null;
  /** The part's name: the technician's, or corrected by Parts. */
  name: string;
  /** What the technician wrote, when Parts changed the name. */
  original: string | null;
  /** The technician's quantity; the row's values.qty is the Parts quantity. */
  techQty: number;
  /** Positions and the technician's note. */
  info: string | null;
  values: RowValues;
  optionGroup: string | null;
  unavailable: boolean;
  closedReason: string | null;
  /** Ordered, received, handed over: the price is locked. */
  locked: boolean;
  orderLabel: string | null;
  diagramUrl: string | null;
  question: string | null;
  answer: string | null;
  perSet: boolean;
};

/**
 * The columns, sized to their content and starting from the left. Under a wide screen the part number and
 * the type move to a second line inside the row, so nothing squashes on a small laptop.
 */
const GRID = "grid grid-cols-2 md:grid-cols-[minmax(9rem,1fr)_6.5rem_5.5rem_4.5rem_6rem_11rem_11rem_2.5rem] xl:grid-cols-[minmax(9rem,1fr)_6.5rem_14rem_7.5rem_5.5rem_4.5rem_6rem_11rem_11rem_2.5rem] gap-x-2 gap-y-1.5 items-center";
const SECOND_LINE = "col-span-2 md:col-span-4 md:order-last xl:col-span-1 xl:order-none";
const EMPTY: RowValues = { part_number: "", part_type: "", brand: "", list_price: "", discount: "", cost_aed: "", supplier: "", availability: "", days: "", qty: "1" };
const num = (s: string) => Number(String(s).replace(",", ".")) || 0;

/**
 * The Parts pricing table: one row per part, every row saving itself as it is filled in. Part, Qty, Part number,
 * Type, List, Disc %, Net, Supplier, Availability and a three-dot menu. The discount fills in from the supplier,
 * the net is calculated, the quantity has − and +, the name can be corrected, a bundled row can be split.
 * Nothing redraws while someone is typing.
 */
export function PartsTable({ jobId, rows: initialRows, suppliers: initialSuppliers, types, canPrice, car, vin, openingLine, catalogue = [] }: { jobId: string; rows: TableRow[]; suppliers: SupplierOption[]; types: string[]; canPrice: boolean; car: string; vin: string | null; openingLine: string; catalogue?: string[] }) {
  const [rows, setRows] = useState<TableRow[]>(initialRows);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(initialSuppliers);
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Rows added or changed elsewhere arrive on refresh; what this screen holds for a row wins while it is being edited.
  const [seen, setSeen] = useState(initialRows);
  if (seen !== initialRows) {
    setSeen(initialRows);
    setRows((cur) => {
      const mine = new Map(cur.map((r) => [r.key, r]));
      const merged = initialRows.map((r) => {
        const k = mine.get(r.key);
        return k ? { ...r, name: k.name, values: k.values } : r;
      });
      for (const r of cur) if (!r.partId && !r.requestId && !merged.some((m) => m.key === r.key)) merged.push(r);
      return merged;
    });
  }
  const [seenSup, setSeenSup] = useState(initialSuppliers);
  if (seenSup !== initialSuppliers) {
    setSeenSup(initialSuppliers);
    setSuppliers((cur) => [...initialSuppliers, ...cur.filter((c) => !initialSuppliers.some((s) => s.id === c.id))]);
  }
  const done = rows.filter((r) => r.unavailable || rowComplete(r.values, !!r.partId)).length;
  const shown = onlyUnpriced ? rows.filter((r) => !r.unavailable && !rowComplete(r.values, !!r.partId)) : rows;

  function addLoose() {
    const name = window.prompt("Which part? Type its name.");
    if (!name?.trim()) return;
    setRows((p) => [...p, { key: `new:${Date.now()}`, requestId: null, partId: null, name: name.trim(), original: null, techQty: 1, info: "Added by Parts", values: { ...EMPTY, part_type: types[0] ?? "" }, optionGroup: null, unavailable: false, closedReason: null, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null, perSet: false }]);
  }
  function addOption(base: TableRow) {
    setRows((p) => {
      const i = p.findIndex((r) => r.key === base.key);
      const row: TableRow = { key: `opt:${Date.now()}`, requestId: base.requestId, partId: null, name: base.name, original: null, techQty: base.techQty, info: "Option: another type or brand for the same part", values: { ...EMPTY, qty: base.values.qty, part_type: "" }, optionGroup: base.optionGroup ?? base.partId, unavailable: false, closedReason: null, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null, perSet: base.perSet };
      (row as TableRow & { optionOf?: string }).optionOf = base.partId ?? undefined;
      const copy = [...p];
      copy.splice(i + 1, 0, row);
      return copy;
    });
  }
  async function addSupplier(): Promise<SupplierOption | null> {
    const name = window.prompt("New supplier: type the name. The owner or accounts set its discount on the Suppliers page.");
    if (!name?.trim()) return null;
    const r = await addSupplierQuick(name.trim());
    if (r.error || !r.supplier) {
      window.alert(r.error ?? "Could not add the supplier.");
      return null;
    }
    const s = r.supplier;
    setSuppliers((cur) => (cur.some((x) => x.id === s.id) ? cur : [...cur, s].sort((a, b) => a.name.localeCompare(b.name))));
    return s;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <span className="text-sm font-bold">{done} of {rows.length} priced</span>
          <span className="h-1.5 w-full max-w-xs rounded-full bg-track overflow-hidden"><span className="block h-full bg-ink" style={{ width: `${rows.length ? Math.round((done / rows.length) * 100) : 0}%` }} /></span>
        </div>
        <button type="button" onClick={() => setOnlyUnpriced((v) => !v)} aria-pressed={onlyUnpriced} className={`min-h-10 rounded-control border px-3 text-xs font-bold ${onlyUnpriced ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{onlyUnpriced ? "✓ " : ""}Show only unpriced</button>
        <Button type="button" tone="secondary" size="md" onClick={() => setListOpen(true)}>Copy list for supplier</Button>
      </div>
      <div className={`${GRID} hidden md:grid border-b border-line pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted`}>
        <span>Part</span><span>Qty</span><span className="hidden xl:block">Part number</span><span className="hidden xl:block">Type</span><span className="text-right">List</span><span className="text-right">Disc %</span><span className="text-right">Net</span><span>Supplier</span><span>Availability</span><span />
      </div>
      <div className="flex flex-col gap-1.5">
        {shown.map((r) => (
          <Row key={r.key} jobId={jobId} row={r} suppliers={suppliers} types={types} catalogue={catalogue} canPrice={canPrice} onSaved={(partId, name, values) => setRows((p) => p.map((x) => (x.key === r.key ? { ...x, partId, name, values } : x)))} onAddOption={() => addOption(r)} onAddSupplier={addSupplier} onRemovedLocal={() => setRows((p) => p.filter((x) => x.key !== r.key))} />
        ))}
        {shown.length === 0 ? <p className="py-3 text-sm text-muted">{onlyUnpriced ? "Every part has a price." : "No parts on this job yet."}</p> : null}
      </div>
      {canPrice ? <Button type="button" tone="secondary" size="md" onClick={addLoose} className="self-start">+ Add a part the technician did not list</Button> : null}
      <datalist id="part-pool">{catalogue.map((c) => <option key={c} value={c} />)}</datalist>
      {listOpen ? <SupplierList rows={rows} car={car} vin={vin} openingLine={openingLine} onClose={() => setListOpen(false)} /> : null}
    </div>
  );
}

function Row({ jobId, row, suppliers, types, catalogue, canPrice, onSaved, onAddOption, onAddSupplier, onRemovedLocal }: { jobId: string; row: TableRow; suppliers: SupplierOption[]; types: string[]; catalogue: string[]; canPrice: boolean; onSaved: (partId: string | null, name: string, values: RowValues) => void; onAddOption: () => void; onAddSupplier: () => Promise<SupplierOption | null>; onRemovedLocal: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<RowValues>(row.values);
  const [name, setName] = useState(row.name);
  const [partId, setPartId] = useState<string | null>(row.partId);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState<null | "down" | "up">(null);
  const [editingName, setEditingName] = useState(false);
  const [editingPn, setEditingPn] = useState(!row.values.part_number);
  const [copied, setCopied] = useState(false);
  const [split, setSplit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ v, name });
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const optionOf = (row as TableRow & { optionOf?: string }).optionOf ?? null;
  void catalogue;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const complete = rowComplete(v, !!partId);
  const partial = !complete && Object.entries(v).some(([k, x]) => k !== "qty" && x.trim() !== "" && x !== (types[0] ?? ""));
  const tone = row.unavailable ? "bg-amber-soft/60" : focused ? "bg-chip border-l-4 border-ink" : complete ? "bg-green-soft" : "bg-white";
  const supplier = suppliers.find((s) => s.name.toLowerCase() === v.supplier.toLowerCase());
  const qty = num(v.qty) || 1;
  const qtyChanged = Math.abs(qty - row.techQty) > 0.001;

  function queue(nextV: RowValues, nextName: string) {
    latest.current = { v: nextV, name: nextName };
    setV(nextV);
    setName(nextName);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(nextV, nextName), 900);
  }
  const change = (patch: Partial<RowValues>) => queue({ ...latest.current.v, ...patch }, latest.current.name);
  /** List or discount typed: the net follows. Net typed: the discount follows. A supplier picked: its discount fills in. */
  const changeList = (list: string) => change({ list_price: list, cost_aed: netOf(list, latest.current.v.discount) || latest.current.v.cost_aed });
  const changeDisc = (discount: string) => change({ discount, cost_aed: netOf(latest.current.v.list_price, discount) || latest.current.v.cost_aed });
  const changeNet = (cost_aed: string) => change({ cost_aed, discount: discountOf(latest.current.v.list_price, cost_aed) || latest.current.v.discount });
  const changeSupplier = (s: SupplierOption | undefined, nameText: string) => {
    const discount = s ? String(supplierDiscount(s, latest.current.v.part_type)) : latest.current.v.discount;
    change({ supplier: nameText, discount, cost_aed: netOf(latest.current.v.list_price, discount) || latest.current.v.cost_aed });
  };
  const changeType = (part_type: string) => {
    const discount = supplier ? String(supplierDiscount(supplier, part_type)) : latest.current.v.discount;
    change({ part_type, discount, cost_aed: netOf(latest.current.v.list_price, discount) || latest.current.v.cost_aed });
  };
  const flushNow = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void persist(latest.current.v, latest.current.name);
    }
  };
  async function persist(next: RowValues, nextName: string) {
    setSaving(true);
    const res = await autoSavePartRow(jobId, { requestId: row.requestId, partId, optionOf, name: nextName, ...next, quantity: next.qty });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError(null);
    if (res.partId && res.partId !== partId) setPartId(res.partId);
    onSaved(res.partId ?? partId, nextName, next);
    if (res.complete) start(() => refreshWhenIdle(() => router.refresh()));
  }
  const run = (fn: () => Promise<unknown>) => start(async () => { try { await fn(); } catch { /* a redirect ends the action */ } refreshWhenIdle(() => router.refresh()); });
  const openMenu = () => {
    if (menu) {
      setMenu(null);
      return;
    }
    const r = menuRef.current?.getBoundingClientRect();
    // Near the bottom of the screen the menu opens upwards, never under the fixed bar.
    setMenu(r && window.innerHeight - r.bottom < 340 ? "up" : "down");
  };
  const copyPn = async () => {
    try {
      await navigator.clipboard.writeText(v.part_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const box = "min-h-10 text-sm";
  const readOnly = row.unavailable || !canPrice || row.locked;
  const label = (t: string) => <span className="xl:hidden text-[10px] font-bold uppercase tracking-[0.06em] text-muted">{t}</span>;

  return (
    <div className={`${GRID} rounded-control border border-line px-2 py-1.5 ${tone}`} onFocusCapture={() => setFocused(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setFocused(false); flushNow(); } }}>
      {/* Part: the name (tap to correct it), the notes under it */}
      <div className="col-span-2 md:col-span-1 flex flex-col gap-0.5 min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {complete ? <span className="text-green font-extrabold" aria-label="priced">✓</span> : null}
          {editingName && !readOnly ? (
            <Input value={name} onChange={(e) => queue(latest.current.v, e.target.value)} onBlur={() => setEditingName(false)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditingName(false); flushNow(); } }} list="part-pool" aria-label="Part name" className="min-h-9 w-full max-w-xs font-bold" textCase="sentence" autoFocus />
          ) : (
            <button type="button" disabled={readOnly} onClick={() => setEditingName(true)} className="font-bold text-left disabled:cursor-default" title={readOnly ? undefined : "Tap to correct the name"}>{name}</button>
          )}
          {row.optionGroup ? <Badge tone="outline">Option</Badge> : null}
          {row.unavailable ? <Badge tone="amber">Not available</Badge> : null}
          {row.orderLabel ? <Badge tone="ink">{row.orderLabel}</Badge> : null}
          {row.diagramUrl ? <a href={row.diagramUrl} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Diagram</a> : null}
          {saving ? <span className="text-[11px] text-muted">Saving…</span> : null}
        </span>
        {row.info ? <span className="text-[11px] text-muted">{row.info}</span> : null}
        {row.original && row.original !== name ? <span className="text-[11px] text-muted">Technician wrote: {row.original}</span> : null}
        {qtyChanged ? <span className="text-[11px] text-muted">Technician asked for {row.techQty}, Parts changed to {qty}</span> : null}
        {row.closedReason && row.unavailable ? <span className="text-[11px] text-muted">{row.closedReason}</span> : null}
        {row.question ? <span className="text-[11px]"><span className="font-semibold">Asked the manager:</span> {row.question}{row.answer ? <span className="font-semibold text-green"> · {row.answer}</span> : <span className="text-muted"> · waiting</span>}</span> : null}
        {error ? <span className="text-[11px] font-semibold text-red">{error}</span> : null}
      </div>
      {/* Qty: − and +, and the box itself */}
      <span className="inline-flex items-center gap-0.5">
        <button type="button" disabled={readOnly || qty <= 1} onClick={() => change({ qty: String(Math.max(1, Math.round(qty) - 1)) })} className="h-9 w-7 rounded-control border border-line-strong bg-white text-sm font-bold disabled:opacity-40" aria-label="One less">−</button>
        <Input value={v.qty} onChange={(e) => change({ qty: e.target.value })} inputMode="decimal" disabled={readOnly} aria-label="Quantity" className="min-h-9 w-11 px-1 text-center text-sm font-bold" />
        <button type="button" disabled={readOnly} onClick={() => change({ qty: String(Math.round(qty) + 1) })} className="h-9 w-7 rounded-control border border-line-strong bg-white text-sm font-bold disabled:opacity-40" aria-label="One more">+</button>
        {row.perSet ? <span className="text-[10px] text-muted">sets</span> : null}
      </span>
      {/* Part number: a box about 20 characters wide; once saved, plain text in full with Copy */}
      <span className={`${SECOND_LINE} flex flex-col gap-0.5 min-w-0`}>
        {label("Part number")}
        {!readOnly && editingPn ? (
          <Input value={v.part_number} onChange={(e) => change({ part_number: e.target.value })} onBlur={() => { if (latest.current.v.part_number.trim()) setEditingPn(false); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }} placeholder="Part number" textCase="upper" className={`${box} w-full`} aria-label="Part number" autoFocus={!!row.values.part_number} />
        ) : (
          <span className="flex items-start gap-1 min-w-0">
            <button type="button" disabled={readOnly} onClick={() => setEditingPn(true)} className="text-left text-sm font-semibold break-all whitespace-normal disabled:cursor-default" title={readOnly ? undefined : "Tap to change"}>{v.part_number || <span className="text-muted font-normal">No part number</span>}</button>
            {v.part_number ? <button type="button" onClick={copyPn} className="shrink-0 min-h-7 rounded-control border border-line px-1.5 text-[11px] font-bold" aria-label="Copy the part number">{copied ? "✓" : "Copy"}</button> : null}
          </span>
        )}
      </span>
      {/* Type */}
      <span className={`${SECOND_LINE} flex flex-col gap-0.5`}>
        {label("Type")}
        {readOnly ? (
          <span className="text-sm">{v.part_type ? (PART_TYPE_LABELS[v.part_type] ?? v.part_type) + (v.brand ? ` · ${v.brand}` : "") : ""}</span>
        ) : (
          <span className="flex flex-col gap-1">
            <select value={v.part_type} onChange={(e) => changeType(e.target.value)} className="min-h-10 w-full rounded-control border border-line-strong bg-white px-2 text-sm" aria-label="Type">
              <option value="">Type…</option>
              {types.map((t) => <option key={t} value={t}>{PART_TYPE_LABELS[t] ?? t}</option>)}
            </select>
            {v.part_type && v.part_type !== "genuine" ? <Input value={v.brand} onChange={(e) => change({ brand: e.target.value })} placeholder="Brand" className="min-h-9 text-xs" textCase="title" aria-label="Brand" /> : null}
          </span>
        )}
      </span>
      {/* List, Disc %, Net */}
      {readOnly ? (
        <>
          <span className="text-right text-sm">{v.list_price ? Number(v.list_price).toLocaleString("en-GB", { minimumFractionDigits: 2 }) : ""}</span>
          <span className="text-right text-sm">{v.discount ? `${v.discount}%` : ""}</span>
          <span className="text-right text-sm font-semibold">{v.cost_aed ? Number(v.cost_aed).toLocaleString("en-GB", { minimumFractionDigits: 2 }) : ""}</span>
        </>
      ) : (
        <>
          <Input value={v.list_price} onChange={(e) => changeList(e.target.value)} inputMode="decimal" placeholder="List" className={`${box} text-right px-1`} aria-label="List price" />
          <Input value={v.discount} onChange={(e) => changeDisc(e.target.value)} inputMode="decimal" placeholder="%" className={`${box} text-right px-1`} aria-label="Discount percent" />
          <Input value={v.cost_aed} onChange={(e) => changeNet(e.target.value)} inputMode="decimal" placeholder="Net" className={`${box} text-right px-1 font-semibold`} aria-label="Cost before VAT" />
        </>
      )}
      {/* Supplier: from the list, with Add a supplier at the bottom */}
      {readOnly ? (
        <span className="text-sm whitespace-normal">{v.supplier}</span>
      ) : (
        <select
          value={supplier ? supplier.id : v.supplier ? "__text" : ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "__add") void onAddSupplier().then((s) => { if (s) changeSupplier(s, s.name); });
            else if (val === "") changeSupplier(undefined, "");
            else if (val !== "__text") { const s = suppliers.find((x) => x.id === val); if (s) changeSupplier(s, s.name); }
          }}
          className="min-h-10 w-full rounded-control border border-line-strong bg-white px-2 text-sm"
          aria-label="Supplier"
        >
          <option value="">Supplier…</option>
          {!supplier && v.supplier ? <option value="__text">{v.supplier}</option> : null}
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.discount ? ` · ${s.discount}%` : ""}</option>)}
          <option value="__add">+ Add a supplier…</option>
        </select>
      )}
      {/* Availability in words */}
      {readOnly ? (
        <span className="text-sm">{v.availability === "in_stock" ? "In stock" : v.availability === "to_order" ? `Order · arrives in ${v.days} days` : ""}</span>
      ) : (
        <span className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => change({ availability: "in_stock", days: "" })} aria-pressed={v.availability === "in_stock"} className={`min-h-9 rounded-control border px-2 text-[11px] font-extrabold ${v.availability === "in_stock" ? "border-green bg-green text-white" : "border-line-strong bg-white"}`}>In stock</button>
          <button type="button" onClick={() => change({ availability: "to_order" })} aria-pressed={v.availability === "to_order"} className={`min-h-9 rounded-control border px-2 text-[11px] font-extrabold ${v.availability === "to_order" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Order</button>
          {v.availability === "to_order" ? <span className="inline-flex items-center gap-1 text-[11px] text-muted">arrives in <Input value={v.days} onChange={(e) => change({ days: e.target.value })} inputMode="numeric" className="min-h-9 w-12 px-1 text-xs text-center" aria-label="Days until it arrives" /> days</span> : null}
        </span>
      )}
      {/* The three-dot menu: narrow, always visible, opens upwards near the bottom */}
      <div className="relative flex justify-end">
        {canPrice ? (
          <>
            <button ref={menuRef} type="button" onClick={openMenu} aria-label="More for this part" aria-expanded={!!menu} className={`min-h-9 min-w-9 rounded-control border text-base font-bold ${menu ? "border-ink bg-ink text-white" : "border-line"}`}>⋯</button>
            {menu ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
                <div className={`absolute right-0 z-50 w-64 rounded-card border border-line bg-white p-1 text-sm shadow-xl flex flex-col ${menu === "up" ? "bottom-10" : "top-10"}`}>
                  {!readOnly ? <MenuItem label="Edit part name" onClick={() => { setMenu(null); setEditingName(true); }} /> : null}
                  {partId && !row.locked ? <MenuItem label="Split into separate parts" onClick={() => { setMenu(null); setSplit(true); }} /> : null}
                  {partId && complete && !row.locked ? <MenuItem label="Add an option for this part" onClick={() => { setMenu(null); onAddOption(); }} /> : null}
                  {partId ? <MenuItem label="Attach diagram" onClick={() => { setMenu(null); fileRef.current?.click(); }} /> : null}
                  {partId && (!row.question || row.answer) ? <MenuItem label="Ask the workshop manager" onClick={() => { setMenu(null); const q = window.prompt("Your question for the workshop manager", "Is this the right part?"); if (q !== null) { const fd = new FormData(); fd.set("question", q); run(() => askManager(partId, fd)); } }} /> : null}
                  {row.requestId && !row.unavailable && !partId ? <MenuItem label="Not available" onClick={() => { setMenu(null); const note = window.prompt("Not available. A note for the advisor (optional)", ""); if (note !== null) { const fd = new FormData(); fd.set("note", note); run(() => markRequestUnavailable(row.requestId!, fd)); } }} /> : null}
                  {row.requestId && !partId ? <MenuItem label="Already covered in another request" onClick={() => { setMenu(null); run(() => coverRequest(row.requestId!)); }} /> : null}
                  {row.requestId && !partId ? <MenuItem label="Cannot source: close the request" onClick={() => { setMenu(null); const note = window.prompt("Why is this request closed? (shown to the advisor)", ""); if (note && note.trim().length >= 3) { const fd = new FormData(); fd.set("note", note); run(() => closePartRequest(row.requestId!, fd)); } }} /> : null}
                  {partId && !row.locked ? <MenuItem label="Remove" red onClick={() => { setMenu(null); if (window.confirm(`Remove ${name} from this job?`)) run(() => removePart(partId)); }} /> : null}
                  {!partId && !row.requestId ? <MenuItem label="Remove this row" red onClick={() => { setMenu(null); onRemovedLocal(); }} /> : null}
                </div>
              </>
            ) : null}
            {partId ? (
              <form action={attachDiagram.bind(null, partId)} className="hidden">
                <input ref={fileRef} type="file" name="diagram" accept="image/*,application/pdf" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
              </form>
            ) : null}
          </>
        ) : null}
      </div>
      {partial && !complete && !row.unavailable ? <span className="col-span-2 md:col-span-8 xl:col-span-10 md:order-last text-[11px] text-muted">Not finished: {[!v.part_type ? "type" : "", !v.cost_aed.trim() ? "net cost" : "", !v.supplier.trim() ? "supplier" : "", v.availability === "to_order" && !(Number(v.days) > 0) ? "days to arrive" : !v.availability ? "availability" : ""].filter(Boolean).join(", ")}.</span> : null}
      {split && partId ? <SplitDialog name={name} qty={qty} onClose={() => setSplit(false)} onSplit={(lines) => { setSplit(false); const fd = new FormData(); fd.set("lines", JSON.stringify(lines)); run(() => splitPart(jobId, partId, fd)); }} /> : null}
    </div>
  );
}

/** One line of the three-dot menu. */
function MenuItem({ label, onClick, red = false }: { label: string; onClick: () => void; red?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-11 rounded-control px-3 text-left hover:bg-chip ${red ? "text-red" : ""}`}>
      {label}
    </button>
  );
}

/** One bundled row becomes several: each with its own name and quantity; the prices are entered afresh. */
function SplitDialog({ name, qty, onClose, onSplit }: { name: string; qty: number; onClose: () => void; onSplit: (lines: { name: string; qty: number }[]) => void }) {
  const [lines, setLines] = useState<{ name: string; qty: string }[]>([{ name, qty: String(qty) }, { name: "", qty: "1" }]);
  const ready = lines.filter((l) => l.name.trim()).length >= 2;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-card bg-white p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-lg font-extrabold">Split into separate parts</span>
        <p className="text-xs text-muted">One line per part. The first keeps this row; the others become their own rows, each priced on its own.</p>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={l.name} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={`Part ${i + 1}`} list="part-pool" aria-label={`Part ${i + 1} name`} className="min-h-10 flex-1" textCase="sentence" autoFocus={i === 1} />
            <Input value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="decimal" aria-label={`Part ${i + 1} quantity`} className="min-h-10 w-16 text-center" />
            {lines.length > 2 ? <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="min-h-10 px-2 text-sm font-bold text-red" aria-label="Remove line">×</button> : <span className="w-7" />}
          </div>
        ))}
        <button type="button" onClick={() => setLines((p) => [...p, { name: "", qty: "1" }])} className="self-start min-h-9 rounded-control border border-dashed border-line-strong px-3 text-xs font-bold">+ Another part</button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="md" disabled={!ready} onClick={() => onSplit(lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), qty: Math.max(0.01, Number(l.qty.replace(",", ".")) || 1) })))}>Split</Button>
          <Button type="button" tone="ghost" size="md" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

/** The parts as plain text for a supplier: the car, the VIN, the opening line, one bullet per part with the part number in full. No customer, plate, prices or job details. */
function SupplierList({ rows, car, vin, openingLine, onClose }: { rows: TableRow[]; car: string; vin: string | null; openingLine: string; onClose: () => void }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(rows.filter((r) => !r.unavailable && !r.optionGroup).map((r) => r.key)));
  const [copied, setCopied] = useState(false);
  const lines = rows.filter((r) => ticked.has(r.key)).map((r) => `• ${r.name}${r.info && !/Added by Parts|Option:/.test(r.info) ? ` · ${r.info}` : ""} × ${r.values.qty || 1}${r.values.part_number ? ` · ${r.values.part_number}` : ""}`);
  const text = [car, vin ? `VIN: ${vin}` : "", "", openingLine, ...lines].join("\n");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-card bg-white p-5 flex flex-col gap-3 max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2"><span className="text-lg font-extrabold">List for the supplier</span><button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">✕</button></div>
        <div className="flex flex-wrap gap-1.5">
          {rows.filter((r) => !r.optionGroup).map((r) => (
            <button key={r.key} type="button" onClick={() => setTicked((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} aria-pressed={ticked.has(r.key)} className={`min-h-9 rounded-control border px-2.5 text-xs font-bold ${ticked.has(r.key) ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{ticked.has(r.key) ? "✓ " : ""}{r.name}</button>
          ))}
        </div>
        <pre className="whitespace-pre-wrap rounded-control bg-chip p-3 text-sm font-sans overflow-auto max-h-64">{text}</pre>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="md" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} }}>{copied ? "Copied" : "Copy"}</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-control border border-line-strong bg-white px-4 min-h-11 text-sm font-bold">WhatsApp</a>
        </div>
      </div>
    </div>
  );
}
