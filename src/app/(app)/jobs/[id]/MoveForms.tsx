"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Select, Textarea } from "@/components/ui";
import { MANUAL_STATUS_OPTIONS, STATUS_LABELS } from "@/lib/jobs";

/** A workshop manager or advisor asks the owner for a special move, with a reason. */
export function RequestMoveForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      {(v) => (
        <>
          <Textarea name="reason" defaultValue={v.reason} rows={2} required placeholder="Why this job needs to move past the gate" />
          <SubmitButton tone="secondary" size="md">Request special move</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** The owner decides: the step to move to and a reason that stays on the job card. */
export function DecideMoveForm({ action, currentStatus }: { action: FormAction; currentStatus: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      {(v) => (
        <>
          <Select name="to_status" defaultValue={v.to_status ?? currentStatus}>
            {MANUAL_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Textarea name="decision_reason" defaultValue={v.decision_reason} rows={2} required placeholder="Your reason (required, stays on the job card)" />
          <div className="flex gap-2">
            <button type="submit" name="decision" value="approved" className="min-h-11 flex-1 rounded-control bg-ink px-3 text-sm font-bold text-white">
              Approve and move
            </button>
            <button type="submit" name="decision" value="refused" className="min-h-11 flex-1 rounded-control border border-line-strong bg-white px-3 text-sm font-bold">
              Refuse
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
