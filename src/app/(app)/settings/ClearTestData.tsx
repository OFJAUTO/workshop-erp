"use client";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Input } from "@/components/ui";

const PHRASE = "CLEAR TEST DATA";

/** The owner's button for the testing phase: a backup first, then every job, car and customer is gone. Typed confirmation. */
export function ClearTestData({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(v, state) => (
        <>
          <p className="text-sm">Removes every job, car, customer, quotation, invoice, receipt, booking, parts order and uploaded file, and starts the numbering again from 00001. Staff, settings, the lists, the suppliers and the system&apos;s change log stay. A backup of every table is saved first.</p>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Type {PHRASE} to confirm</span><Input name="confirm" defaultValue={state.success ? "" : v.confirm} autoComplete="off" spellCheck={false} className="max-w-xs font-mono" /></label>
          <div><SubmitButton tone="danger" size="md">Clear test data</SubmitButton></div>
          {state.values?.report ? <pre className="whitespace-pre-wrap rounded-control bg-chip p-3 text-xs">{state.values.report}</pre> : null}
        </>
      )}
    </ActionForm>
  );
}
