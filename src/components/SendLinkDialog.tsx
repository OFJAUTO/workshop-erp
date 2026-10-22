"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SharePdfButton } from "./SharePdfButton";
import { SpellCheckPanel } from "@/components/SpellCheckPanel";
import type { SpellSource } from "@/lib/spell-docs";

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
  pdf = null,
  note = null,
  above = null,
  spell = null,
  checkSpelling = true,
}: {
  /** The document behind the link, read by the spelling check together with the message (section 5, 23 October 2026). */
  spell?: SpellSource | null;
  /** The quick spelling check before sending (a reminder, never a block); off only for messages that are not words. */
  checkSpelling?: boolean;
  /** Extra controls shown above the message while keeping it (for example an optional payment-link box). */
  above?: ReactNode;
  /** The document as a PDF: "Share PDF" hands the file to the share sheet (or downloads it on a PC). */
  pdf?: { href: string; fileName: string; jobId?: string | null; kind?: string } | null;
  /** A warning shown above the message (for example Pay now could not be switched on). */
  note?: string | null;
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
  // The message as shown and sent: the spelling check's one-tap fixes change it here.
  const [edited, setEdited] = useState<{ from: string | null; text: string | null }>({ from: message, text: message });
  if (edited.from !== message) setEdited({ from: message, text: message });
  const shown = edited.text;
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown);
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
        ) : shown ? (
          <>
            {note ? <p className="text-sm font-semibold text-amber" data-pay-note>{note}</p> : null}
            {above}
            {checkSpelling ? <SpellCheckPanel message={shown} source={spell} onMessage={(text) => setEdited({ from: message, text })} /> : null}
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Message to the customer</p>
            <textarea readOnly value={shown} rows={6} className="w-full rounded-control border border-line bg-canvas p-3 text-sm" onFocus={(e) => e.currentTarget.select()} data-send-message />
            {phoneDigits ? (
              <a
                href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(shown)}`}
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
            {pdf ? <SharePdfButton href={pdf.href} fileName={pdf.fileName} jobId={pdf.jobId ?? null} kind={pdf.kind ?? "document"} /> : null}
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
