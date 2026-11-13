"use client";
import { useState, useTransition } from "react";
import { revealHrNumber } from "./actions";

/** An ID number masked until tapped; the tap is logged on the server (11 November 2026, Section 15). Since 13 November
 * the page sends only the MASKED number; the real one comes from the server on the tap. */
export function RevealNumber({ documentId, masked }: { documentId: string; masked: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!masked) return <span className="text-sm text-muted">No number</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm font-semibold tracking-[0.04em]" data-hr-number={shown ? "shown" : "masked"}>{shown ?? masked}</span>
      {shown ? (
        <button type="button" onClick={() => setShown(null)} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-xs font-bold">Hide</button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await revealHrNumber(documentId);
              if (r.error) setError(r.error);
              else setShown(r.number ?? "");
            })
          }
          className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-xs font-bold"
          data-hr-reveal={documentId}
        >
          {busy ? "…" : "Show"}
        </button>
      )}
      {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
    </span>
  );
}
