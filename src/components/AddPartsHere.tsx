"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPartsHere } from "@/app/(app)/quotes/part-quote-actions";
import { Button } from "@/components/ui";

export type OtherPart = { id: string; name: string; cost: number; belongs: string | null };

const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Parts priced for this job on another quote (n) – Add here" (11 November 2026, Section 2): priced parts that are not
 * this quotation's (on another draft, or on none yet) join it with one tap, each as a line priced by the parts desk.
 */
export function AddPartsHere({ jobId, quotationId, number, parts }: { jobId: string; quotationId: string; number: string; parts: OtherPart[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [busy, start] = useTransition();
  if (!parts.length && !answer?.ok) return null;
  return (
    <div className="flex flex-col gap-2 rounded-control border-2 border-amber-bar bg-amber-soft px-3 py-2" data-add-parts-here={parts.length}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Parts priced for this job on another quote ({parts.length})</span>
        {parts.length ? (
          <>
            <button type="button" onClick={() => setOpen(!open)} className="min-h-11 text-sm font-bold underline underline-offset-4" data-add-parts-here-list>{open ? "Hide" : "See them"}</button>
            <Button
              type="button"
              size="md"
              className="ml-auto"
              disabled={busy}
              data-add-parts-here-go
              onClick={() =>
                start(async () => {
                  const r = await addPartsHere(jobId, quotationId, parts.map((p) => p.id));
                  setAnswer(r);
                  if (r?.ok) router.refresh();
                })
              }
            >
              {busy ? "Adding…" : `Add here (${parts.length})`}
            </Button>
          </>
        ) : null}
      </div>
      {open && parts.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {parts.map((p) => (
            <li key={p.id} className="flex flex-wrap gap-x-2" data-add-parts-here-part={p.id}>
              <span className="font-semibold uppercase">{p.name}</span>
              <span className="text-muted">cost AED {aed(p.cost)} · {p.belongs ? `now for ${p.belongs}` : "not on a quotation yet"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {answer?.error ? <p className="text-sm font-bold text-red" data-add-parts-here-error>{answer.error}</p> : null}
      {answer?.ok ? <p className="text-sm font-bold text-green-text" data-add-parts-here-done>{answer.message} They are priced by the parts desk: check the markup, then send.</p> : null}
      <span className="sr-only">{number}</span>
    </div>
  );
}
