"use client";

import { ActionForm, SubmitButton, type FormAction } from "./forms";
import { InspectionFeeChoice } from "./InspectionFeeChoice";
import { Textarea } from "./ui";
import type { FeeBounds, FeeInput } from "@/lib/inspection-fee";

/** The owner changes the inspection fee after the customer approved the job card (30 October 2026): the same choice, with a reason, logged. */
export function OwnerFeeChange({ action, initial, bounds }: { action: FormAction; initial: FeeInput; bounds: FeeBounds }) {
  return (
    <details className="text-sm" data-owner-fee-change>
      <summary className="min-h-11 cursor-pointer font-semibold underline underline-offset-4">Change the inspection fee (owner)</summary>
      <ActionForm action={action} className="mt-2 flex flex-col gap-3 rounded-control border border-line-strong p-3">
        {() => (
          <>
            <InspectionFeeChoice initial={initial} bounds={bounds} isOwner />
            <Textarea name="owner_reason" rows={2} placeholder="Why it changes after the customer's approval (logged)" required minLength={5} data-owner-fee-reason />
            <div><SubmitButton>Save the change</SubmitButton></div>
          </>
        )}
      </ActionForm>
    </details>
  );
}
