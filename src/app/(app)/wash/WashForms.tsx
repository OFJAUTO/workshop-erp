"use client";

import { useState } from "react";
import { Button, Textarea } from "@/components/ui";

/** "Send to wash" or "Wash done", and "Skip with a reason"; advisors and the owner only. One tap each. */
export function WashForms({ jobId, atWash, canAct, from = null, sendAction, doneAction, skipAction }: { jobId: string; atWash: boolean; canAct: boolean; from?: string | null; sendAction: (formData: FormData) => void; doneAction: (formData: FormData) => void; skipAction: (formData: FormData) => void }) {
  const [skipping, setSkipping] = useState(false);
  void jobId;
  if (!canAct) return <span className="text-xs text-muted">{atWash ? "At the wash. The advisor marks it done." : "Waiting for the advisor to send it to the wash."}</span>;
  return (
    <div className="flex flex-col gap-2 md:items-end">
      {!skipping ? (
        <form action={atWash ? doneAction : sendAction} className="flex flex-wrap items-center gap-2">
          {from ? <input type="hidden" name="from" value={from} /> : null}
          <Button type="submit" size="lg">{atWash ? "Wash done" : "Send to wash"}</Button>
          <Button type="button" tone="ghost" size="md" onClick={() => setSkipping(true)}>Skip the wash</Button>
        </form>
      ) : (
        <form action={skipAction} className="flex flex-wrap items-end gap-2">
          {from ? <input type="hidden" name="from" value={from} /> : null}
          <Textarea name="reason" rows={1} required placeholder="Why the wash is skipped (logged)" className="min-w-64" />
          <Button type="submit" tone="secondary" size="md">Skip, car is Ready</Button>
          <Button type="button" tone="ghost" size="md" onClick={() => setSkipping(false)}>Back</Button>
        </form>
      )}
    </div>
  );
}
