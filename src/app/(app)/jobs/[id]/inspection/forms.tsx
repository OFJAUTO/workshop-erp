"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Textarea } from "@/components/ui";

/** The workshop manager approves with a note. Without a pre-scan attached it asks first. */
export function ApproveForm({ action, hasPrescan }: { action: FormAction; hasPrescan: boolean }) {
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
