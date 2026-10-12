"use client";

import { useEffect, useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ReasonChips } from "@/components/ReasonChips";
import { Input, Textarea } from "@/components/ui";

const SAFE_TO_DRIVE = /safe to drive/i;

/** Scrolls to the parts list when the server refused the approval because of its tick. */
function ScrollOnError({ error }: { error: string | null }) {
  useEffect(() => {
    if (error && /parts list|no parts are needed/i.test(error)) document.getElementById("item-parts-list")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);
  return null;
}

/**
 * The workshop manager's approval: one-tap notes (the five most used in one row, "More notes" for the rest
 * under small headings; a selected note is green with a tick and a second tap removes its sentence; the
 * green state follows hand edits), the note box, an internal note for the advisor, the estimated hours.
 * The buttons live in the bar fixed to the bottom of the page (ReviewBar), nowhere else.
 */
export function ApproveForm({ action, hasPrescan, techHours = null, groups = {}, usage = {}, reasons = { raise: [], lower: [] } }: { action: FormAction; hasPrescan: boolean; techHours?: number | null; groups?: Record<string, string[]>; usage?: Record<string, number>; /** One-tap reasons for raising or lowering the technician's hours (Settings). */ reasons?: { raise: string[]; lower: string[] } }) {
  const [hours, setHours] = useState(techHours === null ? "" : String(techHours));
  const [note, setNote] = useState("");
  const [used, setUsed] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const changed = techHours !== null && hours.trim() !== "" && Number(hours.replace(",", ".")) !== techHours;
  const raising = techHours !== null && Number(hours.replace(",", ".")) > techHours;
  const all = Array.from(new Set(Object.values(groups).flat()));
  const top = [...all].sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0)).slice(0, 5);
  const selected = (p: string) => note.includes(p);
  function tap(p: string) {
    if (selected(p)) {
      setNote((n) => n.replace(p, "").replace(/\s{2,}/g, " ").trim());
      setConfirming(null);
      return;
    }
    if (SAFE_TO_DRIVE.test(p) && confirming !== p) {
      setConfirming(p);
      return;
    }
    setConfirming(null);
    setNote((n) => (n.trim() ? `${n.trim()} ${p}` : p));
    setUsed((u) => [...u, p]);
  }
  const chip = (p: string) => (
    <button key={p} type="button" onClick={() => tap(p)} aria-pressed={selected(p)} className={`min-h-10 rounded-control border px-2.5 text-left text-xs font-semibold ${selected(p) ? "border-green bg-green-soft text-green" : confirming === p ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
      {selected(p) ? "✓ " : ""}{confirming === p ? `Tap again to confirm: ${p}` : p}
    </button>
  );
  const rest = Object.entries(groups).map(([g, list]) => [g, list.filter((p) => !top.includes(p))] as const).filter(([, list]) => list.length);
  return (
    <div
      onSubmitCapture={(e) => {
        if (!hasPrescan && !window.confirm("No pre-scan attached. Approve anyway?")) e.preventDefault();
      }}
    >
      <ActionForm id="approve-form" action={action} className="flex flex-col gap-3">
        {(v, s) => (
          <>
            <ScrollOnError error={s.error ?? null} />
            {all.length ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {top.map(chip)}
                  {!more ? all.filter((p) => !top.includes(p) && selected(p)).map(chip) : null}
                  <button type="button" onClick={() => setMore((m) => !m)} className="min-h-10 rounded-control px-2.5 text-xs font-bold text-muted underline underline-offset-4">{more ? "Fewer notes" : "More notes"}</button>
                </div>
                {more ? (
                  <div className="flex flex-col gap-2 rounded-control bg-chip p-2">
                    {rest.map(([g, list]) => (
                      <div key={g} className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{g}</span>
                        <div className="flex flex-wrap gap-1.5">{list.map(chip)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Your note to the customer (required)</span>
              <Textarea name="manager_note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} required placeholder="Tap a note above or write one. It goes on the customer's report." />
            </label>
            <input type="hidden" name="presets_used" value={used.join("\n")} />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Note for the advisor (internal, optional)</span>
              <Textarea name="manager_note_internal" defaultValue={v.manager_note_internal} rows={2} placeholder="Never shown to the customer." />
            </label>
            {techHours !== null ? (
              <div className="flex flex-col gap-2 rounded-control bg-chip p-3">
                <span className="text-sm font-semibold">Estimated hours: the technician says {techHours} h</span>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-muted">Agree, or change it</span>
                    <Input name="estimated_hours_manager" value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className="w-28" required />
                  </label>
                  {changed ? (
                    <div className="flex flex-col gap-1 flex-1 min-w-48">
                      <ReasonChips name="hours_reason" label={`Why ${raising ? "more" : "fewer"} hours? (required when changed)`} options={raising ? reasons.raise : reasons.lower} defaultValue={v.hours_reason ?? ""} required placeholder="Tap a reason, or type" />
                    </div>
                  ) : null}
                </div>
                <span className="text-[11px] text-muted">The advisor sees the agreed figure on the quotation as the workshop estimate.</span>
              </div>
            ) : (
              <p className="text-xs text-muted">The technician gave no estimated hours.</p>
            )}
            {!hasPrescan ? <p className="text-xs text-amber font-semibold">No pre-scan PDF is attached yet. You can still approve.</p> : null}
            <p className="text-xs text-muted">Approve, or send back, from the bar at the bottom of the screen.</p>
          </>
        )}
      </ActionForm>
    </div>
  );
}

/** The reason for sending the report back; the button is in the bar at the bottom. */
export function ReturnForm({ action, reasons = [] }: { action: FormAction; /** One-tap reasons for sending back (Settings). */ reasons?: string[] }) {
  return (
    <ActionForm id="return-form" action={action} className="flex flex-col gap-3 border-t border-line pt-4">
      {(v) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Send back to the technician because</span>
          <ReasonChips name="return_reason" rows={2} options={reasons} defaultValue={v.return_reason ?? ""} placeholder="Required to send back: tap a reason or type" />
        </div>
      )}
    </ActionForm>
  );
}

/** The slim bar fixed to the bottom of the review: the two decisions, and nowhere else on the page. */
export function ReviewBar() {
  const [back, setBack] = useState(false);
  const submit = (id: string) => (document.getElementById(id) as HTMLFormElement | null)?.requestSubmit();
  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-60 z-40 border-t border-line bg-white px-4 py-2.5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        {back ? (
          <>
            <span className="text-xs font-semibold text-muted">Write the reason in the box, then</span>
            <button type="button" onClick={() => submit("return-form")} className="min-h-12 rounded-control border-2 border-ink bg-white px-4 text-sm font-bold">Send back now</button>
            <button type="button" onClick={() => setBack(false)} className="min-h-12 rounded-control px-3 text-sm font-semibold text-muted">Cancel</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { setBack(true); document.getElementById("return-form")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="min-h-12 rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Send back to the technician</button>
            <button type="button" onClick={() => submit("approve-form")} className="ml-auto min-h-12 rounded-control bg-ink px-5 text-sm font-bold text-white">Approve and send to the advisor</button>
          </>
        )}
      </div>
    </div>
  );
}

/** A technician or manager asks the owner to approve a change to a locked report. */
export function RequestChangeForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      {(v) => (
        <>
          <Textarea name="reason" defaultValue={v.reason} rows={2} required placeholder="What needs to change, and why" />
          <SubmitButton tone="secondary" size="md">Ask the owner to approve a change</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
