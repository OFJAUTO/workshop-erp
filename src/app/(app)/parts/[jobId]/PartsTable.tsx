"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input } from "@/components/ui";
import { PART_TYPE_LABELS } from "@/lib/quotes";
import { rowComplete, type RowValues } from "@/lib/parts-rows";
import { askManager, attachDiagram, autoSavePartRow, closePartRequest, coverRequest, markRequestUnavailable, removePart } from "../actions";

export type TableRow = {
  key: string;
  requestId: string | null;
  partId: string | null;
  /** The part's name: plain text from the technician's list (or typed by Parts for a part nobody listed). */
  name: string;
  qty: number;
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
};

export const GRID = "grid grid-cols-2 md:grid-cols-[minmax(0,2fr)_3.5rem_7rem_7.5rem_6rem_8rem_9rem_2.5rem] gap-x-2 gap-y-1.5 items-center";
const EMPTY: RowValues = { part_number: "", part_type: "", brand: "", cost_aed: "", supplier: "", availability: "", days: "" };

/**
 * The Parts pricing table: one row per part, headings once above their columns, every row saving itself as
 * it is filled in. Row states: being edited light grey with a black left edge, complete very light green with
 * a tick, not started white, not available light amber. "4 of 7 priced" with a thin bar, "Show only unpriced",
 * "Copy list for supplier", a three-dot menu on each row.
 */
export function PartsTable({ jobId, rows: initialRows, suppliers, types, canPrice, car, vin, openingLine }: { jobId: string; rows: TableRow[]; suppliers: string[]; types: string[]; canPrice: boolean; car: string; vin: string | null; openingLine: string }) {
  const [rows, setRows] = useState<TableRow[]>(initialRows);
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Rows added or changed elsewhere arrive on refresh; what this screen holds for a row wins while it is being edited.
  const [seen, setSeen] = useState(initialRows);
  if (seen !== initialRows) {
    setSeen(initialRows);
    setRows((cur) => {
      const mine = new Map(cur.map((r) => [r.key, r]));
      const merged = initialRows.map((r) => {
        const k = mine.get(r.key) ?? mine.get(`req:${r.requestId}`);
        return k && k.partId === r.partId ? { ...r, values: k.values } : r;
      });
      for (const r of cur) if (!r.partId && !r.requestId && !merged.some((m) => m.key === r.key)) merged.push(r);
      return merged;
    });
  }
  const done = rows.filter((r) => r.unavailable || rowComplete(r.values, !!r.partId)).length;
  const shown = onlyUnpriced ? rows.filter((r) => !r.unavailable && !rowComplete(r.values, !!r.partId)) : rows;

  function addLoose() {
    const name = window.prompt("Which part? Type its name.");
    if (!name?.trim()) return;
    setRows((p) => [...p, { key: `new:${Date.now()}`, requestId: null, partId: null, name: name.trim(), qty: 1, info: "Added by Parts", values: { ...EMPTY, part_type: types[0] ?? "" }, optionGroup: null, unavailable: false, closedReason: null, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null }]);
  }
  function addOption(base: TableRow) {
    setRows((p) => {
      const i = p.findIndex((r) => r.key === base.key);
      const row: TableRow = { key: `opt:${Date.now()}`, requestId: base.requestId, partId: null, name: base.name, qty: base.qty, info: "Option: another type or brand for the same part", values: { ...EMPTY, part_type: "" }, optionGroup: base.optionGroup ?? base.partId, unavailable: false, closedReason: null, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null };
      (row as TableRow & { optionOf?: string }).optionOf = base.partId ?? undefined;
      const copy = [...p];
      copy.splice(i + 1, 0, row);
      return copy;
    });
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
        <span>Part</span><span className="text-center">Qty</span><span>Part number</span><span>Type</span><span className="text-right">Cost</span><span>Supplier</span><span>Availability</span><span />
      </div>
      <div className="flex flex-col gap-1.5">
        {shown.map((r) => (
          <Row key={r.key} jobId={jobId} row={r} suppliers={suppliers} types={types} canPrice={canPrice} onSaved={(partId, values) => setRows((p) => p.map((x) => (x.key === r.key ? { ...x, partId, values } : x)))} onAddOption={() => addOption(r)} onRemovedLocal={() => setRows((p) => p.filter((x) => x.key !== r.key))} />
        ))}
        {shown.length === 0 ? <p className="py-3 text-sm text-muted">{onlyUnpriced ? "Every part has a price." : "No parts on this job yet."}</p> : null}
      </div>
      {canPrice ? <Button type="button" tone="secondary" size="md" onClick={addLoose} className="self-start">+ Add a part the technician did not list</Button> : null}
      <datalist id="suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
      {listOpen ? <SupplierList rows={rows} car={car} vin={vin} openingLine={openingLine} onClose={() => setListOpen(false)} /> : null}
    </div>
  );
}

function Row({ jobId, row, suppliers, types, canPrice, onSaved, onAddOption, onRemovedLocal }: { jobId: string; row: TableRow; suppliers: string[]; types: string[]; canPrice: boolean; onSaved: (partId: string | null, values: RowValues) => void; onAddOption: () => void; onRemovedLocal: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<RowValues>(row.values);
  const [partId, setPartId] = useState<string | null>(row.partId);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(v);
  const fileRef = useRef<HTMLInputElement>(null);
  const optionOf = (row as TableRow & { optionOf?: string }).optionOf ?? null;
  void suppliers;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const complete = rowComplete(v, !!partId);
  const partial = !complete && Object.values(v).some((x) => x.trim() !== "" && x !== (types[0] ?? ""));
  const tone = row.unavailable ? "bg-amber-soft/60" : focused ? "bg-chip border-l-4 border-ink" : complete ? "bg-green-soft" : "bg-white";

  function change(patch: Partial<RowValues>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setV(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(next), 600);
  }
  async function persist(next: RowValues) {
    setSaving(true);
    const res = await autoSavePartRow(jobId, { requestId: row.requestId, partId, optionOf, name: row.name, ...next });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError(null);
    if (res.partId && res.partId !== partId) setPartId(res.partId);
    onSaved(res.partId ?? partId, next);
    if (res.complete) start(() => router.refresh());
  }
  const run = (fn: () => Promise<unknown>) => start(async () => { try { await fn(); } catch { /* a redirect ends the action */ } router.refresh(); });
  const box = "min-h-10 text-sm";

  return (
    <div className={`${GRID} rounded-control border border-line px-2 py-1.5 ${tone}`} onFocusCapture={() => setFocused(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
      <div className="col-span-2 md:col-span-1 flex flex-col gap-0.5 min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {complete ? <span className="text-green font-extrabold" aria-label="priced">✓</span> : null}
          <span className="font-bold">{row.name}</span>
          {row.optionGroup ? <Badge tone="outline">Option</Badge> : null}
          {row.unavailable ? <Badge tone="amber">Not available</Badge> : null}
          {row.orderLabel ? <Badge tone="ink">{row.orderLabel}</Badge> : null}
          {row.diagramUrl ? <a href={row.diagramUrl} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Diagram</a> : null}
          {saving ? <span className="text-[11px] text-muted">Saving…</span> : null}
        </span>
        {row.info ? <span className="text-[11px] text-muted">{row.info}</span> : null}
        {row.closedReason && row.unavailable ? <span className="text-[11px] text-muted">{row.closedReason}</span> : null}
        {row.question ? <span className="text-[11px]"><span className="font-semibold">Asked the manager:</span> {row.question}{row.answer ? <span className="font-semibold text-green"> · {row.answer}</span> : <span className="text-muted"> · waiting</span>}</span> : null}
        {error ? <span className="text-[11px] font-semibold text-red">{error}</span> : null}
      </div>
      <span className="text-center text-sm font-semibold">{row.qty}</span>
      {row.unavailable || !canPrice || row.locked ? (
        <>
          <span className="text-sm text-muted truncate">{v.part_number}</span>
          <span className="text-sm">{v.part_type ? (PART_TYPE_LABELS[v.part_type] ?? v.part_type) + (v.brand ? ` · ${v.brand}` : "") : ""}</span>
          <span className="text-right text-sm font-semibold">{v.cost_aed ? `AED ${Number(v.cost_aed).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : ""}</span>
          <span className="text-sm truncate">{v.supplier}</span>
          <span className="text-sm">{v.availability === "in_stock" ? "In stock" : v.availability === "to_order" ? `To order · ${v.days} days` : ""}</span>
        </>
      ) : (
        <>
          <Input value={v.part_number} onChange={(e) => change({ part_number: e.target.value })} placeholder="Number" textCase="upper" className={box} aria-label="Part number" />
          <span className="flex flex-col gap-1">
            <select value={v.part_type} onChange={(e) => change({ part_type: e.target.value })} className="min-h-10 w-full rounded-control border border-line-strong bg-white px-2 text-sm" aria-label="Type">
              <option value="">Type…</option>
              {types.map((t) => <option key={t} value={t}>{PART_TYPE_LABELS[t] ?? t}</option>)}
            </select>
            {v.part_type && v.part_type !== "genuine" ? <Input value={v.brand} onChange={(e) => change({ brand: e.target.value })} placeholder="Brand" className="min-h-9 text-xs" textCase="title" aria-label="Brand" /> : null}
          </span>
          <Input value={v.cost_aed} onChange={(e) => change({ cost_aed: e.target.value })} inputMode="decimal" placeholder="AED" className={`${box} text-right`} aria-label="Cost before VAT" />
          <Input value={v.supplier} onChange={(e) => change({ supplier: e.target.value })} list="suppliers" placeholder="Supplier" className={box} textCase="title" aria-label="Supplier" />
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => change({ availability: "in_stock", days: "" })} aria-pressed={v.availability === "in_stock"} className={`min-h-9 rounded-control border px-1.5 text-[11px] font-extrabold ${v.availability === "in_stock" ? "border-green bg-green text-white" : "border-line-strong bg-white"}`}>Stock</button>
            <button type="button" onClick={() => change({ availability: "to_order" })} aria-pressed={v.availability === "to_order"} className={`min-h-9 rounded-control border px-1.5 text-[11px] font-extrabold ${v.availability === "to_order" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Order</button>
            {v.availability === "to_order" ? <Input value={v.days} onChange={(e) => change({ days: e.target.value })} inputMode="numeric" placeholder="days" className="min-h-9 w-14 text-xs text-center" aria-label="Days until it arrives" /> : null}
          </span>
        </>
      )}
      <div className="relative flex justify-end">
        {canPrice ? (
          <>
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label="More for this part" aria-expanded={menu} className={`min-h-9 min-w-9 rounded-control border text-base font-bold ${menu ? "border-ink bg-ink text-white" : "border-line"}`}>⋯</button>
            {menu ? (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-10 z-40 w-64 rounded-card border border-line bg-white p-1 text-sm shadow-xl flex flex-col">
                  {partId && complete && !row.locked ? <button type="button" onClick={() => { setMenu(false); onAddOption(); }} className="min-h-11 rounded-control px-3 text-left hover:bg-chip">Add an option for this part</button> : null}
                  {partId ? <button type="button" onClick={() => { setMenu(false); fileRef.current?.click(); }} className="min-h-11 rounded-control px-3 text-left hover:bg-chip">Attach diagram</button> : null}
                  {partId && (!row.question || row.answer) ? <button type="button" onClick={() => { setMenu(false); const q = window.prompt("Your question for the workshop manager", "Is this the right part?"); if (q !== null) { const fd = new FormData(); fd.set("question", q); run(() => askManager(partId, fd)); } }} className="min-h-11 rounded-control px-3 text-left hover:bg-chip">Ask workshop manager</button> : null}
                  {row.requestId && !row.unavailable && !partId ? <button type="button" onClick={() => { setMenu(false); const note = window.prompt("Not available. A note for the advisor (optional)", ""); if (note !== null) { const fd = new FormData(); fd.set("note", note); run(() => markRequestUnavailable(row.requestId!, fd)); } }} className="min-h-11 rounded-control px-3 text-left hover:bg-chip">Not available</button> : null}
                  {row.requestId && !partId ? <button type="button" onClick={() => { setMenu(false); run(() => coverRequest(row.requestId!)); }} className="min-h-11 rounded-control px-3 text-left hover:bg-chip">Already covered in another request</button> : null}
                  {row.requestId && !partId ? <button type="button" onClick={() => { setMenu(false); const note = window.prompt("Why is this request closed? (shown to the advisor)", ""); if (note && note.trim().length >= 3) { const fd = new FormData(); fd.set("note", note); run(() => closePartRequest(row.requestId!, fd)); } }} className="min-h-11 rounded-control px-3 text-left hover:bg-chip">Cannot source: close</button> : null}
                  {partId && !row.locked ? <button type="button" onClick={() => { setMenu(false); if (window.confirm(`Remove ${row.name} from this job?`)) run(() => removePart(partId)); }} className="min-h-11 rounded-control px-3 text-left text-red hover:bg-chip">Remove</button> : null}
                  {!partId && !row.requestId ? <button type="button" onClick={() => { setMenu(false); onRemovedLocal(); }} className="min-h-11 rounded-control px-3 text-left text-red hover:bg-chip">Remove this row</button> : null}
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
      {partial && !complete && !row.unavailable ? <span className="col-span-2 md:col-span-8 text-[11px] text-muted">Not finished: {[!v.part_type ? "type" : "", !v.cost_aed.trim() ? "cost" : "", !v.supplier.trim() ? "supplier" : "", v.availability === "to_order" && !(Number(v.days) > 0) ? "days to arrive" : !v.availability ? "availability" : ""].filter(Boolean).join(", ")}</span> : null}
    </div>
  );
}

/** The parts as plain text for a supplier: the car, the VIN, the opening line, one bullet per part. No customer, plate, prices or job details. */
function SupplierList({ rows, car, vin, openingLine, onClose }: { rows: TableRow[]; car: string; vin: string | null; openingLine: string; onClose: () => void }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(rows.filter((r) => !r.unavailable && !r.optionGroup).map((r) => r.key)));
  const [copied, setCopied] = useState(false);
  const lines = rows.filter((r) => ticked.has(r.key)).map((r) => `• ${r.name}${r.info && !/Added by Parts|Option:/.test(r.info) ? ` · ${r.info}` : ""} × ${r.qty}${r.values.part_number ? ` · ${r.values.part_number}` : ""}`);
  const text = [car, vin ? `VIN: ${vin}` : "", "", openingLine, ...lines].join("\n");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-card bg-white p-5 flex flex-col gap-3 max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2"><span className="text-lg font-extrabold">List for the supplier</span><button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">✕</button></div>
        <div className="flex flex-wrap gap-1.5">
          {rows.filter((r) => !r.optionGroup).map((r) => (
            <button key={r.key} type="button" onClick={() => setTicked((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} aria-pressed={ticked.has(r.key)} className={`min-h-9 rounded-control border px-2 text-xs font-semibold ${ticked.has(r.key) ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{ticked.has(r.key) ? "✓ " : ""}{r.name}</button>
          ))}
        </div>
        <pre className="whitespace-pre-wrap rounded-control bg-chip p-3 text-sm font-sans overflow-auto">{text}</pre>
        <div className="flex gap-2">
          <Button type="button" size="lg" className="flex-1" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy"}</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="flex min-h-14 flex-1 items-center justify-center rounded-control border-2 border-ink bg-white text-base font-bold">WhatsApp</a>
        </div>
      </div>
    </div>
  );
}
