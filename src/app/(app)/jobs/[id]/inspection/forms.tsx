"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { useState } from "react";
import { Input, Textarea } from "@/components/ui";

/** The workshop manager approves with a note and agrees the estimated hours. Without a pre-scan attached it asks first. */
export function ApproveForm({ action, hasPrescan, techHours = null }: { action: FormAction; hasPrescan: boolean; techHours?: number | null }) {
  const [hours, setHours] = useState(techHours === null ? "" : String(techHours));
  const changed = techHours !== null && hours.trim() !== "" && Number(hours.replace(",", ".")) !== techHours;
  return (
    <div
      onSubmitCapture={(e) => {
        if (!hasPrescan && !window.confirm("No pre-scan attached. Approve anyway?")) e.preventDefault();
      }}
    >
      <ActionForm action={action} className="flex flex-col gap-3">
        {(v) => (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Your note (required)</span>
              <Textarea name="manager_note" defaultValue={v.manager_note} rows={3} required />
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
