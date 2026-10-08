"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Button, ChoiceButtons, Field, Input, Textarea } from "@/components/ui";

/** Parts turn a request into exact parts: part number, description, quantity, as many rows as needed, with an optional diagram. */
export function AddPartsForm({ action, compact = false }: { action: FormAction; compact?: boolean }) {
  const [rows, setRows] = useState([0]);
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {() => (
        <>
          {rows.map((r, i) => (
            <div key={r} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-end">
              <label className="flex flex-col gap-1">
                {i === 0 ? <span className="text-xs font-semibold text-muted">Part number</span> : null}
                <Input name="part_number" placeholder="Optional" spellCheck={false} />
              </label>
              <label className="flex flex-col gap-1">
                {i === 0 ? <span className="text-xs font-semibold text-muted">Description</span> : null}
                <Input name="description" required={i === 0} placeholder="For example: Front brake pads, set" />
              </label>
              <label className="flex flex-col gap-1">
                {i === 0 ? <span className="text-xs font-semibold text-muted">Qty</span> : null}
                <Input name="quantity" defaultValue="1" inputMode="decimal" className="w-20" />
              </label>
              <button type="button" aria-label="Remove row" onClick={() => setRows((p) => (p.length > 1 ? p.filter((x) => x !== r) : p))} className="min-h-11 min-w-11 rounded-control border border-line text-sm font-bold">✕</button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" tone="secondary" size="md" onClick={() => setRows((p) => [...p, Date.now()])}>
              + Another part
            </Button>
            {!compact ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="font-semibold">Catalogue diagram</span>
                <input type="file" name="diagram" accept="image/*,application/pdf" className="text-xs" />
              </label>
            ) : null}
            <SubmitButton size="md">Add parts</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Parts price one part: supplier, cost before VAT, available now or to order, expected delivery. */
export function PricePartForm({ action, initial }: { action: FormAction; initial: { supplier: string; cost_aed: string; availability: string; delivery_date: string } }) {
  const [availability, setAvailability] = useState(initial.availability || "to_order");
  return (
    <ActionForm action={action} initialValues={initial} className="flex flex-col gap-3">
      {(v) => (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Supplier">
              <Input name="supplier" defaultValue={v.supplier} required />
            </Field>
            <Field label="Cost (AED, before VAT)">
              <Input name="cost_aed" defaultValue={v.cost_aed} inputMode="decimal" required />
            </Field>
            <div onChange={(e) => setAvailability((e.target as HTMLInputElement).value)}>
              <Field label="Availability">
                <ChoiceButtons name="availability" columns={2} defaultValue={v.availability || "to_order"} options={[{ value: "in_stock", label: "Available now" }, { value: "to_order", label: "To order" }]} />
              </Field>
            </div>
          </div>
          {availability === "to_order" ? (
            <Field label="Expected delivery date">
              <Input name="delivery_date" type="date" defaultValue={v.delivery_date} required className="max-w-48" />
            </Field>
          ) : null}
          <div>
            <SubmitButton size="md">Save price</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
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
