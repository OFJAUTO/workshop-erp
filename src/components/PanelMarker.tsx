"use client";

import { useEffect, useRef, useState } from "react";
import { CarOutline } from "@/components/CarOutline";
import { Card, Input, SectionLabel } from "@/components/ui";
import { DAMAGE_TYPES, SEVERITIES, damageWords, panelLabel, toneOf, type PanelMarks } from "@/lib/car-outline";
import { clearPending, readPending, writePending } from "@/lib/pending-draft";
import { reloadIfStale } from "@/lib/app-version";
import { MediaCapture, useDeviceFiles } from "@/components/MediaCapture";
import { ViewerThumb } from "@/components/PhotoViewer";
import { captionPanel, panelCaption, type DamagePhoto } from "@/lib/damage";

/**
 * Damage marked on the car outline - the same outline as the inspection's bodyshop findings - for the gate-in
 * (what the car came in with) and the bodyshop pre-work check before PPF. Tap a panel, tap what is there, a short
 * note; every tap is saved. Read-only when canEdit is off.
 * 30 October 2026 (night batch section 4.4): the note is labelled "shown to the customer" (it prints on the customer's
 * job card), and with `photos` each panel takes its own photos (gate_in_media damage_photo, caption "panel:<key>").
 * 31 October 2026: those photos go through THE send queue - kept on the device until the server has them, so tapping
 * another panel never drops one; the list says which panels still have photos on this device.
 */
export function PanelMarker({ title, hint, initial, save, canEdit, hook, footer = null, photos = null, noteForCustomer = true }: { title: string; hint: string; initial: PanelMarks; save: (json: string) => Promise<{ error?: string }>; canEdit: boolean; hook: string; footer?: React.ReactNode; photos?: { jobId: string; token?: string; byPanel: Record<string, DamagePhoto[]> } | null; noteForCustomer?: boolean }) {
  const [marks, setMarks] = useState<PanelMarks>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  // Panel photos still on this device (any panel, also one not marked yet), so switching panels never hides one.
  const device = useDeviceFiles(photos?.jobId ?? null);
  const onDevice: Record<string, number> = {};
  for (const f of device) {
    const p = f.kind === "damage_photo" ? captionPanel(f.caption) : null;
    if (p) onDevice[p] = (onDevice[p] ?? 0) + 1;
  }
  const deviceWords = (n: number) => `${n} photo${n === 1 ? "" : "s"} still on this device`;
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pendingKey = () => `marks:${hook}:${typeof window === "undefined" ? "" : window.location.pathname}`;
  const push = (next: PanelMarks, slow = false) => {
    setMarks(next);
    writePending(pendingKey(), next);
    const run = () => {
      setState("saving");
      chain.current = chain.current.then(async () => {
        const r = await save(JSON.stringify(next)).catch((e) => ({ error: reloadIfStale(e) ? "A new version is loading…" : "No connection. Try again." }));
        if (r.error) { setState("error"); setError(r.error); } else { clearPending(pendingKey()); setState("saved"); setError(null); }
      });
    };
    if (timer.current) clearTimeout(timer.current);
    if (slow) timer.current = setTimeout(run, 700);
    else run();
  };
  // Marks tapped but never saved (a reload, a sleeping phone) come back and are saved.
  useEffect(() => {
    if (!canEdit) return;
    const d = readPending<PanelMarks>(pendingKey());
    if (!d || JSON.stringify(d) === JSON.stringify(initial)) return;
    const t = setTimeout(() => push(d), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mark = selected ? marks[selected] ?? { damage: [], note: null, severity: null } : null;
  const setMark = (panel: string, patch: Partial<PanelMarks[string]>, slow = false) => {
    const cur = marks[panel] ?? { damage: [], note: null, severity: null };
    const next = { ...cur, ...patch };
    const copy = { ...marks };
    if (!next.damage.length && !next.note) delete copy[panel];
    else copy[panel] = next;
    push(copy, slow);
  };
  const chip = (on: boolean) => `min-h-10 rounded-control border px-3 text-sm font-bold disabled:opacity-60 ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`;
  const marked = Object.entries(marks);
  // Panels with photos on this device but nothing ticked yet, listed too (a photo is never out of sight).
  const unmarkedOnDevice = Object.keys(onDevice).filter((k) => !marks[k]);
  return (
    <Card className="flex flex-col gap-3" data-panel-marker={hook}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel right={`${marked.length} panel${marked.length === 1 ? "" : "s"}`}>{title}</SectionLabel>
        <span className={`text-xs font-semibold ${state === "error" ? "text-red" : "text-muted"}`} data-marker-state={state}>{state === "saving" ? "Saving…" : state === "error" ? "Not saved" : marked.length ? "Saved" : ""}</span>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
        <CarOutline tones={Object.fromEntries(marked.map(([k, m]) => [k, toneOf(m)]))} selected={selected} onPick={setSelected} size={160} />
        <div className="flex min-w-0 flex-col gap-2">
          {!selected || !mark ? (
            <p className="text-sm text-muted">{canEdit ? "Tap a panel on the car." : marked.length ? "Tap a panel to see it." : "Nothing marked."}</p>
          ) : (
            <div className="flex flex-col gap-2" data-marker-editor={selected}>
              <span className="text-base font-extrabold">{panelLabel(selected)}</span>
              <div className="flex flex-wrap gap-1.5">
                {DAMAGE_TYPES.map((d) => <button key={d.value} type="button" disabled={!canEdit} aria-pressed={mark.damage.includes(d.value)} onClick={() => setMark(selected, { damage: mark.damage.includes(d.value) ? mark.damage.filter((x) => x !== d.value) : [...mark.damage, d.value] })} className={chip(mark.damage.includes(d.value))} data-marker-damage={d.value}>{d.label}</button>)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SEVERITIES.map((d) => <button key={d.value} type="button" disabled={!canEdit} aria-pressed={mark.severity === d.value} onClick={() => setMark(selected, { severity: mark.severity === d.value ? null : d.value })} className={chip(mark.severity === d.value)} data-marker-severity={d.value}>{d.label}</button>)}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-bold" data-marker-note-label>{noteForCustomer ? "Note (shown to the customer)" : "Note"}</span>
                <Input value={mark.note ?? ""} onChange={(e) => setMark(selected, { note: e.target.value }, true)} disabled={!canEdit} placeholder="Optional" aria-label={`${panelLabel(selected)} note`} textCase="sentence" data-marker-note />
              </label>
              {photos ? (
                <div className="flex flex-col gap-2" data-marker-photos={selected}>
                  {(photos.byPanel[selected] ?? []).length ? (
                    <div className="flex flex-wrap gap-2">
                      {(photos.byPanel[selected] ?? []).map((p) => (
                        <ViewerThumb key={p.id} src={p.url} thumb={p.thumb} label={p.label} viewerKey={p.id} className="block h-16 w-16 overflow-hidden rounded-md bg-chip" data-marker-photo={p.id}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.thumb ?? p.url} alt={p.label} className="h-full w-full object-cover" />
                        </ViewerThumb>
                      ))}
                    </div>
                  ) : null}
                  {canEdit ? <MediaCapture key={selected} jobId={photos.jobId} token={photos.token} kind="damage_photo" caption={panelCaption(selected)} label={`Photo of the ${panelLabel(selected).toLowerCase()}`} hint="Tap to add a photo of this panel" multiple itemKey={null} /> : null}
                </div>
              ) : null}
            </div>
          )}
          {marked.length || unmarkedOnDevice.length ? (
            <ul className="flex flex-col gap-1 border-t border-line pt-2 text-sm" data-marker-list>
              {marked.map(([k, m]) => (
                <li key={k}>
                  <button type="button" onClick={() => setSelected(k)} className="flex flex-wrap items-center gap-2 text-left">
                    <span className={`inline-block h-3 w-3 rounded-full ${toneOf(m) === "red" ? "bg-red-bar" : "bg-amber-bar"}`} aria-hidden />
                    <span className="font-bold">{panelLabel(k)}</span>
                    <span className="text-muted">{[damageWords(m.damage), m.note].filter(Boolean).join(" – ")}</span>
                    {onDevice[k] ? <span className="text-xs font-semibold text-amber" data-marker-device={k}>↑ {deviceWords(onDevice[k])}</span> : null}
                  </button>
                </li>
              ))}
              {unmarkedOnDevice.map((k) => (
                <li key={k}>
                  <button type="button" onClick={() => setSelected(k)} className="flex flex-wrap items-center gap-2 text-left">
                    <span className="inline-block h-3 w-3 rounded-full border border-amber-bar" aria-hidden />
                    <span className="font-bold">{panelLabel(k)}</span>
                    <span className="text-xs font-semibold text-amber" data-marker-device={k}>↑ {deviceWords(onDevice[k])}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
        </div>
      </div>
      {footer}
    </Card>
  );
}
