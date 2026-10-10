"use client";

import { useState } from "react";

/** The VIN with a one-tap Copy, for every Parts screen (the number goes straight into the supplier's catalogue search). */
export function CopyVin({ vin }: { vin: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!vin) return <span className="text-xs text-muted">No VIN</span>;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(vin);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy the VIN", vin);
        }
      }}
      className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line-strong bg-white px-3 font-mono text-sm font-semibold hover:border-ink"
      aria-label="Copy the VIN"
    >
      <span className="tracking-[0.04em]">{vin}</span>
      <span className={`text-[11px] font-bold ${copied ? "text-green" : "text-muted"}`}>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
