"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Button, Input, Textarea } from "@/components/ui";

const TYPES = [
  { value: "genuine", label: "Genuine" },
  { value: "oem", label: "OEM" },
  { value: "aftermarket", label: "Aftermarket" },
  { value: "used", label: "Used" },
];

export type RowValues = { part_number: string; description: string; quantity: string; part_type: string; brand: string; cost_aed: string; supplier: string; availability: string; days: string };
const EMPTY: RowValues = { part_number: "", description: "", quantity: "1", part_type: "", brand: "", cost_aed: "", supplier: "", availability: "in_stock", days: "" };

/** One part on one line: number, description, quantity, type (one tap), brand when not genuine, cost, supplier, in stock or days to arrive. */
function PartRow({ value, onChange, suppliers, showLabels, onRemove }: { value: RowValues; onChange: (v: RowValues) => void; suppliers: string[]; showLabels: boolean; onRemove?: () => void }) {
  const set = (k: keyof RowValues, v: string) => onChange({ ...value, [k]: v });
  const label = (t: string) => (showLabels ? <span className="text-xs font-semibold text-muted">{t}</span> : null);
  return (
    <div className="rounded-control border border-line p-2 flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end">
        <label className="flex flex-col gap-1">{label("Part number")}<Input name="part_number" value={value.part_number} onChange={(e) => set("part_number", e.target.value)} placeholder="Optional" textCase="upper" /></label>
        <label className="flex flex-col gap-1">{label("Description")}<Input name="description" value={value.description} onChange={(e) => set("description", e.target.value)} placeholder="For example: Front brake pads, set" textCase="sentence" /></label>
        <label className="flex flex-col gap-1">{label("Qty")}<Input name="quantity" value={value.quantity} onChange={(e) => set("quantity", e.target.value)} inputMode="decimal" className="w-20" /></label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="part_type" value={value.part_type} />
        <div className="flex flex-col gap-1">
          {label("Type (one tap)")}
          <div className="flex gap-1">
            {TYPES.map((t) => (
              <button key={t.value} type="button" onClick={() => set("part_type", t.value)} aria-pressed={value.part_type === t.value} className={`min-h-11 rounded-control border-2 px-3 text-xs font-extrabold ${value.part_type === t.value ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {value.part_type && value.part_type !== "genuine" ? <label className="flex flex-col gap-1">{label("Brand")}<Input name="brand" value={value.brand} onChange={(e) => set("brand", e.target.value)} placeholder="For example: Bosch" className="w-40" textCase="title" /></label> : <input type="hidden" name="brand" value="" />}
        <label className="flex flex-col gap-1">{label("Cost (AED, before VAT)")}<Input name="cost_aed" value={value.cost_aed} onChange={(e) => set("cost_aed", e.target.value)} inputMode="decimal" className="w-32" /></label>
        <label className="flex flex-col gap-1">{label("Supplier")}<Input name="supplier" value={value.supplier} onChange={(e) => set("supplier", e.target.value)} list="suppliers" className="w-44" textCase="title" /></label>
        <input type="hidden" name="availability" value={value.availability} />
        <div className="flex flex-col gap-1">
          {label("Availability")}
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => set("availability", "in_stock")} aria-pressed={value.availability === "in_stock"} className={`min-h-11 rounded-control border-2 px-3 text-xs font-extrabold ${value.availability === "in_stock" ? "border-green bg-green text-white" : "border-line-strong bg-white"}`}>In stock</button>
            <button type="button" onClick={() => set("availability", "to_order")} aria-pressed={value.availability === "to_order"} className={`min-h-11 rounded-control border-2 px-3 text-xs font-extrabold ${value.availability === "to_order" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Days to arrive</button>
            {value.availability === "to_order" ? <Input name="days" value={value.days} onChange={(e) => set("days", e.target.value)} inputMode="numeric" placeholder="days" className="w-20" /> : <input type="hidden" name="days" value="" />}
          </div>
        </div>
        {onRemove ? <button type="button" aria-label="Remove row" onClick={onRemove} className="min-h-11 min-w-11 rounded-control border border-line text-sm font-bold ml-auto">✕</button> : null}
      </div>
      <datalist id="suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

/** Parts answer a request: as many rows as needed, one Save. An optional catalogue diagram goes on the first part. */
export function PartRowsForm({ action, suppliers, defaultType, submitLabel = "Save parts" }: { action: FormAction; suppliers: string[]; defaultType: string; submitLabel?: string }) {
  const [rows, setRows] = useState<{ id: number; v: RowValues }[]>([{ id: 0, v: { ...EMPTY, part_type: defaultType } }]);
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      {() => (
        <>
          {rows.map((r, i) => (
            <PartRow key={r.id} value={r.v} showLabels={i === 0} suppliers={suppliers} onChange={(v) => setRows((p) => p.map((x) => (x.id === r.id ? { ...x, v } : x)))} onRemove={rows.length > 1 ? () => setRows((p) => p.filter((x) => x.id !== r.id)) : undefined} />
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" tone="secondary" size="md" onClick={() => setRows((p) => [...p, { id: Date.now(), v: { ...EMPTY, part_type: defaultType, supplier: p[p.length - 1]?.v.supplier ?? "" } }])}>+ Another part</Button>
            <label className="flex items-center gap-2 text-sm"><span className="font-semibold">Catalogue diagram</span><input type="file" name="diagram" accept="image/*,application/pdf" className="text-xs" /></label>
            <SubmitButton size="md">{submitLabel}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Change one part, or add an option beside it (the same fields). */
export function OnePartForm({ action, initial, suppliers, submitLabel }: { action: FormAction; initial: RowValues; suppliers: string[]; submitLabel: string }) {
  const [v, setV] = useState<RowValues>(initial);
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      {() => (
        <>
          <PartRow value={v} onChange={setV} suppliers={suppliers} showLabels />
          <div><SubmitButton size="md">{submitLabel}</SubmitButton></div>
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
