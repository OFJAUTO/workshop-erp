"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Button, Input, Textarea } from "@/components/ui";

const TYPES = [
  { value: "genuine", label: "Genuine" },
  { value: "oem", label: "OEM" },
  { value: "aftermarket", label: "Afterm." },
  { value: "used", label: "Used" },
];

export type RowValues = { part_number: string; description: string; quantity: string; part_type: string; brand: string; cost_aed: string; supplier: string; availability: string; days: string };
const EMPTY: RowValues = { part_number: "", description: "", quantity: "1", part_type: "", brand: "", cost_aed: "", supplier: "", availability: "in_stock", days: "" };

/** The one grid every row of the Parts table uses: part, qty, part number, type, cost, supplier, availability, actions. */
export const PARTS_GRID = "grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_3.5rem_7rem_8.5rem_6rem_8rem_9rem_minmax(5rem,auto)] gap-x-2 gap-y-1 items-center";

/** One part as one table row: the same fields the server reads, each in its column. */
function PartRow({ value, onChange, suppliers, info, onRemove }: { value: RowValues; onChange: (v: RowValues) => void; suppliers: string[]; info?: string | null; onRemove?: () => void }) {
  const set = (k: keyof RowValues, v: string) => onChange({ ...value, [k]: v });
  const chip = (on: boolean, tone: "ink" | "green" = "ink") => `min-h-9 rounded-control border px-1.5 text-[11px] font-extrabold ${on ? (tone === "green" ? "border-green bg-green text-white" : "border-ink bg-ink text-white") : "border-line-strong bg-white"}`;
  return (
    <div className={`${PARTS_GRID} py-1.5`}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <Input name="description" value={value.description} onChange={(e) => set("description", e.target.value)} placeholder="Part" textCase="sentence" className="min-h-10 font-semibold" aria-label="Part" />
        {info ? <span className="text-[11px] text-muted">{info}</span> : null}
      </div>
      <Input name="quantity" value={value.quantity} onChange={(e) => set("quantity", e.target.value)} inputMode="numeric" className="min-h-10 text-center" aria-label="Quantity" />
      <Input name="part_number" value={value.part_number} onChange={(e) => set("part_number", e.target.value)} placeholder="Number" textCase="upper" className="min-h-10" aria-label="Part number" />
      <div className="flex flex-col gap-1">
        <input type="hidden" name="part_type" value={value.part_type} />
        <div className="grid grid-cols-2 gap-1">
          {TYPES.map((t) => (
            <button key={t.value} type="button" onClick={() => set("part_type", t.value)} aria-pressed={value.part_type === t.value} className={chip(value.part_type === t.value)} title={t.value === "aftermarket" ? "Aftermarket" : t.label}>
              {t.label}
            </button>
          ))}
        </div>
        {value.part_type && value.part_type !== "genuine" ? <Input name="brand" value={value.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Brand" className="min-h-9 text-xs" textCase="title" aria-label="Brand" /> : <input type="hidden" name="brand" value="" />}
      </div>
      <Input name="cost_aed" value={value.cost_aed} onChange={(e) => set("cost_aed", e.target.value)} inputMode="decimal" placeholder="AED" className="min-h-10 text-right" aria-label="Cost before VAT" />
      <Input name="supplier" value={value.supplier} onChange={(e) => set("supplier", e.target.value)} list="suppliers" placeholder="Supplier" className="min-h-10" textCase="title" aria-label="Supplier" />
      <div className="flex items-center gap-1">
        <input type="hidden" name="availability" value={value.availability} />
        <button type="button" onClick={() => set("availability", "in_stock")} aria-pressed={value.availability === "in_stock"} className={chip(value.availability === "in_stock", "green")}>Stock</button>
        <button type="button" onClick={() => set("availability", "to_order")} aria-pressed={value.availability === "to_order"} className={chip(value.availability === "to_order")}>Order</button>
        {value.availability === "to_order" ? <Input name="days" value={value.days} onChange={(e) => set("days", e.target.value)} inputMode="numeric" placeholder="days" className="min-h-9 w-14 text-xs text-center" aria-label="Days until it arrives" /> : <input type="hidden" name="days" value="" />}
      </div>
      <div className="flex items-center justify-end gap-1">
        {onRemove ? <button type="button" aria-label="Remove row" onClick={onRemove} className="min-h-9 min-w-9 rounded-control border border-line text-sm font-bold">✕</button> : null}
      </div>
      <datalist id="suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

/** Parts answer a request in the table itself: the row is the answer, one Save. More rows for more parts; an optional catalogue diagram goes on the first. */
export function PartRowsForm({ action, suppliers, defaultType, initial, info, submitLabel = "Save" }: { action: FormAction; suppliers: string[]; defaultType: string; initial?: Partial<RowValues>; info?: string | null; submitLabel?: string }) {
  const [rows, setRows] = useState<{ id: number; v: RowValues }[]>([{ id: 0, v: { ...EMPTY, part_type: defaultType, ...(initial ?? {}) } }]);
  return (
    <ActionForm action={action} className="flex flex-col gap-1">
      {() => (
        <>
          {rows.map((r, i) => (
            <PartRow key={r.id} value={r.v} info={i === 0 ? info : null} suppliers={suppliers} onChange={(v) => setRows((p) => p.map((x) => (x.id === r.id ? { ...x, v } : x)))} onRemove={rows.length > 1 ? () => setRows((p) => p.filter((x) => x.id !== r.id)) : undefined} />
          ))}
          <div className="flex flex-wrap items-center gap-3 pb-1">
            <SubmitButton size="md">{submitLabel}</SubmitButton>
            <Button type="button" tone="secondary" size="md" onClick={() => setRows((p) => [...p, { id: Date.now(), v: { ...EMPTY, part_type: defaultType, supplier: p[p.length - 1]?.v.supplier ?? "" } }])}>+ Another part for this</Button>
            <label className="flex items-center gap-2 text-xs"><span className="font-semibold text-muted">Diagram</span><input type="file" name="diagram" accept="image/*,application/pdf" className="text-xs" /></label>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Change one part, or add an option beside it (the same row). */
export function OnePartForm({ action, initial, suppliers, submitLabel }: { action: FormAction; initial: RowValues; suppliers: string[]; submitLabel: string }) {
  const [v, setV] = useState<RowValues>(initial);
  return (
    <ActionForm action={action} className="flex flex-col gap-1">
      {() => (
        <>
          <PartRow value={v} onChange={setV} suppliers={suppliers} />
          <div className="pb-1"><SubmitButton size="md">{submitLabel}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

/** "Ask workshop manager": a short question; he answers with one tap. */
export function AskManagerForm({ action }: { action: (formData: FormData) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold underline underline-offset-4">Ask workshop manager</button>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Input name="question" placeholder="Is this the right part? (optional note)" className="flex-1 min-w-48" />
      <Button type="submit" size="md">Send</Button>
      <Button type="button" tone="ghost" size="md" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

/** "Not available": one tap, an optional note, the advisor is told. */
export function UnavailableForm({ action }: { action: (formData: FormData) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" tone="secondary" size="md" onClick={() => setOpen(true)}>Not available</Button>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Input name="note" placeholder="Note for the advisor (optional)" className="w-64" textCase="sentence" />
      <Button type="submit" size="md">Confirm: not available</Button>
      <Button type="button" tone="ghost" size="md" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}

/** Parts close a request they cannot source. */
export function CloseRequestForm({ action }: { action: (formData: FormData) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-muted underline underline-offset-4">
        Cannot source: close this request
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <Textarea name="note" rows={2} required placeholder="Why (shown to the advisor)" />
      <div className="flex gap-2">
        <Button type="submit" tone="secondary" size="md">Close request</Button>
        <Button type="button" tone="ghost" size="md" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
