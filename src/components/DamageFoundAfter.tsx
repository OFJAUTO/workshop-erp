"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CarOutline } from "@/components/CarOutline";
import { MediaCapture } from "@/components/MediaCapture";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button, Input } from "@/components/ui";
import { addDamageAfter, damageFoundMessage, markDamageAfterSent } from "@/app/(app)/jobs/damage-actions";
import { DAMAGE_TYPES, SEVERITIES, panelLabel } from "@/lib/car-outline";
import { afterCaption } from "@/lib/damage";
import { reloadIfStale } from "@/lib/app-version";
import { formatDayTime } from "@/lib/format";

const chip = (on: boolean) => `min-h-10 rounded-control border px-3 text-sm font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`;

/**
 * Damage found AFTER check-in (section 4.6, 30 October 2026): pick the panel on THE outline, tap what is there, a note
 * the customer will read, Save, then the photos. Each entry the customer has not been told about yet offers "Tell the
 * customer" (WhatsApp with the job card link) to the advisors, accounts and the owner.
 */
export function DamageFoundAfter({ jobId, entries, canAdd, canTell }: { jobId: string; entries: { id: string; label: string; at: string; sentAt: string | null }[]; canAdd: boolean; canTell: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [damage, setDamage] = useState<string[]>([]);
  const [severity, setSeverity] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [send, setSend] = useState<{ id: string; message: string | null; phone: string } | null>(null);

  const reset = () => { setOpen(false); setPanel(null); setDamage([]); setSeverity(null); setNote(""); setSavedId(null); setError(null); router.refresh(); };
  async function save() {
    setSaving(true);
    setError(null);
    const r = await addDamageAfter(jobId, JSON.stringify({ panel, damage, severity, note })).catch((e) => ({ error: reloadIfStale(e) ? "A new version is loading…" : "No connection. Try again.", id: undefined }));
    setSaving(false);
    if (r.error || !r.id) { setError(r.error ?? "Not saved."); return; }
    setSavedId(r.id);
  }
  async function tell(id: string) {
    setSend({ id, message: null, phone: "" });
    const r = await damageFoundMessage(jobId, id).catch(() => ({ error: "No connection. Try again.", message: undefined, phone: undefined }));
    if (r.error || !r.message) { setSend(null); setError(r.error ?? "Could not prepare the message."); return; }
    setSend({ id, message: r.message, phone: r.phone ?? "" });
  }

  return (
    <div className="flex flex-col gap-2" data-damage-after-panel>
      {entries.length && canTell ? (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-damage-after-row={e.id}>
              <span className="font-semibold">{e.label} · found {formatDayTime(e.at)}</span>
              {e.sentAt ? <span className="text-xs font-semibold text-muted" data-damage-after-sent>Customer told {formatDayTime(e.sentAt)}</span> : <Button type="button" tone="secondary" onClick={() => tell(e.id)} data-damage-after-send={e.id}>Tell the customer</Button>}
            </li>
          ))}
        </ul>
      ) : null}
      {canAdd && !open ? (
        <Button type="button" tone="ghost" className="self-start" onClick={() => setOpen(true)} data-damage-after-add>+ Damage found after check-in</Button>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-3 rounded-card border border-line-strong p-3" data-damage-after-form>
          {!savedId ? (
            <>
              <span className="text-sm font-bold">Where is it? Tap the panel.</span>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
                <CarOutline tones={panel ? { [panel]: severity === "moderate" || severity === "severe" ? "red" : "amber" } : {}} selected={panel} onPick={setPanel} size={150} />
                <div className="flex min-w-0 flex-col gap-2">
                  <span className="text-base font-extrabold" data-damage-after-panel-name>{panel ? panelLabel(panel) : "No panel picked yet"}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {DAMAGE_TYPES.map((d) => <button key={d.value} type="button" aria-pressed={damage.includes(d.value)} onClick={() => setDamage((cur) => (cur.includes(d.value) ? cur.filter((x) => x !== d.value) : [...cur, d.value]))} className={chip(damage.includes(d.value))} data-damage-after-type={d.value}>{d.label}</button>)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SEVERITIES.map((d) => <button key={d.value} type="button" aria-pressed={severity === d.value} onClick={() => setSeverity(severity === d.value ? null : d.value)} className={chip(severity === d.value)} data-damage-after-severity={d.value}>{d.label}</button>)}
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-bold">Note (shown to the customer)</span>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" textCase="sentence" data-damage-after-note />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={save} disabled={saving || !panel} data-damage-after-save>{saving ? "Saving…" : "Save"}</Button>
                    <Button type="button" tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2" data-damage-after-photos={savedId}>
              <span className="text-sm font-bold">Saved: {panel ? panelLabel(panel) : ""}. Now the photos.</span>
              <MediaCapture jobId={jobId} kind="damage_photo" caption={afterCaption(savedId)} label="Photo of the damage" hint="Tap to add a photo" multiple itemKey={null} />
              <Button type="button" className="self-start" onClick={reset} data-damage-after-done>Done</Button>
            </div>
          )}
          {error ? <span className="text-xs font-semibold text-red" data-damage-after-error>{error}</span> : null}
        </div>
      ) : null}
      {!open && error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
      {send ? (
        <SendLinkDialog
          title="Damage found after check-in"
          message={send.message}
          phoneDigits={send.phone}
          onSent={() => { void markDamageAfterSent(jobId, send.id).then(() => router.refresh()); }}
          onClose={() => setSend(null)}
        />
      ) : null}
    </div>
  );
}
