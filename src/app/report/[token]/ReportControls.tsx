"use client";

import { useState, type ReactNode } from "react";

/** A note shown by default, with Show and Hide buttons. */
export function ToggleBlock({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-white border border-line rounded-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">{title}</h2>
        <div className="flex gap-1 no-print">
          <button type="button" onClick={() => setOpen(true)} aria-pressed={open} className={`min-h-9 rounded-control border px-3 text-xs font-bold ${open ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
            Show
          </button>
          <button type="button" onClick={() => setOpen(false)} aria-pressed={!open} className={`min-h-9 rounded-control border px-3 text-xs font-bold ${!open ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
            Hide
          </button>
        </div>
      </div>
      {open ? children : null}
    </section>
  );
}

/** Saves the page as a PDF through the browser's print dialog. */
export function PrintButton({ label = "Download the report as a PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="no-print inline-flex min-h-12 w-full items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-white">
      {label}
    </button>
  );
}
