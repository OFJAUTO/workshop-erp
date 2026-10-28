"use client";

import { useState } from "react";
import { Button, Textarea } from "@/components/ui";

type WashCar = { id: string; plate: string; title: string };

/**
 * "Send to wash" first asks "Is the car wash free?" with the live picture (who is in the wash, who is waiting);
 * "Yes, send to wash" sends, Cancel closes. "Wash done" and "Skip the wash" (with a reason) stay one tap.
 */
export function WashForms({ jobId, atWash, canAct, from = null, washState = null, sendAction, doneAction, skipAction }: { jobId: string; atWash: boolean; canAct: boolean; from?: string | null; washState?: { inWash: WashCar[]; waiting: WashCar[] } | null; sendAction: (formData: FormData) => void; doneAction: (formData: FormData) => void; skipAction: (formData: FormData) => void }) {
  const [skipping, setSkipping] = useState(false);
  const [asking, setAsking] = useState(false);
  void jobId;
  if (!canAct) return <span className="text-xs text-muted">{atWash ? "At the wash. The advisor marks it done." : "Waiting for the advisor to send it to the wash."}</span>;
  const busy = (washState?.inWash.length ?? 0) + (washState?.waiting.length ?? 0) > 0;
  return (
    <div className="flex flex-col gap-2 md:items-end">
      {!skipping ? (
        <form action={atWash ? doneAction : sendAction} className="flex flex-wrap items-center gap-2">
          {from ? <input type="hidden" name="from" value={from} /> : null}
          {atWash ? (
            <Button type="submit" size="lg">Wash done</Button>
          ) : (
            <Button type="button" size="lg" onClick={() => setAsking(true)} data-send-wash>Send to wash</Button>
          )}
          <Button type="button" tone="ghost" size="md" onClick={() => setSkipping(true)}>Skip the wash</Button>
          {asking ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" data-wash-ask>
              <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-3">
                <span className="text-lg font-extrabold">Is the car wash free?</span>
                <p className="text-sm">Check with the wash team before sending.</p>
                {busy ? (
                  <div className="flex flex-col gap-2 text-sm">
                    {washState?.inWash.length ? (
                      <div data-wash-in-now>
                        <span className="font-bold">In the wash now: {washState.inWash.length} car{washState.inWash.length === 1 ? "" : "s"}</span>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {washState.inWash.map((c) => <li key={c.id} className="text-muted"><span className="font-semibold text-ink">{c.plate}</span>{c.title ? ` · ${c.title}` : ""}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {washState?.waiting.length ? (
                      <div data-wash-waiting>
                        <span className="font-bold">Waiting: {washState.waiting.length}</span>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {washState.waiting.map((c) => <li key={c.id} className="text-muted"><span className="font-semibold text-ink">{c.plate}</span>{c.title ? ` · ${c.title}` : ""}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm font-bold text-green" data-wash-free>Wash is free</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="lg" data-wash-yes>Yes, send to wash</Button>
                  <Button type="button" tone="ghost" size="lg" onClick={() => setAsking(false)}>Cancel</Button>
                </div>
              </div>
            </div>
          ) : null}
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
