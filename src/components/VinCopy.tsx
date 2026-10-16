"use client";

import { useState } from "react";

/** The VIN in the header of every car page, with a Copy button; "VIN: add at gate-in" when the car has none. Internal only. */
export function VinCopy({ vin }: { vin: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!vin) return <span className="text-xs font-semibold text-muted" data-vin-missing>VIN: add at gate-in</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" data-vin={vin}>
      <span className="font-mono font-semibold tracking-wide">VIN {vin}</span>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(vin);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard not allowed here: the VIN is on screen to select by hand.
          }
        }}
        className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-[11px] font-bold hover:bg-chip"
        aria-label="Copy the VIN"
        data-vin-copy
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
