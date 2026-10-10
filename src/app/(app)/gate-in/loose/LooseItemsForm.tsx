"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Field, Input, Textarea } from "@/components/ui";

type Row = { key: number };

/**
 * The short gate-in for loose items: one line per item (what it is, a few words, how many, a photo),
 * who brought them, what the customer wants, and what we saw at the counter.
 */
export function LooseItemsForm({ action, itemTypes, customer }: { action: FormAction; itemTypes: readonly string[]; customer: { id: string; name: string; phone: string } | null }) {
  const [rows, setRows] = useState<Row[]>([{ key: 0 }]);
  const [next, setNext] = useState(1);
  return (
    <ActionForm action={action}>
      {(v) => (
        <>
          {customer ? (
            <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-chip px-4 py-3">
              <input type="hidden" name="customer_id" value={customer.id} />
              <span className="font-bold">{customer.name}</span>
              <span className="text-sm text-muted">{customer.phone}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-card border border-line p-3">
              <Field label="Customer's name">
                <Input name="new_name" defaultValue={v.new_name} required textCase="title" />
              </Field>
              <Field label="Phone">
                <Input name="new_phone" type="tel" inputMode="tel" defaultValue={v.new_phone} required />
              </Field>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {rows.map((r, i) => (
              <div key={r.key} className="flex flex-col gap-3 rounded-card border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Item {i + 1}</span>
                  {rows.length > 1 ? <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="min-h-9 rounded-control border border-line px-3 text-xs font-semibold">Remove</button> : null}
                </div>
                <ChoiceButtons name={`item_type_${i}`} columns={4} defaultValue={v[`item_type_${i}`] ?? ""} options={itemTypes.map((t) => ({ value: t, label: t }))} />
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px] gap-3">
                  <Field label="Or type what it is">
                    <Input name={`item_type_other_${i}`} defaultValue={v[`item_type_other_${i}`]} placeholder="Own word" textCase="title" />
                  </Field>
                  <Field label="A few words (size, brand, colour)">
                    <Input name={`item_description_${i}`} defaultValue={v[`item_description_${i}`]} placeholder="21 inch, black, kerb marks" textCase="sentence" />
                  </Field>
                  <Field label="How many">
                    <Input name={`item_quantity_${i}`} type="number" inputMode="numeric" min={1} step={1} defaultValue={v[`item_quantity_${i}`] ?? "1"} required />
                  </Field>
                </div>
                <Field label="Photo (optional)">
                  <input name={`item_photo_${i}`} type="file" accept="image/*" capture="environment" className="block w-full text-sm" />
                </Field>
              </div>
            ))}
            <button type="button" onClick={() => { setRows((rs) => [...rs, { key: next }]); setNext((n) => n + 1); }} className="min-h-11 self-start rounded-control border border-ink px-4 text-sm font-bold">+ Another item</button>
          </div>

          <Field label="Who brought the items? (name, if not the customer)">
            <Input name="brought_by" defaultValue={v.brought_by} textCase="title" />
          </Field>
          <Field label="What does the customer want? One line per request">
            <Textarea name="requests" rows={3} defaultValue={v.requests} required textCase="sentence" placeholder={"Repair the kerb damage and repaint\nBalance all four"} />
          </Field>
          <Field label="What we saw at the counter (optional)">
            <Textarea name="assessment_note" rows={2} defaultValue={v.assessment_note} textCase="sentence" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Which side does the work?">
              <ChoiceButtons name="department" columns={2} defaultValue={v.department ?? "mechanical"} options={[{ value: "mechanical", label: "Mechanical" }, { value: "bodyshop", label: "Bodyshop" }]} />
            </Field>
            <Field label="Priority">
              <ChoiceButtons name="priority" columns={3} defaultValue={v.priority ?? "normal"} options={[{ value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }]} />
            </Field>
          </div>
          <SubmitButton size="lg">Open the job card</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
