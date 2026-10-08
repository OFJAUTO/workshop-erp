"use client";

import { useState } from "react";
import { Badge, Button, Card, Input, SectionLabel, Textarea } from "@/components/ui";

export type ConfirmItem = { id: string; part_number: string | null; description: string; quantity: number; diagram_url: string | null; request_label: string | null; requested_text: string | null; confirm_status: "pending" | "confirmed" | "rejected"; confirmed_quantity: number | null; reject_note: string | null };

/**
 * The technician (or the workshop manager for an absent technician) confirms the parts and quantities
 * listed by Parts, or rejects a part with a note. No prices are shown here.
 */
export function PartsConfirm({ items, action, title = "Parts to confirm", who = "you" }: { items: ConfirmItem[]; action: (partId: string, formData: FormData) => void; title?: string; who?: string }) {
  const pending = items.filter((i) => i.confirm_status === "pending");
  const done = items.filter((i) => i.confirm_status !== "pending");
  return (
    <Card className={`flex flex-col gap-3 ${pending.length ? "border-ink" : ""}`}>
      <SectionLabel right={pending.length ? `${pending.length} waiting for ${who}` : `${items.length} parts`}>{title}</SectionLabel>
      {items.length === 0 ? <p className="text-sm text-muted">No parts listed yet.</p> : null}
      {pending.map((p) => (
        <PendingRow key={p.id} item={p} action={action} />
      ))}
      {done.length ? (
        <ul className="divide-y divide-line text-sm">
          {done.map((p) => (
            <li key={p.id} className="py-2 flex flex-wrap items-center gap-2">
              <Badge tone={p.confirm_status === "confirmed" ? "green" : "red"}>{p.confirm_status === "confirmed" ? `Confirmed × ${p.confirmed_quantity ?? p.quantity}` : "Rejected"}</Badge>
              <span className="font-semibold">{p.description}</span>
              {p.part_number ? <span className="text-muted">{p.part_number}</span> : null}
              {p.reject_note ? <span className="text-muted">· {p.reject_note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function PendingRow({ item, action }: { item: ConfirmItem; action: (partId: string, formData: FormData) => void }) {
  const [rejecting, setRejecting] = useState(false);
  return (
    <div className="rounded-card border border-line p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{item.description}</span>
        {item.part_number ? <span className="text-sm text-muted">{item.part_number}</span> : null}
        <span className="text-sm text-muted">· quantity {item.quantity}</span>
        {item.diagram_url ? (
          <a href={item.diagram_url} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">
            Diagram
          </a>
        ) : null}
      </div>
      {item.request_label ? <p className="text-xs text-muted">For: {item.request_label}{item.requested_text ? ` · you wrote: ${item.requested_text}` : ""}</p> : null}
      <form action={action.bind(null, item.id)} className="flex flex-wrap items-end gap-2">
        {!rejecting ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Quantity needed</span>
              <Input name="quantity" defaultValue={String(item.quantity)} inputMode="decimal" className="w-24" />
            </label>
            <Button type="submit" name="decision" value="confirm" size="md">Confirm</Button>
            <Button type="button" tone="secondary" size="md" onClick={() => setRejecting(true)}>Reject</Button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 flex-1 min-w-56">
              <span className="text-xs font-semibold text-muted">Why (required)</span>
              <Textarea name="note" rows={1} required placeholder="For example: wrong part, not needed" />
            </label>
            <Button type="submit" name="decision" value="reject" tone="danger" size="md">Reject part</Button>
            <Button type="button" tone="ghost" size="md" onClick={() => setRejecting(false)}>Back</Button>
          </>
        )}
      </form>
    </div>
  );
}
