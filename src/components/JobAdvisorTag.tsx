"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { askAdvisorAction } from "@/app/(app)/parts/advisor-ask-actions";
import { Button, Field, Select, Textarea } from "@/components/ui";

type Advisor = { advisorId: string | null; advisorName: string | null; quoteById: string | null; quoteByName: string | null };

/**
 * "Advisor: Adarsh (quotation by Arsalan)" next to the plate, car and job number on every parts screen (6 November
 * 2026, Peter). Tapping the name opens a centre window: a question to that advisor's bell about the car or one part
 * line. INTERNAL ONLY - never rendered on a supplier copy, a supplier list or a customer page.
 */
export function JobAdvisorTag({
  jobId,
  jobWords,
  advisor,
  parts = [],
  canAsk = true,
}: {
  jobId: string;
  /** "J-00988 · DUBAI DD 23864", for the window's title. */
  jobWords: string;
  advisor: Advisor;
  parts?: { id: string; name: string }[];
  canAsk?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const name = advisor.advisorName;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5" data-job-advisor={jobId} data-advisor-id={advisor.advisorId ?? ""}>
      {name && canAsk ? (
        <button type="button" onClick={() => setOpen(true)} className="font-extrabold text-ink underline decoration-dotted underline-offset-4 min-h-9 cursor-pointer" data-advisor-ask-open>
          Advisor: {name}
        </button>
      ) : (
        <span className="font-extrabold text-ink">Advisor: {name ?? "not set yet"}</span>
      )}
      {advisor.quoteByName ? <span className="text-xs text-muted" data-quote-by>(quotation by {advisor.quoteByName})</span> : null}
      {open && advisor.advisorId ? <AskWindow jobId={jobId} jobWords={jobWords} name={name ?? "the advisor"} parts={parts} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function AskWindow({ jobId, jobWords, name, parts, onClose }: { jobId: string; jobWords: string; name: string; parts: { id: string; name: string }[]; onClose: () => void }) {
  const [text, setText] = useState("");
  const [partId, setPartId] = useState("");
  const [answer, setAnswer] = useState<{ error?: string; message?: string } | null>(null);
  const [busy, start] = useTransition();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const send = () =>
    start(async () => {
      try {
        const r = await askAdvisorAction(jobId, partId || null, text);
        setAnswer(r);
        if (r.ok) setText("");
      } catch {
        setAnswer({ error: "No connection – try again." });
      }
    });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} data-advisor-ask-window>
      <div className="w-full max-w-lg rounded-card bg-white p-5 flex flex-col gap-4 max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Ask ${name}`}>
        <div className="flex flex-col gap-0.5">
          <span className="text-lg font-extrabold">Ask {name}</span>
          <span className="text-sm text-muted">{jobWords}</span>
        </div>
        {answer?.message ? (
          <p className="text-sm font-bold text-green-text" data-advisor-ask-sent>{answer.message}</p>
        ) : (
          <>
            {parts.length ? (
              <Field label="About a part" optional>
                <Select value={partId} onChange={(e) => setPartId(e.target.value)} data-advisor-ask-part>
                  <option value="">The whole car</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Your question">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="For example: does the customer want genuine or aftermarket?" data-advisor-ask-text />
            </Field>
            {answer?.error ? <p className="text-sm font-bold text-red" data-advisor-ask-error>{answer.error}</p> : null}
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" tone="secondary" size="md" onClick={onClose} data-advisor-ask-close>{answer?.message ? "Close" : "Cancel"}</Button>
          {answer?.message ? null : (
            <Button type="button" size="md" onClick={send} disabled={busy || text.trim().length < 3} data-advisor-ask-send>
              {busy ? "Sending…" : `Send to ${name}`}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
