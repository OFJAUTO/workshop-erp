"use client";

import { useState, useTransition, type ReactNode } from "react";

/**
 * EVERY WARNING COMES WITH ITS FIX (13 November 2026, Section 4): THE warning box. The message, and right beside it the
 * button that fixes it on the same page - a small panel with exactly the fields needed (children), or an action - or,
 * for someone not allowed to fix it, "Remind <name>" that nudges the person who can. The user never leaves the page.
 */
export function FixIt({ message, tone = "red", fixLabel, children, remind, hook, open: startOpen = false, link = null }: {
  message: ReactNode;
  tone?: "red" | "amber";
  /** The button that opens the fixing panel (children). */
  fixLabel?: string;
  children?: ReactNode;
  /** Not allowed to fix it: who is reminded. */
  remind?: { label: string; action: () => Promise<{ ok?: boolean; error?: string }> } | null;
  hook?: string;
  open?: boolean;
  /** A fix that is a place on this page or the screen it belongs to ("Finish the gate-in photos"). */
  link?: { href: string; label: string } | null;
}) {
  const [open, setOpen] = useState(startOpen);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const box = tone === "red" ? "border-red-bar bg-red-soft text-red" : "border-amber-bar bg-amber-soft text-amber-text";
  return (
    <div className={`flex flex-col gap-2 rounded-control border-2 p-3 ${box}`} data-fixit={hook ?? ""}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-bold">{message}</span>
        {fixLabel && children ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-h-11 shrink-0 rounded-control border border-ink bg-ink px-3 text-sm font-bold text-white" data-fixit-open>
            {open ? "Close" : fixLabel}
          </button>
        ) : null}
        {link ? <a href={link.href} className="inline-flex min-h-11 shrink-0 items-center rounded-control border border-ink bg-ink px-3 text-sm font-bold text-white" data-fixit-link>{link.label}</a> : null}
        {remind ? (
          <button type="button" disabled={busy || !!done} onClick={() => start(async () => { const r = await remind.action(); setDone(r.error ? null : "Reminded ✓"); setErr(r.error ?? null); })} className="min-h-11 shrink-0 rounded-control border border-ink bg-white px-3 text-sm font-bold text-ink disabled:opacity-60" data-fixit-remind>
            {done ?? remind.label}
          </button>
        ) : null}
      </div>
      {err ? <span className="text-sm font-bold" data-fixit-error>{err}</span> : null}
      {open && children ? <div className="rounded-control border border-line bg-white p-3 text-ink" data-fixit-panel>{children}</div> : null}
    </div>
  );
}
