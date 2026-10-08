"use client";

import { useState, type ReactNode } from "react";

/** A section folded behind an arrow. The content is only put on the page when opened, so heavy media loads on demand. */
export function Collapsible({ title, right, children, defaultOpen = false }: { title: ReactNode; right?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-white border border-line rounded-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full min-h-14 px-5 flex items-center justify-between gap-3 text-left cursor-pointer">
        <span className="text-sm font-extrabold tracking-[0.08em] uppercase">{title}</span>
        <span className="flex items-center gap-3">
          {right ? <span className="text-sm font-semibold text-muted">{right}</span> : null}
          <span className={`inline-block transition-transform text-lg ${open ? "rotate-180" : ""}`} aria-hidden>
            ⌄
          </span>
        </span>
      </button>
      {open ? <div className="px-5 pb-5 flex flex-col gap-4">{children}</div> : null}
    </section>
  );
}
