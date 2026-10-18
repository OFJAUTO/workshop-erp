"use client";

import { useState } from "react";
import { Button, Input, Textarea } from "@/components/ui";

export type DeskPart = { id: string; description: string; part_number: string | null; quantity: number; here: boolean; why: string | null; readyAt: string | null; notReceived?: boolean };

/**
 * Parts tick what is at the desk and press "Ready for handover": the car's technicians and the workshop
 * manager are told at once. The technician receives on his own tablet with his PIN; nothing happens here.
 */
export function ReadyForm({ parts, action }: { parts: DeskPart[]; action: (formData: FormData) => void }) {
  const markable = parts.filter((p) => p.here && !p.readyAt);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const ticked = markable.filter((p) => !unticked.has(p.id));
  if (!markable.length) return null;
  const toggle = (id: string) => setUnticked((u) => { const n = new Set(u); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <form action={action} className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {markable.map((p) => {
          const on = !unticked.has(p.id);
          return (
            <li key={p.id}>
              <button type="button" onClick={() => toggle(p.id)} aria-pressed={on} className={`flex w-full min-h-12 items-center gap-3 rounded-control px-2 text-left ${on ? "bg-chip" : ""}`}>
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control border text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong text-transparent"}`}>✓</span>
                <span className="flex-1 font-semibold">{p.description}{p.part_number ? <span className="text-muted font-normal"> · {p.part_number}</span> : null}</span>
                <span>× {p.quantity}</span>
                {p.notReceived ? <span className="text-xs font-semibold text-amber">Was not received last time</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {ticked.map((p) => <input key={p.id} type="hidden" name="part" value={p.id} />)}
      <Button type="submit" size="lg" disabled={!ticked.length} data-mark-ready>Ready for handover ({ticked.length})</Button>
      <p className="text-xs text-muted">The technician and the workshop manager are told at once; he ticks the parts on his own tablet and confirms with his PIN when he picks them up.</p>
    </form>
  );
}

/** A part comes back from the workshop to the Parts desk. */
export function ReturnForm({ parts, needsPin, action }: { parts: { id: string; description: string; quantity: number }[]; needsPin: boolean; action: (formData: FormData) => void }) {
  const [open, setOpen] = useState(false);
  if (!parts.length) return null;
  if (!open) return <Button type="button" tone="secondary" size="md" onClick={() => setOpen(true)}>Parts coming back to the desk</Button>;
  return (
    <form action={action} className="flex flex-col gap-3 rounded-card border border-line p-4">
      <ul className="divide-y divide-line">
        {parts.map((p) => (
          <li key={p.id} className="py-2"><label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" name="part" value={p.id} className="h-6 w-6 accent-ink" /><span className="font-semibold">{p.description}</span><span className="text-xs text-muted">× {p.quantity}</span></label></li>
        ))}
      </ul>
      <Textarea name="note" rows={1} required placeholder="Why the parts come back (wrong part, not needed, damaged)" textCase="sentence" />
      {needsPin ? <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Your PIN</span><Input name="pin" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required className="w-32" /></label> : null}
      <div className="flex gap-2"><Button type="submit" size="md">Take the parts back</Button><Button type="button" tone="ghost" size="md" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}
