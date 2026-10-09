"use client";

import { useState } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui";

export type HandoverPart = { id: string; description: string; part_number: string | null; quantity: number; label_code: string | null; ready: boolean; why: string | null };

/**
 * The handover: every part that is here is ticked; untick what stays behind. Below the list one
 * sentence, "I confirm I received these 9 parts for Dubai M 10000", and one PIN box for the technician.
 * A manager or the owner can sign for the technician instead.
 */
export function HandoverForm({ parts, technicians, defaultTechnician, plate, canSignFor, action }: { parts: HandoverPart[]; technicians: { id: string; display_name: string }[]; defaultTechnician: string | null; plate: string; canSignFor: boolean; action: (formData: FormData) => void }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>(Object.fromEntries(parts.map((p) => [p.id, p.ready])));
  const [tech, setTech] = useState(defaultTechnician ?? technicians[0]?.id ?? "");
  const [signFor, setSignFor] = useState(false);
  const count = parts.filter((p) => p.ready && ticked[p.id]).length;
  const who = technicians.find((t) => t.id === tech)?.display_name ?? "the technician";
  return (
    <form action={action} className="flex flex-col gap-4">
      <ul className="divide-y divide-line">
        {parts.map((p) => (
          <li key={p.id} className="py-2.5 flex flex-wrap items-center gap-3">
            <label className={`flex items-center gap-3 flex-1 min-w-64 ${p.ready ? "cursor-pointer" : "opacity-60"}`}>
              <input type="checkbox" name="part" value={p.id} checked={!!ticked[p.id] && p.ready} disabled={!p.ready} onChange={(e) => setTicked({ ...ticked, [p.id]: e.target.checked })} className="h-6 w-6 accent-ink" />
              <span>
                <span className="font-semibold">{p.description}</span>
                <span className="block text-xs text-muted">{p.part_number ?? "no part number"} · × {p.quantity}{p.label_code ? ` · ${p.label_code}` : ""}</span>
              </span>
            </label>
            {!p.ready ? <span className="text-xs font-semibold text-muted">{p.why}</span> : null}
          </li>
        ))}
      </ul>
      <div className="rounded-card border border-ink p-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician taking the parts</span>
          <Select name="technician" value={tech} onChange={(e) => setTech(e.target.value)} required className="w-full sm:w-72">
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
          </Select>
        </label>
        <p className="text-base font-bold">I confirm I received these {count} part{count === 1 ? "" : "s"} for {plate}.</p>
        {!signFor ? (
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">{who}&apos;s PIN</span><Input name="pin" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required className="w-32 text-center text-2xl tracking-[0.4em]" autoComplete="off" /></label>
        ) : (
          <input type="hidden" name="sign_for" value="on" />
        )}
        {canSignFor ? (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={signFor} onChange={(e) => setSignFor(e.target.checked)} className="h-5 w-5 accent-ink" />I sign for {who} (manager or owner, logged)</label>
        ) : null}
        <Textarea name="note" rows={1} placeholder="Note (optional)" />
        <div><Button type="submit" size="lg" disabled={count === 0}>Hand over {count} part{count === 1 ? "" : "s"}</Button></div>
      </div>
    </form>
  );
}

/** Parts that come back from the technician: tick them, say why, the Parts person's PIN. */
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
      <Textarea name="note" rows={1} required placeholder="Why the parts come back (wrong part, not needed, damaged)" />
      {needsPin ? <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Your PIN</span><Input name="pin" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required className="w-32 text-center text-2xl tracking-[0.4em]" autoComplete="off" /></label> : null}
      <div className="flex gap-2"><Button type="submit" size="md">Take the parts back</Button><Button type="button" tone="ghost" size="md" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}
