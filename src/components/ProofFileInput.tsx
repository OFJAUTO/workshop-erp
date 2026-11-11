"use client";

import { useRef, useState } from "react";
import { DocumentScanner } from "@/components/DocumentScanner";

/**
 * PROOF ON EVERY PAYMENT METHOD (10 November 2026, Section 6): "Add proof" and "Scan document" for a payment form that
 * sends its proof with the form (a payment with no job: the customer's combined payment, an estimate's proforma, a
 * pending charge). The scanned PDF is put into the same file box, so the form posts it like a picked file.
 */
export function ProofFileInput({ label, required, name = "proof", hint }: { label: string; required: boolean; name?: string; hint?: string }) {
  const box = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1" data-proof-picker={required ? "required" : "optional"}>
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold" data-proof-add>
          Add proof
          <input ref={box} type="file" name={name} accept="image/*,.pdf" required={required} className="sr-only" onChange={(e) => setPicked(e.currentTarget.files?.[0]?.name ?? null)} data-proof-input />
        </label>
        <button type="button" className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold" onClick={() => setScan(true)} data-proof-scan>Scan document</button>
        {picked ? <span className="text-xs font-semibold text-green-text" data-proof-picked>{picked} ✓</span> : null}
      </div>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      {scan ? (
        <DocumentScanner
          title="Scan the proof"
          onClose={() => setScan(false)}
          onDone={(file) => {
            const dt = new DataTransfer();
            dt.items.add(file);
            if (box.current) {
              box.current.files = dt.files;
              box.current.dispatchEvent(new Event("change", { bubbles: true }));
            }
            setPicked(file.name);
            setScan(false);
          }}
        />
      ) : null}
    </div>
  );
}
