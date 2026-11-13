"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { addDeskPartsAction } from "../desk-part-actions";

/**
 * After the shared part picker on an ESTIMATE (13 November 2026, Section 5): "For job:" - one tap on the job the part is
 * for (or none), then Add. The part lands on the estimate tagged "Added by Parts" and waits for the advisor; an estimate
 * already sent needs a revision, and the window says so. The answer shows here, in the window.
 */
export function DeskForJobWindow({ estimateId, entries, jobs, onClose }: { estimateId: string; entries: { name: string; qty: number; positions: string[] }[]; jobs: { id: string; title: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [forId, setForId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ ok?: boolean; error?: string; words?: string } | null>(null);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const r = await addDeskPartsAction(estimateId, entries, forId);
      setAnswer(r);
      if (r.ok) router.refresh();
    });
  const chip = (id: string | null, label: string) => (
    <button key={id ?? "none"} type="button" onClick={() => setForId(id)} aria-pressed={forId === id} data-desk-for-job={id ?? "none"} className={`min-h-11 rounded-full border px-3 py-1.5 text-left text-sm font-semibold uppercase ${forId === id ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"}`}>
      {label}
    </button>
  );
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()} data-desk-for-window>
        <p className="font-bold">Add to the estimate</p>
        <ul className="text-sm font-semibold uppercase">
          {entries.map((e, i) => <li key={i}>{e.name} × {e.qty}</li>)}
        </ul>
        {answer?.ok ? (
          <>
            <p className="text-sm font-bold text-green-text" data-desk-add-done>{answer.words}</p>
            <Button type="button" tone="primary" size="lg" onClick={onClose} data-desk-add-close>Close</Button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold">For job:</p>
            <div className="flex flex-wrap gap-2">
              {jobs.map((j) => chip(j.id, j.title))}
              {chip(null, "Not for one job")}
            </div>
            <p className="text-xs text-muted">The part is tagged &quot;Added by Parts&quot;. The advisor accepts it onto the estimate or declines it.</p>
            {answer?.error ? <p className="text-sm font-bold text-red" data-desk-add-error>{answer.error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" tone="primary" size="lg" onClick={add} disabled={pending} data-desk-add-save>{pending ? "Adding…" : "Add"}</Button>
              <Button type="button" tone="secondary" size="lg" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
