"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PositionsLine } from "@/components/PositionsLine";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { PART_TYPE_LABELS } from "@/lib/quotes";
import { AVAILABILITY_CHOICES, OUR_STOCK, isOurStock, availabilityChoice, availabilityFromChoice, availabilityWords, daysComplete, discountOf, netOf, pricingSummary, rowMissing, rowState, supplierDiscount, type AvailabilityChoice, type RowState, type RowValues, type SupplierOption } from "@/lib/parts-rows";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { ReasonChips } from "@/components/ReasonChips";
import { PartPicker } from "@/components/PartPicker";
import { type CatalogueRow } from "@/lib/parts-list";
import { addSupplierQuick, askManager, attachDiagram, autoSavePartRow, closePartRequest, coverRequest, markRequestUnavailable, noteCustomPartNames, splitPart } from "../actions";
import { notNeededFromParts, putBackPart, removeNotNeeded } from "../remove-actions";
import { bulkDeleteParts, undoBulkDelete } from "../bulk-actions";
import { FloatingMenu } from "@/components/FloatingMenu";
import { TyreBuilder } from "@/components/TyreBuilder";
import { isGenericTyreName, isTyreName, parseTyreSpec, tyreName, tyreSizeIn, type TyreSpec } from "@/lib/tyres";
import { undoImport } from "../import-actions";
import { clearPending, readPending, writePending } from "@/lib/pending-draft";
import { reloadIfStale } from "@/lib/app-version";

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
  /** "Remove: not needed": greyed with the reason, Put back possible. */
  removed: { by: string; reason: string } | null;
  /** A supplier discount above the owner's limit, waiting for his approval. */
  waitingApproval: boolean;
  /** A new row from the picker: its positions go to the server with the first save. */
  positions?: string[];
  /** The positions shown under the name (the part's own, else its request's): display only, never sent. */
  shownPositions?: string[] | null;
};

type Action = (formData: FormData) => void | Promise<void>;

/**
 * The columns, sized to their content and starting from the left. The Part column is capped at the width of a
 * typical name ("Upper control arm"), longer names wrap onto a second line inside the same height. The part number
 * box shows 22 characters with their spaces in full, next to Copy; the Supplier and Availability dropdowns show their
 * full text. On a laptop (1366 px) the part number and the type take a second line inside the row; from 1720 px
 * everything sits on one line. A third line (the status line) holds the notes and the "Not finished" tag, so a row
 * never changes height whatever its state.
 */
// Written out in full (no string building) so Tailwind sees every class. The one-line layout starts at 110rem (1760 px).
// Supplier is 14rem so a name like "Al Futtaim Auto Centre" shows whole, the part number 17.5rem for 22 characters
// beside Copy; on two lines the Availability column (9.5rem) and the Part minimum (10rem) give that room back, so the
// whole table still fits a 1366 px laptop without scrolling sideways.
const GRID = "grid grid-cols-2 md:grid-cols-[minmax(10rem,14rem)_6rem_4.25rem_3.25rem_5.25rem_14rem_9.5rem_5rem_2.5rem] min-[110rem]:grid-cols-[minmax(12rem,16rem)_6rem_17.5rem_11.5rem_4.25rem_3.25rem_5.25rem_14rem_11rem_5rem_2.5rem] gap-x-1.5 gap-y-1 items-center";
const SECOND_LINE = "col-span-2 md:col-span-4 md:order-2 min-[110rem]:col-span-1 min-[110rem]:order-none";
const STATUS_LINE = "col-span-2 md:col-span-9 min-[110rem]:col-span-11 md:order-3";
/** Money for the cost bar and the line totals. */
const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ONE_LINE_ONLY = "hidden min-[110rem]:block";
const EMPTY: RowValues = { part_number: "", part_type: "", brand: "", list_price: "", discount: "", cost_aed: "", supplier: "", availability: "", days: "", qty: "1" };
const num = (s: string) => Number(String(s).replace(",", ".")) || 0;
const stateOf = (r: TableRow, values = r.values): RowState => rowState(values, { unavailable: r.unavailable, removed: !!r.removed, waitingApproval: r.waitingApproval });

/**
 * The Parts pricing table: one row per part, every row saving itself as it is filled in. Part, Qty, Part number,
 * Type, List, Disc %, Net, Supplier, Availability and a three-dot menu. The discount fills in from the supplier,
 * the net is calculated, the quantity has − and +, the name can be corrected, a bundled row can be split. Rows keep
 * the order the page opened with and their height never changes; nothing redraws while someone is typing. The
 * counter at the top, the "Show only unpriced" filter and the bar at the bottom all read the same row states.
 */
export function PartsTable({ jobId, rows: initialRows, suppliers: initialSuppliers, types, canPrice, car, vin, openingLine, catalogue = [], lastImport = null, pricingDoneAt = null, onPricingDone = null, showBar = false, showCost = false, removeReasons = [], pricingLocked = false, onReopen = null, reopenedAt = null, tyreBrands = [], tyreModels = {}, tyreSizes = { front: "", rear: "" }, extraCosts = [] }: { /** Supplier charges (courier, freight): internal costs counted in "Our cost", per supplier. */ extraCosts?: { supplier: string; amount: number }[]; /** The tyre details window: brands and models from Settings, the car's sizes from the inspection. */ tyreBrands?: string[]; tyreModels?: Record<string, string[]>; tyreSizes?: { front: string; rear: string }; jobId: string; rows: TableRow[]; suppliers: SupplierOption[]; types: string[]; canPrice: boolean; car: string; vin: string | null; openingLine: string; /** The owner's parts pool for the picker. */ catalogue?: CatalogueRow[]; /** The last price import still in force, for "Undo last import". */ lastImport?: { id: string; count: number; at: string } | null; pricingDoneAt?: string | null; onPricingDone?: Action | null; showBar?: boolean; /** The cost bar and line totals: Parts, advisors and the owner only - never anything a customer sees. */ showCost?: boolean; /** One-tap reasons for "Remove: not needed" (Settings). */ removeReasons?: readonly string[]; /** Pricing done: every row is read-only until Edit. */ pricingLocked?: boolean; onReopen?: Action | null; /** Edit pressed after Pricing done: the bar offers "Send updated prices". */ reopenedAt?: string | null }) {
  const router = useRouter();
  const [rows, setRows] = useState<TableRow[]>(initialRows);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(initialSuppliers);
  // "+ Add a part the technician did not list": the categorised picker.
  const [adding, setAdding] = useState(false);
  // Bulk delete: the ticked rows, the question before it, and the minute of Undo after it.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<null | { count: number; kept: number; keys: TableRow[] | null }>(null);
  const [undo, setUndo] = useState<null | { batch: string; count: number; kept: number }>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // "Set for ticked": one availability, supplier or type for every ticked row.
  const [bulkAvail, setBulkAvail] = useState("");
  const [bulkSupplier, setBulkSupplier] = useState("");
  const [bulkType, setBulkType] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [importGone, setImportGone] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  // "Show only unpriced" is a snapshot: the rows shown stay put while they are being finished.
  const [onlyUnpriced, setOnlyUnpriced] = useState<Set<string> | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // "Pricing done" pressed with rows still open: they get a red outline until finished.
  const [attempted, setAttempted] = useState(false);
  const [seenLock, setSeenLock] = useState(`${pricingLocked}|${reopenedAt ?? ""}`);
  if (seenLock !== `${pricingLocked}|${reopenedAt ?? ""}`) {
    setSeenLock(`${pricingLocked}|${reopenedAt ?? ""}`);
    setAttempted(false);
  }
  const [lastJump, setLastJump] = useState<string | null>(null);
  // Rows added or changed elsewhere arrive on refresh; this screen keeps its order and what it holds for a row being edited.
  const [seen, setSeen] = useState(initialRows);
  if (seen !== initialRows) {
    setSeen(initialRows);
    setRows((cur) => {
      const incoming = new Map(initialRows.map((r) => [r.key, r]));
      const used = new Set<string>();
      const merged: TableRow[] = [];
      for (const r of cur) {
        const byKey = incoming.get(r.key);
        const byPart = !byKey && r.partId ? initialRows.find((x) => x.key === r.partId) : undefined;
        const server = byKey ?? byPart;
        if (server) {
          used.add(server.key);
          merged.push({ ...server, name: r.name, values: r.values });
        } else if (!r.partId && !r.requestId) merged.push(r);
      }
      for (const r of initialRows) if (!used.has(r.key)) merged.push(r);
      return merged;
    });
  }
  const [seenSup, setSeenSup] = useState(initialSuppliers);
  if (seenSup !== initialSuppliers) {
    setSeenSup(initialSuppliers);
    setSuppliers((cur) => [...initialSuppliers, ...cur.filter((c) => !initialSuppliers.some((s) => s.id === c.id))]);
  }
  const states = rows.map((r) => stateOf(r));
  const summary = pricingSummary(states);
  const shown = onlyUnpriced ? rows.filter((r) => onlyUnpriced.has(r.key)) : rows;
  const firstOpen = rows.find((r) => stateOf(r) === "not_finished");
  const firstOpenText = firstOpen ? `${firstOpen.name}: ${rowMissing(firstOpen.values).map((m) => m.long).join(", ") || "not finished"}` : null;

  function toggleUnpriced() {
    setOnlyUnpriced((cur) => (cur ? null : new Set(rows.filter((r) => stateOf(r) !== "priced" && stateOf(r) !== "removed").map((r) => r.key))));
  }
  function goNext() {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-row-state='not_finished']"));
    if (!els.length) return;
    const i = els.findIndex((el) => el.dataset.rowKey === lastJump);
    const el = els[(i + 1) % els.length];
    setLastJump(el.dataset.rowKey ?? null);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    // The cursor lands in the box outlined red (the missing piece), else in the first empty one.
    const marked = el.querySelector<HTMLInputElement | HTMLSelectElement>("input.border-red-bar, select.border-red-bar");
    const empty = Array.from(el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")).find((c) => !c.disabled && c.value.trim() === "" && c.getAttribute("aria-label") !== "Brand" && c.offsetParent !== null);
    (marked ?? empty)?.focus();
  }
  /** The picker's Done: one new row per part picked, with its quantity and positions; custom names are counted for the owner. */
  function addPicked(entries: { name: string; qty: number; positions: string[]; catalogue_id: string | null }[]) {
    setAdding(false);
    if (!entries.length) return;
    const stamp = Date.now();
    setRows((p) => [
      ...p,
      ...entries.map((e, i) => ({ key: `new:${stamp}-${i}`, requestId: null, partId: null, name: e.name, original: null, techQty: e.qty, info: "Added by Parts", values: { ...EMPTY, part_type: types[0] ?? "", qty: String(e.qty) }, positions: e.positions, shownPositions: e.positions, optionGroup: null, unavailable: false, closedReason: null, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null, perSet: false, removed: null, waitingApproval: false }) as TableRow),
    ]);
    const custom = entries.filter((e) => !e.catalogue_id).map((e) => e.name);
    if (custom.length) void noteCustomPartNames(custom);
  }
  function addOption(base: TableRow) {
    setRows((p) => {
      const i = p.findIndex((r) => r.key === base.key);
      const row: TableRow = { key: `opt:${Date.now()}`, requestId: base.requestId, partId: null, name: base.name, original: null, techQty: base.techQty, info: "Option: another type or brand for the same part", values: { ...EMPTY, qty: base.values.qty, part_type: "" }, optionGroup: base.optionGroup ?? base.partId, unavailable: false, closedReason: null, locked: false, orderLabel: null, diagramUrl: null, question: null, answer: null, perSet: base.perSet, removed: null, waitingApproval: false };
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
  const notFinished = summary.counts.not_finished;
  // "Our cost": every line that still counts (declined, not needed and returned lines do not), qty × net each.
  const countedRows = rows.filter((r) => { const s = stateOf(r); return s !== "removed" && s !== "not_available"; });
  const rowCost = (r: TableRow) => num(r.values.qty || "1") * num(r.values.cost_aed);
  const chargesCost = extraCosts.reduce((a, c) => a + c.amount, 0);
  const costTotal = countedRows.reduce((a, r) => a + rowCost(r), 0) + chargesCost;
  const costVat = Math.round(costTotal * 5) / 100;
  const selectedCost = countedRows.filter((r) => selected.has(r.key)).reduce((a, r) => a + rowCost(r), 0);
  const bySupplier = new Map<string, number>();
  for (const r of countedRows) {
    const c = rowCost(r);
    if (!c) continue;
    const s = r.values.supplier.trim() || "No supplier yet";
    bySupplier.set(s, (bySupplier.get(s) ?? 0) + c);
  }
  for (const c of extraCosts) bySupplier.set(c.supplier, (bySupplier.get(c.supplier) ?? 0) + c.amount);
  const supplierPairs = [...bySupplier.entries()].sort((a, b) => b[1] - a[1]);
  const costLine = showCost ? (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-0.5" data-cost-bar>
      <span className="text-sm font-bold">Our cost: AED {aed(costTotal)} + VAT 5% AED {aed(costVat)} = <span data-cost-grand>AED {aed(costTotal + costVat)}</span></span>
      {chargesCost ? <span className="text-xs text-muted" data-cost-charges>incl. supplier charges AED {aed(chargesCost)}</span> : null}
      {selectedCost ? <span className="text-sm font-semibold text-green" data-cost-selected>Selected: AED {aed(selectedCost)}</span> : null}
      {supplierPairs.length > 1 ? <span className="text-xs text-muted" data-cost-suppliers>{supplierPairs.map(([s, v]) => `${s} AED ${aed(v)}`).join(" · ")}</span> : null}
    </div>
  ) : null;

  /** "Set for ticked": the chosen availability, supplier or type is saved on every ticked row, one save each. */
  async function applyBulk() {
    const ticked = rows.filter((r) => selected.has(r.key) && !r.removed && !r.locked);
    if (!ticked.length || (!bulkAvail && !bulkSupplier && !bulkType)) return;
    setBulkBusy(true);
    setBulkError(null);
    const sup = bulkSupplier === "__stock" ? OUR_STOCK : suppliers.find((s) => s.id === bulkSupplier)?.name ?? "";
    for (const r of ticked) {
      const v: RowValues = { ...r.values };
      if (bulkAvail) Object.assign(v, availabilityFromChoice(bulkAvail as AvailabilityChoice, v.days));
      if (bulkSupplier) {
        const s = suppliers.find((x) => x.id === bulkSupplier);
        const discount = s ? String(supplierDiscount(s, v.part_type)) : v.discount;
        Object.assign(v, { supplier: sup, discount, cost_aed: netOf(v.list_price, discount) || v.cost_aed });
        if (isOurStock(sup)) Object.assign(v, { availability: "in_stock", days: "" });
      }
      if (bulkType) v.part_type = bulkType;
      const res = await autoSavePartRow(jobId, { requestId: r.requestId, partId: r.partId, clientKey: r.key, name: r.name, ...v, quantity: v.qty, positions: r.positions });
      if (res.error) { setBulkError(res.error); break; }
      setRows((p) => p.map((x) => (x.key === r.key ? { ...x, partId: res.partId ?? x.partId, values: v } : x)));
    }
    setBulkBusy(false);
    setSelected(new Set());
    setBulkAvail(""); setBulkSupplier(""); setBulkType("");
    refreshWhenIdle(() => router.refresh());
  }

  /** Rows that can be ticked and deleted: live rows (not already removed). */
  const deletable = rows.filter((r) => !r.removed);
  const allTicked = deletable.length > 0 && deletable.every((r) => selected.has(r.key));
  function toggleAll() {
    setSelected(allTicked ? new Set() : new Set(deletable.map((r) => r.key)));
  }
  /** "Delete all": the ticked rows, or every unordered row of the job when none is ticked. One question, then it goes. */
  function askDelete() {
    const ticked = deletable.filter((r) => selected.has(r.key));
    const targets = ticked.length ? ticked : deletable;
    const kept = targets.filter((r) => r.locked).length;
    const count = targets.length - kept;
    setBulkError(null);
    setConfirmDelete({ count, kept, keys: ticked.length ? ticked : null });
  }
  async function doDelete() {
    const c = confirmDelete;
    if (!c) return;
    setConfirmDelete(null);
    setBulkBusy(true);
    const keys = c.keys ? { partIds: c.keys.map((r) => r.partId).filter((x): x is string => !!x), requestIds: c.keys.filter((r) => !r.partId && r.requestId).map((r) => r.requestId as string) } : null;
    const localOnly = (c.keys ?? deletable).filter((r) => !r.partId && !r.requestId);
    const res: { error?: string; deleted?: number; kept?: number; batch?: string | null } = keys && !keys.partIds.length && !keys.requestIds.length ? { deleted: 0, kept: 0, batch: null } : await bulkDeleteParts(jobId, keys);
    setBulkBusy(false);
    if (res.error) {
      setBulkError(res.error);
      return;
    }
    const goneKeys = new Set<string>([...(c.keys ?? deletable).filter((r) => !r.locked).map((r) => r.key), ...localOnly.map((r) => r.key)]);
    // The rows vanish at once; nothing else moves.
    setRows((p) => p.filter((r) => !goneKeys.has(r.key)));
    setSelected(new Set());
    const deleted = (res.deleted ?? 0) + localOnly.length;
    if (res.batch && (res.deleted ?? 0) > 0) {
      setUndo({ batch: res.batch, count: deleted, kept: res.kept ?? 0 });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 60_000);
    } else setUndo(deleted || res.kept ? { batch: "", count: deleted, kept: res.kept ?? 0 } : null);
  }
  async function undoDelete() {
    const u = undo;
    if (!u || !u.batch) return;
    setBulkBusy(true);
    const r = await undoBulkDelete(jobId, u.batch);
    setBulkBusy(false);
    if (r.error) setBulkError(r.error);
    else {
      setUndo(null);
      refreshWhenIdle(() => router.refresh());
    }
  }
  async function undoLastImport() {
    if (!lastImport) return;
    setBulkBusy(true);
    const r = await undoImport(jobId, lastImport.id);
    setBulkBusy(false);
    if (r.error) setBulkError(r.error);
    else {
      setImportGone(true);
      refreshWhenIdle(() => router.refresh());
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <span className="text-sm font-bold" data-pricing-counter>{summary.text}</span>
          <span className="h-1.5 w-full max-w-xs rounded-full bg-track overflow-hidden"><span className="block h-full bg-ink" style={{ width: `${summary.total ? Math.round((summary.done / summary.total) * 100) : 0}%` }} /></span>
        </div>
        {canPrice && !pricingLocked && selected.size > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 rounded-control border border-ink bg-white px-2 py-1" data-bulk-set>
            <span className="text-xs font-bold">Set for {selected.size} ticked:</span>
            <select value={bulkAvail} onChange={(e) => setBulkAvail(e.target.value)} className="h-9 rounded-control border border-line-strong bg-white px-1.5 text-sm" aria-label="Availability for the ticked parts" data-bulk-availability>
              <option value="">Availability…</option>
              {AVAILABILITY_CHOICES.filter((c) => c.value !== "other").map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={bulkSupplier} onChange={(e) => setBulkSupplier(e.target.value)} className="h-9 rounded-control border border-line-strong bg-white px-1.5 text-sm" aria-label="Supplier for the ticked parts" data-bulk-supplier>
              <option value="">Supplier…</option>
              <option value="__stock">{OUR_STOCK}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={bulkType} onChange={(e) => setBulkType(e.target.value)} className="h-9 rounded-control border border-line-strong bg-white px-1.5 text-sm" aria-label="Type for the ticked parts" data-bulk-type>
              <option value="">Type…</option>
              {types.map((t) => <option key={t} value={t}>{PART_TYPE_LABELS[t as keyof typeof PART_TYPE_LABELS] ?? t}</option>)}
            </select>
            <Button type="button" size="md" onClick={() => void applyBulk()} disabled={bulkBusy || (!bulkAvail && !bulkSupplier && !bulkType)} data-bulk-apply>Apply</Button>
          </span>
        ) : null}
        {canPrice && !pricingLocked ? (
          <Button type="button" tone="danger" size="md" onClick={askDelete} disabled={bulkBusy || deletable.length === 0} data-delete-all>
            {selected.size ? `Delete ${selected.size} ticked` : "Delete all"}
          </Button>
        ) : null}
        {undo ? (
          <span className="inline-flex min-h-10 items-center gap-2 rounded-control bg-ink px-3 text-sm font-semibold text-white" data-delete-toast>
            {undo.count} part{undo.count === 1 ? "" : "s"} deleted{undo.kept ? ` · ${undo.kept} ordered part${undo.kept === 1 ? " was" : "s were"} kept` : ""}
            {undo.batch ? <button type="button" onClick={() => void undoDelete()} className="rounded-control bg-white px-2.5 py-1 text-xs font-bold text-ink" data-undo-delete>Undo</button> : null}
          </span>
        ) : null}
        {bulkError ? <span className="text-sm font-semibold text-red">{bulkError}</span> : null}
        <button type="button" onClick={toggleUnpriced} aria-pressed={!!onlyUnpriced} className={`min-h-10 rounded-control border px-3 text-xs font-bold ${onlyUnpriced ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{onlyUnpriced ? "✓ " : ""}Show only unpriced</button>
        <Button type="button" tone="secondary" size="md" onClick={() => setListOpen(true)}>Copy list for supplier</Button>
        {showCost ? <a href={`/api/pdf/parts-check/${jobId}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-print-pdf>Print / PDF</a> : null}
        {canPrice && !pricingLocked ? <a href={`/parts/${jobId}/import`} className="inline-flex min-h-10 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-import-prices>Import prices</a> : null}
        {canPrice && !pricingLocked && lastImport && !importGone ? (
          <button type="button" onClick={() => void undoLastImport()} disabled={bulkBusy} className="inline-flex min-h-10 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" title={`${lastImport.count} line${lastImport.count === 1 ? "" : "s"} imported ${formatDateTime(lastImport.at)}`} data-undo-import>
            Undo last import ({lastImport.count})
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <div className={`${GRID} hidden md:grid border-b border-line pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted`}>
          <span className="flex items-center gap-1.5">
            {canPrice && !pricingLocked ? <input type="checkbox" aria-label="Select all parts" checked={allTicked} onChange={toggleAll} disabled={deletable.length === 0} className="h-4 w-4 accent-ink" data-select-all /> : null}
            Part
          </span><span>Qty</span><span className={ONE_LINE_ONLY}>Part number</span><span className={ONE_LINE_ONLY}>Type</span><span className="text-right">List</span><span className="text-right">Disc %</span><span className="text-right">Net each</span><span>Supplier</span><span>Availability</span><span className="text-right">Line total</span><span />
        </div>
        <div className="flex flex-col gap-1.5 pt-1.5">
          {shown.map((r) => (
            <Row key={r.key} jobId={jobId} row={r} suppliers={suppliers} types={types} catalogue={catalogue} tyreBrands={tyreBrands} tyreModels={tyreModels} tyreSizes={tyreSizes} canPrice={canPrice} pricingLocked={pricingLocked} attempted={attempted} removeReasons={removeReasons} selected={selected.has(r.key)} onSelect={(on) => setSelected((s) => { const n = new Set(s); if (on) n.add(r.key); else n.delete(r.key); return n; })} onValues={(name, values) => setRows((p) => p.map((x) => (x.key === r.key ? { ...x, name, values } : x)))} onSaved={(partId, name, values) => setRows((p) => p.map((x) => (x.key === r.key ? { ...x, partId, name, values } : x)))} onAddOption={() => addOption(r)} onAddSupplier={addSupplier} onRemovedLocal={() => setRows((p) => p.filter((x) => x.key !== r.key))} />
          ))}
          {shown.length === 0 ? <p className="py-3 text-sm text-muted">{onlyUnpriced ? "Every part has a price." : "No parts on this job yet."}</p> : null}
        </div>
      </div>
      {canPrice && !pricingLocked ? <Button type="button" tone="secondary" size="md" onClick={() => setAdding(true)} className="self-start" data-add-part>+ Add a part the technician did not list</Button> : null}
      {adding ? <PartPicker title="Add parts" catalogue={catalogue} selected={[]} itemKey={null} source="custom" onDone={(entries) => addPicked(entries.map((e) => ({ name: e.name, qty: e.qty, positions: e.positions, catalogue_id: e.catalogue_id })))} onClose={() => setAdding(false)} /> : null}
      <datalist id="part-pool">{catalogue.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      {listOpen ? <SupplierList rows={rows} car={car} vin={vin} openingLine={openingLine} onClose={() => setListOpen(false)} /> : null}
      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()} data-delete-confirm>
            <span className="text-lg font-extrabold">{confirmDelete.count ? `Delete ${confirmDelete.count} part${confirmDelete.count === 1 ? "" : "s"}?` : "Nothing to delete"}</span>
            {confirmDelete.kept ? <p className="text-sm text-muted">{confirmDelete.kept} ordered part{confirmDelete.kept === 1 ? " is" : "s are"} kept: once ordered, received or fitted a part is never deleted here.</p> : null}
            {confirmDelete.count ? <p className="text-xs text-muted">The rows disappear at once and come off the quotation. Undo is there for a minute.</p> : null}
            <div className="flex flex-wrap gap-2">
              {confirmDelete.count ? <Button type="button" size="md" tone="danger" onClick={() => void doDelete()} data-delete-confirm-yes>Delete</Button> : null}
              <Button type="button" tone="ghost" size="md" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
      {showBar && onPricingDone && pricingLocked ? (
        <div className="fixed bottom-0 left-0 right-0 nav:left-60 z-40 border-t border-line bg-white px-4 py-2.5" data-pricing-bar>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            {costLine}
            <span className="inline-flex min-h-10 items-center gap-2 rounded-control bg-green-soft px-3 text-sm font-bold text-green" data-pricing-locked>✓ Pricing done{pricingDoneAt ? ` · ${formatDateTime(pricingDoneAt)}` : ""}</span>
            <span className="text-xs text-muted" data-bar-text>{summary.text}</span>
            {onReopen ? <form action={onReopen} className="ml-auto"><button type="submit" className="min-h-12 rounded-control border border-line-strong bg-white px-5 text-sm font-bold" data-pricing-edit>Edit</button></form> : null}
          </div>
        </div>
      ) : null}
      {showBar && onPricingDone && !pricingLocked ? (
        <div className="fixed bottom-0 left-0 right-0 nav:left-60 z-40 border-t border-line bg-white px-4 py-2.5" data-pricing-bar>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            {costLine}
            {reopenedAt ? <span className="text-xs font-semibold text-amber" data-pricing-editing>Editing: the advisor sees the old prices until you press Send updated prices</span> : pricingDoneAt ? <span className="text-xs font-semibold text-green">✓ Sent to the advisor, {formatDateTime(pricingDoneAt)}</span> : null}
            {attempted && summary.open ? (
              <span className="text-sm font-semibold text-red" data-bar-text>
                {notFinished ? `${notFinished} part${notFinished === 1 ? "" : "s"} not finished` : ""}
                {notFinished && firstOpenText ? ` · ${firstOpenText}` : ""}
                {summary.counts.waiting_approval ? `${notFinished ? " · " : ""}${summary.counts.waiting_approval} waiting for owner approval` : ""}
              </span>
            ) : (
              <span className="text-xs text-muted" data-bar-text>{summary.open === 0 && summary.total ? `Every part is priced or marked not available (${summary.text})` : summary.text}</span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {attempted && notFinished ? <button type="button" onClick={goNext} className="min-h-12 rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Go to next</button> : null}
              {summary.open === 0 ? (
                <form action={onPricingDone}><input type="hidden" name="force" value="" /><button type="submit" className="min-h-12 rounded-control bg-ink px-5 text-sm font-bold text-white">{reopenedAt ? "Send updated prices" : pricingDoneAt ? "Pricing done again" : "Pricing done"}</button></form>
              ) : attempted ? (
                <form action={onPricingDone}><input type="hidden" name="force" value="1" /><button type="submit" className="min-h-12 rounded-control bg-ink px-4 text-sm font-bold text-white">{reopenedAt ? "Send updated prices" : "Send what you have"}</button></form>
              ) : (
                <button type="button" onClick={() => setAttempted(true)} className="min-h-12 rounded-control bg-ink px-5 text-sm font-bold text-white">{reopenedAt ? "Send updated prices" : pricingDoneAt ? "Pricing done again" : "Pricing done"}</button>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {showCost && !(showBar && onPricingDone) ? (
        <div className="fixed bottom-0 left-0 right-0 nav:left-60 z-40 border-t border-line bg-white px-4 py-2.5" data-pricing-bar>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">{costLine}</div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ jobId, row, suppliers, types, catalogue, tyreBrands, tyreModels, tyreSizes, canPrice, pricingLocked, attempted, removeReasons, selected, onSelect, onValues, onSaved, onAddOption, onAddSupplier, onRemovedLocal }: { jobId: string; row: TableRow; suppliers: SupplierOption[]; types: string[]; catalogue: CatalogueRow[]; tyreBrands: string[]; tyreModels: Record<string, string[]>; tyreSizes: { front: string; rear: string }; canPrice: boolean; pricingLocked: boolean; selected: boolean; onSelect: (on: boolean) => void; attempted: boolean; removeReasons: readonly string[]; onValues: (name: string, values: RowValues) => void; onSaved: (partId: string | null, name: string, values: RowValues) => void; onAddOption: () => void; onAddSupplier: () => Promise<SupplierOption | null>; onRemovedLocal: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<RowValues>(row.values);
  const [name, setName] = useState(row.name);
  const [partId, setPartId] = useState<string | null>(row.partId);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState<null | "down" | "up">(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // The tyre details window; the details ride along with the next save.
  const [tyreOpen, setTyreOpen] = useState(false);
  const tyreRef = useRef<TyreSpec | null>(null);
  // "Edit part name": the categorised picker in rename mode; one tap picks the new name.
  const [editingName, setEditingName] = useState(false);
  // The technician's words, kept on the row from the moment the name changes (the server stores them on save).
  const [origin] = useState(() => row.original ?? row.name);
  const [otherMode, setOtherMode] = useState(() => availabilityChoice(row.values) === "other" && !daysComplete(row.values.days));
  const [copied, setCopied] = useState(false);
  // Price memory: the last price given for this part number, offered with one tap while the price boxes are empty.
  const [memory, setMemory] = useState<{ list: number | null; discount: number | null; net: number | null; supplier: string | null; part_type: string | null; brand: string | null; when: string | null; job: string | null } | null>(null);
  const [split, setSplit] = useState(false);
  // "Remove: not needed": which kind of row is being removed, and the few seconds of Undo after it.
  const [removing, setRemoving] = useState<null | "part" | "request" | "ordered">(null);
  const [undo, setUndo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ v, name });
  // The saved part's id as the server last told us, and the saves in a chain: a second change while the first save is
  // still on its way must see the part the first one made, never make a second one.
  const partIdRef = useRef<string | null>(row.partId);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const optionOf = (row as TableRow & { optionOf?: string }).optionOf ?? null;
  /** The picker's answer: the new name goes to the row and is saved; a custom name is counted for the owner. */
  function renameTo(newName: string, pool: CatalogueRow | null) {
    setEditingName(false);
    const clean = newName.trim();
    if (!clean || clean === latest.current.name) return;
    queue(latest.current.v, clean);
    flushNow();
    if (!pool) void noteCustomPartNames([clean]);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Typing that never reached the server (a reload, a sleeping tablet) comes back and is saved again.
  useEffect(() => {
    const d = readPending<{ v: RowValues; name: string }>(pendingKey);
    if (!d || readOnly) return;
    const t = setTimeout(() => {
      queue(d.v, d.name);
      flushNow();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = stateOf(row, v);
  const missing = state === "not_finished" ? rowMissing(v) : [];
  const complete = state === "priced";
  const partial = state === "not_finished" && Object.entries(v).some(([k, x]) => k !== "qty" && !k.startsWith("tyre_") && String(x ?? "").trim() !== "" && !(k === "part_type" && x === (types[0] ?? "")));
  const red = attempted && state === "not_finished";
  const tone = row.removed ? "border-line bg-canvas opacity-60" : red ? "border-red-bar bg-white" : focused ? `border-ink ${complete ? "bg-green-soft" : "bg-chip"}` : row.waitingApproval ? "border-amber-bar bg-amber-soft/40" : row.unavailable ? "border-line bg-amber-soft/60" : complete ? "border-green bg-green-soft" : "border-line bg-white";
  const supplier = suppliers.find((s) => s.name.toLowerCase() === v.supplier.toLowerCase());
  const standard = supplier ? supplierDiscount(supplier, v.part_type) : null;
  const standardNote = standard !== null && v.discount.trim() !== "" && Math.abs(Number(v.discount.replace(",", ".")) - standard) > 0.001 ? `Standard ${standard}%, changed to ${v.discount}%` : "";
  const qty = num(v.qty) || 1;
  const qtyChanged = Math.abs(qty - row.techQty) > 0.001;
  const baseChoice = availabilityChoice(v, otherMode);
  // Days typed under "Other…" (say 15) become their own choice, "15 days", in the one box; the days box shows only while typing.
  const customDays = baseChoice === "other" && !otherMode && daysComplete(v.days) ? v.days.trim() : null;
  const choice = customDays ? (`d${customDays}` as AvailabilityChoice) : baseChoice;
  const missingField = (f: string) => red && missing.some((m) => m.field === f);

  const pendingKey = `parts:${jobId}:${row.key}`;
  function queue(nextV: RowValues, nextName: string) {
    latest.current = { v: nextV, name: nextName };
    writePending(pendingKey, { v: nextV, name: nextName });
    setV(nextV);
    setName(nextName);
    onValues(nextName, nextV);
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
  const lookupMemory = async () => {
    const pn = latest.current.v.part_number.trim();
    if (latest.current.v.cost_aed || latest.current.v.list_price || pn.length < 4) { setMemory(null); return; }
    try {
      const res = await fetch(`/api/parts/price-memory?pn=${encodeURIComponent(pn)}`);
      const j = (await res.json()) as { memory: { list_price: number | null; discount: number | null; net: number | null; supplier: string | null; part_type: string | null; brand: string | null; priced_at: string | null; job_number: string | null } | null };
      setMemory(j.memory ? { list: j.memory.list_price, discount: j.memory.discount, net: j.memory.net, supplier: j.memory.supplier, part_type: j.memory.part_type, brand: j.memory.brand, when: j.memory.priced_at, job: j.memory.job_number } : null);
    } catch { setMemory(null); }
  };
  const useMemory = () => {
    if (!memory) return;
    const cur = latest.current.v;
    change({ list_price: memory.list !== null ? String(memory.list) : cur.list_price, discount: memory.discount !== null ? String(memory.discount) : cur.discount, cost_aed: memory.net !== null ? String(memory.net) : cur.cost_aed, supplier: memory.supplier ?? cur.supplier, part_type: memory.part_type ?? cur.part_type, brand: memory.brand ?? cur.brand });
    setMemory(null);
  };
  const changeAvailability = (c: AvailabilityChoice, el: HTMLSelectElement) => {
    setOtherMode(c === "other");
    change(availabilityFromChoice(c, latest.current.v.days));
    // "Other…": the cursor moves into the days box beside the dropdown.
    if (c === "other") requestAnimationFrame(() => el.closest<HTMLElement>("[data-row-key]")?.querySelector<HTMLInputElement>("input[aria-label='Days until it arrives']")?.focus());
  };
  const flushNow = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void persist(latest.current.v, latest.current.name);
    }
  };
  async function persist(next: RowValues, nextName: string) {
    const run = chain.current.then(async () => {
      setSaving(true);
      const tyre = tyreRef.current;
      tyreRef.current = null;
      const res = await autoSavePartRow(jobId, { requestId: row.requestId, partId: partIdRef.current, optionOf, clientKey: row.key, name: nextName, ...next, quantity: next.qty, positions: row.positions, ...(tyre ? { tyre } : {}) });
      setSaving(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      if (latest.current.v === next && latest.current.name === nextName) clearPending(pendingKey);
      if (res.partId && res.partId !== partIdRef.current) {
        partIdRef.current = res.partId;
        setPartId(res.partId);
      }
      onSaved(res.partId ?? partIdRef.current, nextName, next);
      if (res.complete) start(() => refreshWhenIdle(() => router.refresh()));
    });
    chain.current = run.catch(() => undefined);
    await run.catch((e) => {
      setSaving(false);
      // A new version is live: the page reloads and the typed price comes back from the browser and saves again.
      if (!reloadIfStale(e)) setError("Not saved: no connection. It is kept here and saves again when you edit.");
    });
  }
  const run = (fn: () => Promise<unknown>) => start(async () => { try { await fn(); } catch (e) { /* a redirect ends the action; a new version reloads */ if (reloadIfStale(e)) return; } refreshWhenIdle(() => router.refresh()); });
  const openMenu = () => {
    if (menu) {
      setMenu(null);
      return;
    }
    const r = menuRef.current?.getBoundingClientRect();
    // Near the bottom of the screen the menu opens upwards, never under the fixed bar.
    setMenuAnchor(menuRef.current);
    setMenu(r && window.innerHeight - r.bottom < 340 ? "up" : "down");
  };
  const copyPn = async () => {
    try {
      await navigator.clipboard.writeText(v.part_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const readOnly = row.unavailable || !canPrice || row.locked || !!row.removed || pricingLocked;
  const removeTarget = partId ? { partId } : { requestId: row.requestId };
  const doRemove = (kind: "part" | "request" | "ordered", reason: string, disposition?: "returned" | "stock") => {
    const fd = new FormData();
    fd.set("reason", reason);
    if (disposition) fd.set("disposition", disposition);
    run(async () => {
      const r = kind === "ordered" && partId ? await notNeededFromParts(jobId, partId, fd) : await removeNotNeeded(jobId, removeTarget, fd);
      if (r.error) setError(r.error);
      else if (kind !== "ordered") {
        setUndo(true);
        setTimeout(() => setUndo(false), 6000);
      }
    });
  };
  const box = (f: string, extra = "") => `h-9 min-h-9 text-sm ${extra} ${missingField(f) ? "border-red-bar" : ""}`;
  const select = (f: string) => `h-9 w-full min-w-0 rounded-control border bg-white px-1.5 text-sm ${missingField(f) ? "border-red-bar" : "border-line-strong"}`;
  const textCell = (t: string, extra = "") => <span className={`h-9 flex items-center min-w-0 truncate text-sm ${extra}`} title={t}>{t}</span>;
  const wrote = row.original ?? (row.requestId ? origin : null);
  const notes = [row.removed ? `Removed by ${row.removed.by}: ${row.removed.reason}` : "", row.info, standardNote, wrote && wrote !== name ? `Technician wrote: ${wrote}` : "", qtyChanged ? `Technician asked for ${row.techQty}, Parts changed to ${qty}` : "", row.question ? `Asked the manager: ${row.question}${row.answer ? ` · ${row.answer}` : " · waiting"}` : "", row.unavailable && row.closedReason ? row.closedReason : ""].filter(Boolean).join(" · ");
  const detailsInPartNumber = isGenericTyreName(name) && /\s/.test(v.part_number.trim());
  const tag = error ? { text: error, cls: "font-semibold text-red" } : saving ? { text: "Saving…", cls: "text-muted" } : detailsInPartNumber ? { text: "Add the details to the name (tap Tyre details). Part numbers aren't shown to customers.", cls: "font-semibold text-amber" } : red ? { text: missing.map((m) => m.short).join(" · "), cls: "font-bold text-red" } : partial && !row.unavailable ? { text: `Not finished: ${missing.map((m) => m.long).join(", ")}`, cls: "text-muted" } : { text: "", cls: "" };

  return (
    <div data-row-key={row.key} data-row-state={state} className={`${GRID} rounded-control border px-2 py-1 ${tone}`} onFocusCapture={() => setFocused(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setFocused(false); flushNow(); } }}>
      {/* Part: the name (tap to correct it through the picker); a long name wraps onto two or three lines and the row grows with it */}
      <div className="col-span-2 md:col-span-1 min-h-9 flex items-center gap-1.5 min-w-0">
        {canPrice && !row.removed ? <input type="checkbox" aria-label={`Select ${name}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} className="h-4 w-4 shrink-0 accent-ink" data-row-select /> : null}
        <span className={`w-4 shrink-0 text-center text-green font-extrabold ${complete ? "" : "invisible"}`} aria-label={complete ? "priced" : undefined}>✓</span>
        <button type="button" disabled={readOnly} onClick={() => setEditingName(true)} className={`min-h-9 min-w-0 flex-1 py-0.5 text-left font-bold disabled:cursor-default overflow-hidden ${row.removed ? "line-through text-muted" : ""}`} title={readOnly ? name : `${name} · tap to correct the name`} data-part-name>
          <span className="block break-words text-[13px] uppercase leading-[1.15]">{name}</span>
          <PositionsLine positions={row.shownPositions ?? row.positions} className="leading-tight" />
        </button>
        {(isTyreName(name) || v.tyre_row) && !readOnly ? (
          <button type="button" onClick={() => setTyreOpen(true)} className={`h-9 shrink-0 rounded-control border px-2 text-xs font-bold ${v.tyre_row && (!v.tyre_brand || !v.tyre_size) ? "border-amber-bar bg-amber-soft text-amber" : "border-line-strong bg-white"}`} data-tyre-details>
            Tyre details
          </button>
        ) : null}
        {tyreOpen ? (
          <TyreBuilder
            initial={parseTyreSpec(null) ?? (v.tyre_brand || v.tyre_size ? { brand: v.tyre_brand ?? "", model: "", size: v.tyre_size ?? "", year: "", marks: [] } : null)}
            defaultSize={v.tyre_size || tyreSizeIn(name) || ((row.positions ?? []).some((p) => /rear/i.test(p)) ? tyreSizes.rear : tyreSizes.front) || ""}
            brands={tyreBrands}
            models={tyreModels}
            onApply={(spec) => {
              setTyreOpen(false);
              tyreRef.current = spec;
              queue({ ...latest.current.v, tyre_row: true, tyre_brand: spec.brand, tyre_size: spec.size, brand: spec.brand }, tyreName(spec));
            }}
            onClose={() => setTyreOpen(false)}
          />
        ) : null}
        {row.diagramUrl ? <a href={row.diagramUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-bold underline underline-offset-4">Diagram</a> : null}
        {editingName && !readOnly ? <PartPicker title={`Correct the name: ${name}`} catalogue={catalogue} selected={[]} itemKey={null} mode="rename" onPick={renameTo} onClose={() => setEditingName(false)} /> : null}
      </div>
      {/* Qty: − and +, and the box itself */}
      <span className="h-9 inline-flex items-center gap-0.5">
        <button type="button" disabled={readOnly || qty <= 1} onClick={() => change({ qty: String(Math.max(1, Math.round(qty) - 1)) })} className="h-9 w-7 rounded-control border border-line-strong bg-white text-sm font-bold disabled:opacity-40" aria-label="One less">−</button>
        <Input value={v.qty} onChange={(e) => change({ qty: e.target.value })} inputMode="decimal" disabled={readOnly} aria-label="Quantity" className="h-9 min-h-9 w-10 px-0.5 text-center text-sm font-bold" />
        <button type="button" disabled={readOnly} onClick={() => change({ qty: String(Math.round(qty) + 1) })} className="h-9 w-7 rounded-control border border-line-strong bg-white text-sm font-bold disabled:opacity-40" aria-label="One more">+</button>
        {row.perSet ? <span className="text-[10px] text-muted">sets</span> : null}
      </span>
      {/* Part number: always a box (never swapped for text while the row is open), with Copy beside it */}
      <span className={`${SECOND_LINE} h-9 flex items-center gap-1 min-w-0`}>
        {readOnly ? textCell(v.part_number || "No part number", "flex-1 font-semibold") : (
          <Input value={v.part_number} onChange={(e) => change({ part_number: e.target.value })} onBlur={() => void lookupMemory()} placeholder="Part number" textCase="upper" className={box("part_number", "w-full min-w-0 flex-1 px-2")} aria-label="Part number" />
        )}
        <button type="button" onClick={copyPn} disabled={!v.part_number} className={`shrink-0 h-9 w-12 rounded-control border border-line text-[11px] font-bold ${v.part_number ? "" : "invisible"}`} aria-label="Copy the part number">{copied ? "✓" : "Copy"}</button>
      </span>
      {/* Type and brand on one line; the brand box keeps its place when it does not apply */}
      <span className={`${SECOND_LINE} h-9 flex items-center gap-1 min-w-0`}>
        {readOnly ? textCell(v.part_type ? (PART_TYPE_LABELS[v.part_type] ?? v.part_type) + (v.brand ? ` · ${v.brand}` : "") : "") : (
          <>
            <select value={v.part_type} onChange={(e) => changeType(e.target.value)} className={`${select("part_type")} basis-[58%] min-w-[6.5rem]`} aria-label="Type">
              <option value="">Type…</option>
              {types.map((t) => <option key={t} value={t}>{PART_TYPE_LABELS[t] ?? t}</option>)}
            </select>
            <Input value={v.brand} onChange={(e) => change({ brand: e.target.value })} placeholder="Brand" className={`h-9 min-h-9 basis-[42%] min-w-0 px-2 text-xs ${v.part_type && v.part_type !== "genuine" ? "" : "invisible"}`} textCase="title" aria-label="Brand" tabIndex={v.part_type && v.part_type !== "genuine" ? undefined : -1} />
          </>
        )}
      </span>
      {/* List, Disc %, Net */}
      {readOnly ? (
        <>
          {textCell(v.list_price ? Number(v.list_price).toLocaleString("en-GB", { minimumFractionDigits: 2 }) : "", "justify-end")}
          {textCell(v.discount ? `${v.discount}%` : "", "justify-end")}
          {textCell(v.cost_aed ? Number(v.cost_aed).toLocaleString("en-GB", { minimumFractionDigits: 2 }) : "", "justify-end font-semibold")}
        </>
      ) : (
        <>
          <Input value={v.list_price} onChange={(e) => changeList(e.target.value)} inputMode="decimal" placeholder="List" className={box("list_price", "text-right px-1")} aria-label="List price" />
          <Input value={v.discount} onChange={(e) => changeDisc(e.target.value)} inputMode="decimal" placeholder="%" className={box("discount", "text-right px-1")} aria-label="Discount percent" />
          <Input value={v.cost_aed} onChange={(e) => changeNet(e.target.value)} inputMode="decimal" placeholder="Net" className={box("cost_aed", "text-right px-1 font-semibold")} aria-label="Cost before VAT" />
        </>
      )}
      {/* Supplier: from the list, with Add a supplier at the bottom */}
      {readOnly ? textCell(v.supplier) : (
        <select
          value={isOurStock(v.supplier) ? "__stock" : supplier ? supplier.id : v.supplier ? "__text" : ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "__add") void onAddSupplier().then((s) => { if (s) changeSupplier(s, s.name); });
            else if (val === "__stock") { setOtherMode(false); change({ supplier: OUR_STOCK, availability: "in_stock", days: "" }); }
            else if (val === "") changeSupplier(undefined, "");
            else if (val !== "__text") { const s = suppliers.find((x) => x.id === val); if (s) changeSupplier(s, s.name); }
          }}
          className={select("supplier")}
          aria-label="Supplier"
        >
          <option value="">Supplier…</option>
          <option value="__stock">{OUR_STOCK}</option>
          {!supplier && v.supplier && !isOurStock(v.supplier) ? <option value="__text">{v.supplier}</option> : null}
          {/* The name only, so it shows in full; the standard discount lands in the Disc box when the supplier is picked */}
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="__add">+ Add a supplier…</option>
        </select>
      )}
      {/* Availability: one dropdown, the days box beside it only for Other */}
      {readOnly ? textCell(availabilityWords(v.availability, v.days)) : (
        <span className="h-9 flex items-center gap-1 min-w-0">
          <select value={choice} onChange={(e) => changeAvailability(e.target.value as AvailabilityChoice, e.currentTarget)} className={`${select(v.availability === "to_order" ? "days" : "availability")} flex-1`} aria-label="Availability">
            <option value="">Availability…</option>
            {AVAILABILITY_CHOICES.map((c) => (c.value === "other" ? [customDays ? <option key="custom" value={`d${customDays}`}>{availabilityWords("to_order", customDays)}</option> : null, <option key={c.value} value={c.value}>{c.label}</option>] : <option key={c.value} value={c.value}>{c.label}</option>))}
          </select>
          {/* The days box is there only for Other…, so the dropdown shows its full text the rest of the time (the row's height never changes) */}
          {choice === "other" ? <Input value={v.days} onChange={(e) => change({ days: e.target.value })} onBlur={() => { if (daysComplete(latest.current.v.days)) setOtherMode(false); }} inputMode="numeric" placeholder="days" className={`h-9 min-h-9 w-14 shrink-0 px-1 text-xs text-center ${missingField("days") ? "border-red-bar" : ""}`} aria-label="Days until it arrives" /> : null}
        </span>
      )}
      {/* Line total: qty × net each. A removed or not-available line shows a dash and counts nowhere. */}
      <span className="hidden md:flex h-9 items-center justify-end text-sm font-semibold tabular-nums" data-line-total>
        {state === "removed" || state === "not_available" ? "—" : aed(num(v.qty || "1") * num(v.cost_aed))}
      </span>
      {/* The three-dot menu: narrow, always visible, opens upwards near the bottom */}
      <div className="relative h-9 flex items-center justify-end">
        {canPrice ? (
          <>
            <button ref={menuRef} type="button" onClick={openMenu} aria-label="More for this part" aria-expanded={!!menu} className={`h-9 min-w-9 rounded-control border text-base font-bold ${menu ? "border-ink bg-ink text-white" : "border-line"}`}>⋯</button>
            {menu ? (
              <FloatingMenu anchor={menuAnchor} onClose={() => setMenu(null)} label="More for this part" data-part-menu="">
                  {!readOnly ? <MenuItem label="Edit part name" onClick={() => { setMenu(null); setEditingName(true); }} /> : null}
                  {partId && !row.locked ? <MenuItem label="Split into separate parts" onClick={() => { setMenu(null); setSplit(true); }} /> : null}
                  {partId && complete && !row.locked ? <MenuItem label="Add an option for this part" onClick={() => { setMenu(null); onAddOption(); }} /> : null}
                  {partId ? <MenuItem label="Attach diagram" onClick={() => { setMenu(null); fileRef.current?.click(); }} /> : null}
                  {partId && (!row.question || row.answer) ? <MenuItem label="Ask the workshop manager" onClick={() => { setMenu(null); const q = window.prompt("Your question for the workshop manager", "Is this the right part?"); if (q !== null) { const fd = new FormData(); fd.set("question", q); run(() => askManager(partId, fd)); } }} /> : null}
                  {row.requestId && !row.unavailable && !partId ? <MenuItem label="Not available" onClick={() => { setMenu(null); const note = window.prompt("Not available. A note for the advisor (optional)", ""); if (note !== null) { const fd = new FormData(); fd.set("note", note); run(() => markRequestUnavailable(row.requestId!, fd)); } }} /> : null}
                  {row.requestId && !partId ? <MenuItem label="Already covered in another request" onClick={() => { setMenu(null); run(() => coverRequest(row.requestId!)); }} /> : null}
                  {row.requestId && !partId ? <MenuItem label="Cannot source: close the request" onClick={() => { setMenu(null); const note = window.prompt("Why is this request closed? (shown to the advisor)", ""); if (note && note.trim().length >= 3) { const fd = new FormData(); fd.set("note", note); run(() => closePartRequest(row.requestId!, fd)); } }} /> : null}
                  {partId && !row.locked && !row.removed ? <MenuItem label="Remove: not needed" red onClick={() => { setMenu(null); setRemoving("part"); }} /> : null}
                  {!partId && row.requestId && !row.removed ? <MenuItem label="Remove: not needed" red onClick={() => { setMenu(null); setRemoving("request"); }} /> : null}
                  {partId && row.locked && !row.removed ? <MenuItem label="Remove: not needed (ordered: choose its ending)" red onClick={() => { setMenu(null); setRemoving("ordered"); }} /> : null}
                  {row.removed ? <MenuItem label="Put back" onClick={() => { setMenu(null); run(() => putBackPart(jobId, removeTarget)); }} /> : null}
                  {!partId && !row.requestId ? <MenuItem label="Remove this row" red onClick={() => { setMenu(null); onRemovedLocal(); }} /> : null}
              </FloatingMenu>
            ) : null}
            {partId ? (
              <form action={attachDiagram.bind(null, partId)} className="hidden">
                <input ref={fileRef} type="file" name="diagram" accept="image/*,application/pdf" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
              </form>
            ) : null}
          </>
        ) : null}
      </div>
      {/* The status line: always there, always one line high, so the row never grows or shrinks */}
      <div className={`${STATUS_LINE} min-h-5 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 text-[11px] leading-tight`} data-status-line>
        {row.removed ? <Chip tone="outline">Removed</Chip> : null}
        {row.waitingApproval && !row.removed ? <Chip tone="amber">Waiting for owner approval</Chip> : null}
        {row.optionGroup ? <Chip tone="outline">Option</Chip> : null}
        {row.unavailable && !row.removed ? <Chip tone="amber">Not available</Chip> : null}
        {row.orderLabel ? <Chip tone="ink">{row.orderLabel}</Chip> : null}
        {memory && !v.list_price && !v.cost_aed && !readOnly ? <button type="button" onClick={useMemory} className="shrink-0 h-5 max-w-[55%] truncate rounded-control border border-green bg-green-soft px-2 text-[10px] font-bold text-green" title="The last price given for this part number" data-price-memory>Last: AED {memory.net !== null ? memory.net.toFixed(2) : "?"} net{memory.supplier ? ` · ${memory.supplier}` : ""}{memory.job ? ` · ${memory.job}` : ""} · Use</button> : null}
        <span className="min-w-0 flex-1 break-words text-muted">{notes}</span>
        {row.removed && canPrice ? <button type="button" onClick={() => run(() => putBackPart(jobId, removeTarget))} className="shrink-0 h-5 rounded-control border border-line-strong bg-white px-2 text-[10px] font-bold">{undo ? "Undo" : "Put back"}</button> : null}
        <span className={`max-w-full break-words ${tag.cls}`} data-row-tag>{tag.text}</span>
      </div>
      {split && partId ? <SplitDialog name={name} qty={qty} onClose={() => setSplit(false)} onSplit={(lines) => { setSplit(false); const fd = new FormData(); fd.set("lines", JSON.stringify(lines)); run(() => splitPart(jobId, partId, fd)); }} /> : null}
      {removing ? <RemoveDialog kind={removing} name={name} options={removeReasons} onClose={() => setRemoving(null)} onConfirm={(reason, disposition) => { const kind = removing; setRemoving(null); doRemove(kind, reason, disposition); }} /> : null}
    </div>
  );
}

/** "Remove: not needed": one-tap reasons (Settings) or typed; before the order the row is greyed with Put back, after it the part gets an ending. */
function RemoveDialog({ kind, name, options, onClose, onConfirm }: { kind: "part" | "request" | "ordered"; name: string; options: readonly string[]; onClose: () => void; onConfirm: (reason: string, disposition?: "returned" | "stock") => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-card bg-white p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()} data-remove-dialog>
        <span className="text-lg font-extrabold">Remove: not needed</span>
        <p className="text-xs text-muted">{kind === "ordered" ? `${name} is already ordered: choose where it goes, back to the supplier (credit note to follow) or into our stock. It leaves the quotation either way.` : `${name} comes off the list and the quotation, greyed with the reason; Put back is one tap. The advisor and the workshop manager are told. "Not available" is different: wanted, but the supplier cannot supply it.`}</p>
        <ReasonChips name="reason" label="Why?" options={options} onValue={setReason} placeholder="Tap a reason, or type" textCase="sentence" />
        <div className="flex flex-wrap gap-2">
          {kind === "ordered" ? (
            <>
              <Button type="button" size="md" tone="danger" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim(), "returned")} data-remove-return>Return to supplier</Button>
              <Button type="button" size="md" tone="secondary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim(), "stock")} data-remove-stock>Keep in stock</Button>
            </>
          ) : (
            <Button type="button" size="md" tone="danger" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>Remove</Button>
          )}
          <Button type="button" tone="ghost" size="md" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

/** A small label of fixed height on the status line. */
function Chip({ tone, children }: { tone: "outline" | "amber" | "ink"; children: React.ReactNode }) {
  const cls = tone === "amber" ? "bg-amber-soft text-amber" : tone === "ink" ? "bg-ink text-white" : "border border-ink text-ink";
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-bold whitespace-nowrap ${cls}`}>{children}</span>;
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
      <div className="w-full max-w-lg rounded-card bg-white p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()} data-split-dialog>
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
      <div className="w-full max-w-xl rounded-card bg-white p-5 flex flex-col gap-3 max-h-[90vh]" onClick={(e) => e.stopPropagation()} data-supplier-list>
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
