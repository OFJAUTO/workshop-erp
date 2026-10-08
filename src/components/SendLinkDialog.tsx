"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The centre window that opens where a "send to customer" button was clicked: the written message
 * that will go out, a large black Open WhatsApp button, Copy message, and Close. The result of the
 * click is here, never lower down the page.
 */
export function SendLinkDialog({
  title,
  message,
  phoneDigits,
  onSent,
  onClose,
  children,
}: {
  title: string;
  /** The full message with the link already in it. */
  message: string | null;
  phoneDigits: string;
  /** Called when WhatsApp was opened or the message copied. */
  onSent?: (method: "whatsapp" | "copy") => void;
  onClose: () => void;
  /** Shown instead of the message while a step is still needed (for example choosing the recipient). */
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopyError("Could not copy. Select the message and copy it by hand.");
    }
    onSent?.("copy");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="w-full max-w-lg rounded-card bg-white p-5 flex flex-col gap-4 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">
            ✕
          </button>
        </div>
        {children ? (
          children
        ) : message ? (
          <>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Message to the customer</p>
            <textarea readOnly value={message} rows={6} className="w-full rounded-control border border-line bg-canvas p-3 text-sm" onFocus={(e) => e.currentTarget.select()} />
            {phoneDigits ? (
              <a
                href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => onSent?.("whatsapp")}
                className="inline-flex w-full items-center justify-center min-h-16 rounded-control bg-ink text-white text-lg font-extrabold"
              >
                Open WhatsApp
              </a>
            ) : (
              <p className="text-sm font-semibold text-amber">No phone number on file: copy the message and send it by hand.</p>
            )}
            <button type="button" onClick={copy} className="min-h-12 w-full rounded-control border border-line-strong bg-white text-sm font-bold">
              {copied ? "Copied message and link" : "Copy message and link"}
            </button>
            {copyError ? <span className="text-xs font-semibold text-red">{copyError}</span> : null}
          </>
        ) : null}
        <button type="button" onClick={onClose} className="min-h-11 w-full rounded-control text-sm font-bold text-muted hover:bg-chip">
          Close
        </button>
      </div>
    </div>
  );
}
