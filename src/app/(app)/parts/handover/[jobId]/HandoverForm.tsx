"use client";

import { useState } from "react";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui";

export type HandoverPart = { id: string; description: string; part_number: string | null; quantity: number; ready: boolean; why: string | null; battery: boolean; defaultStickers: number; brand: string | null; model: string | null; serial: string | null };
export type HandoverTech = { id: string; display_name: string; personalDevice: boolean };

/**
 * The handover: tick what is going now, a sticker counter per part (locked to the quantity for a
 * battery), the technician, one tap. The technician confirms on his own device or signs at the counter.
 */
export function HandoverForm({ parts, technicians, defaultTechnician, plate, canSignFor, batteryRequired, action }: { parts: HandoverPart[]; technicians: HandoverTech[]; defaultTechnician: string | null; plate: string; canSignFor: boolean; batteryRequired: boolean; action: (formData: FormData) => void }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>(Object.fromEntries(parts.map((p) => [p.id, p.ready])));
  const [stickers, setStickers] = useState<Record<string, number>>(Object.fromEntries(parts.map((p) => [p.id, p.battery && batteryRequired ? p.quantity : Math.min(p.quantity, p.defaultStickers)])));
  const [tech, setTech] = useState(defaultTechnician ?? technicians[0]?.id ?? "");
  const [signFor, setSignFor] = useState(false);
  const chosen = parts.filter((p) => p.ready && ticked[p.id]);
  const count = chosen.length;
  const stickerCount = chosen.reduce((a, p) => a + (stickers[p.id] ?? 0), 0);
  const who = technicians.find((t) => t.id === tech);
  const bump = (p: HandoverPart, d: number) => setStickers((s) => ({ ...s, [p.id]: Math.max(0, Math.min(p.quantity, (s[p.id] ?? 0) + d)) }));
  return (
    <form action={action} className="flex flex-col gap-4">
      <ul className="divide-y divide-line">
        {parts.map((p) => {
          const locked = p.battery && batteryRequired;
          return (
            <li key={p.id} className="py-2.5 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <label className={`flex items-center gap-3 flex-1 min-w-64 ${p.ready ? "cursor-pointer" : "opacity-60"}`}>
                  <input type="checkbox" name="part" value={p.id} checked={!!ticked[p.id] && p.ready} disabled={!p.ready} onChange={(e) => setTicked({ ...ticked, [p.id]: e.target.checked })} className="h-6 w-6 accent-ink" />
                  <span>
                    <span className="font-semibold">{p.description}</span>
                    <span className="block text-xs text-muted">{p.part_number ?? "no part number"} · × {p.quantity}{p.battery ? " · battery" : ""}</span>
                  </span>
                </label>
                {!p.ready ? <span className="text-xs font-semibold text-muted">{p.why}</span> : null}
                {p.ready ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <span className="font-semibold text-muted">{p.battery ? "Warranty stickers" : "Stickers"}</span>
                    <input type="hidden" name={`stickers__${p.id}`} value={ticked[p.id] ? (stickers[p.id] ?? 0) : 0} />
                    <button type="button" disabled={locked || !ticked[p.id]} onClick={() => bump(p, -1)} className="h-9 w-9 rounded-control border border-line-strong font-bold disabled:opacity-40" aria-label="One sticker less">−</button>
                    <span className="w-6 text-center text-sm font-extrabold">{ticked[p.id] ? (stickers[p.id] ?? 0) : 0}</span>
                    <button type="button" disabled={locked || !ticked[p.id]} onClick={() => bump(p, 1)} className="h-9 w-9 rounded-control border border-line-strong font-bold disabled:opacity-40" aria-label="One sticker more">+</button>
                  </span>
                ) : null}
              </div>
              {p.battery && p.ready && ticked[p.id] ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-control bg-chip p-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Brand<Input name={`battery_brand__${p.id}`} defaultValue={p.brand ?? ""} textCase="title" /></label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Model<Input name={`battery_model__${p.id}`} defaultValue={p.model ?? ""} /></label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Serial number (optional)<Input name={`battery_serial__${p.id}`} defaultValue={p.serial ?? ""} textCase="upper" /></label>
                  <span className="sm:col-span-3 text-[11px] text-muted">The warranty sticker is compulsory for a battery: one per battery, printed before the technician can confirm.</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="rounded-card border border-ink p-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Technician taking the parts</span>
          <Select name="technician" value={tech} onChange={(e) => setTech(e.target.value)} required className="w-full sm:w-72">
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.display_name}{t.personalDevice ? " · own device" : " · signs at the counter"}</option>)}
          </Select>
        </label>
        <p className="text-sm">
          {who?.personalDevice ? <><Badge tone="green">Own device</Badge> <span className="font-semibold">{who.display_name}</span> gets &quot;{count} part{count === 1 ? "" : "s"} for {plate}&quot; on his device and enters his PIN there.</> : <><Badge tone="amber">Counter</Badge> <span className="font-semibold">{who?.display_name ?? "The technician"}</span> has no personal device: after Hand over, he taps &quot;Sign here&quot; on this screen and types his PIN.</>}
        </p>
        {canSignFor ? (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sign_for" checked={signFor} onChange={(e) => setSignFor(e.target.checked)} className="h-5 w-5 accent-ink" />I sign for {who?.display_name ?? "the technician"} (manager or owner, logged)</label>
        ) : null}
        <Textarea name="note" rows={1} placeholder="Note (optional)" textCase="sentence" />
        <div><Button type="submit" size="lg" disabled={count === 0}>{stickerCount ? `Hand over and print ${stickerCount} sticker${stickerCount === 1 ? "" : "s"}` : `Hand over ${count} part${count === 1 ? "" : "s"}`}</Button></div>
      </div>
    </form>
  );
}

/** "Sign here": a small four-digit box for the technician at the counter; it opens nothing else. */
export function SignHere({ jobId, takerName, canSignFor, action }: { jobId: string; takerName: string; canSignFor: boolean; action: (formData: FormData) => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  if (!open) return <Button type="button" size="md" onClick={() => setOpen(true)}>Sign here</Button>;
  return (
    <form action={action} className="rounded-card border-2 border-ink p-4 flex flex-col gap-3 bg-white max-w-sm">
      <input type="hidden" name="job_id" value={jobId} />
      <p className="text-base font-bold">{takerName}, type your PIN to confirm you received these parts.</p>
      <Input name="pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" autoFocus className="text-center text-2xl tracking-[0.5em] w-40" aria-label="PIN" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pin.length !== 4}>Confirm</Button>
        <Button type="button" tone="ghost" size="lg" onClick={() => { setOpen(false); setPin(""); }}>Cancel</Button>
      </div>
      {canSignFor ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="sign_for" className="h-5 w-5 accent-ink" />I sign for {takerName} instead (manager or owner, logged)</label> : null}
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
      <Textarea name="note" rows={1} required placeholder="Why the parts come back (wrong part, not needed, damaged)" textCase="sentence" />
      {needsPin ? <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Your PIN</span><Input name="pin" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required className="w-32" /></label> : null}
      <div className="flex gap-2"><Button type="submit" size="md">Take the parts back</Button><Button type="button" tone="ghost" size="md" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}
