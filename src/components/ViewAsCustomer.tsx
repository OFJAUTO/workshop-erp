"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { customerPreviewHref } from "@/app/(app)/preview-actions";

/**
 * VIEW AS CUSTOMER (10 November 2026, Section 10): next to "Job card" on every page with a customer link. It opens the
 * customer's own page (the same component) in a phone-sized frame, read-only: a staff preview never counts as opened,
 * and nothing can be approved, paid or sent from it. Not sent yet: "Preview – not sent yet".
 */
export function ViewAsCustomer({ href, notSent = false, make }: { href: string | null; notSent?: boolean; /** A document with no link yet: the link is made (never sent) when the button is pressed. */ make?: { kind: "report" | "quote"; id: string } }) {
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const withPreview = (h: string) => `${h}${h.includes("?") ? "&" : "?"}preview=1`;
  const press = async () => {
    setError(null);
    if (href) return setOpen(withPreview(href));
    if (!make) return;
    setBusy(true);
    const r = await customerPreviewHref(make.kind, make.id).catch(() => ({ error: "No connection – try again." }) as { href?: string; error?: string });
    setBusy(false);
    if (r.href) setOpen(withPreview(r.href));
    else setError(r.error ?? "Try again.");
  };
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={() => void press()} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-white px-3 text-sm font-bold disabled:opacity-60" data-view-as-customer={notSent ? "not-sent" : "sent"}>
        View as customer
      </button>
      {error ? <span className="mt-1 text-xs font-semibold text-red" data-view-as-customer-error>{error}</span> : null}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-3" role="dialog" aria-modal="true" aria-label="View as customer" onClick={() => setOpen(null)} data-view-as-customer-window>
              <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col gap-2 rounded-card bg-white p-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-extrabold" data-view-as-customer-label>{notSent ? "Preview – not sent yet" : "As the customer sees it"}</span>
                  <span className="flex items-center gap-2">
                    <a href={open} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Open in a new tab</a>
                    <button type="button" onClick={() => setOpen(null)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-line-strong text-base font-bold" aria-label="Close" data-view-as-customer-close>✕</button>
                  </span>
                </div>
                <iframe src={open} title="The customer's page" className="h-[min(780px,calc(100dvh-6rem))] w-[min(390px,calc(100vw-3rem))] rounded-control border border-line bg-white" data-view-as-customer-frame />
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
