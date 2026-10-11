"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { useState } from "react";
import { Input, Textarea } from "@/components/ui";

const SAFE_TO_DRIVE = /safe to drive/i;

/**
 * The workshop manager approves with a note (one-tap presets, most used first, combinable and editable; a
 * "safe to drive" note asks for a second tap), an optional internal note for the advisor, and agrees the
 * estimated hours. Without a pre-scan attached it asks first.
 */
export function ApproveForm({ action, hasPrescan, techHours = null, presets = [], partsCount = 0 }: { action: FormAction; hasPrescan: boolean; techHours?: number | null; presets?: string[]; partsCount?: number }) {
  const [hours, setHours] = useState(techHours === null ? "" : String(techHours));
  const [partsOk, setPartsOk] = useState(false);
  const [note, setNote] = useState("");
  const [used, setUsed] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const changed = techHours !== null && hours.trim() !== "" && Number(hours.replace(",", ".")) !== techHours;
  function tap(p: string) {
    if (SAFE_TO_DRIVE.test(p) && confirming !== p) {
      setConfirming(p);
      return;
    }
    setConfirming(null);
    setNote((n) => (n.trim() ? `${n.trim()} ${p}` : p));
    setUsed((u) => [...u, p]);
  }
  return (
    <div
      onSubmitCapture={(e) => {
        if (!hasPrescan && !window.confirm("No pre-scan attached. Approve anyway?")) e.preventDefault();
      }}
    >
      <ActionForm action={action} className="flex flex-col gap-3">
        {(v) => (
          <>
            {presets.length ? (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button key={p} type="button" onClick={() => tap(p)} className={`min-h-10 rounded-control border px-2.5 text-left text-xs font-semibold ${confirming === p ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                    {confirming === p ? `Tap again to confirm: ${p}` : p}
                  </button>
                ))}
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
                    <label className="flex flex-col gap-1 flex-1 min-w-48">
                      <span className="text-xs font-semibold text-muted">Why (required when changed)</span>
                      <Input name="hours_reason" defaultValue={v.hours_reason} required />
                    </label>
                  ) : null}
                </div>
                <span className="text-[11px] text-muted">The advisor sees the agreed figure on the quotation as the workshop estimate.</span>
              </div>
            ) : (
              <p className="text-xs text-muted">The technician gave no estimated hours.</p>
            )}
            {partsCount > 0 ? (
              <button type="button" onClick={() => setPartsOk((v) => !v)} aria-pressed={partsOk} className={`min-h-12 rounded-control border-2 px-4 text-left text-sm font-bold ${partsOk ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                {partsOk ? "✓ Parts list checked" : `Parts list checked (${partsCount} line${partsCount === 1 ? "" : "s"}) · tap once you have looked at it`}
              </button>
            ) : (
              <p className="text-xs text-muted">No parts on this report.</p>
            )}
            <input type="hidden" name="parts_list_confirmed" value={partsOk ? "1" : ""} />
            {!hasPrescan ? <p className="text-xs text-amber font-semibold">No pre-scan PDF is attached yet. You can still approve.</p> : null}
            <SubmitButton>Approve report</SubmitButton>
          </>
        )}
      </ActionForm>
    </div>
  );
}

/** The workshop manager sends the report back with a reason. */
export function ReturnForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3 border-t border-line pt-4">
      {(v) => (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Send back to the technician because</span>
            <Textarea name="return_reason" defaultValue={v.return_reason} rows={2} required />
          </label>
          <SubmitButton tone="secondary">Send back</SubmitButton>
        </>
      )}
    </ActionForm>
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
