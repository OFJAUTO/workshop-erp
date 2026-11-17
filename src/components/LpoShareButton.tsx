"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { SharePdfButton } from "@/components/SharePdfButton";

const DRAFT_WORDS = "DRAFT - FOR PRICE AND AVAILABILITY ONLY. NOT AN ORDER UNTIL APPROVED.";

/**
 * THE Share button of an LPO (17 November 2026, Section 5): one button, WhatsApp or email.
 *  - Before approval (`mode = "draft"`): the DRAFT for one supplier, the draft mark across it and in its header.
 *  - After approval (`mode = "final"`): the clean LPO.
 * WhatsApp: share the PDF file (the phone's share sheet, or download it on a PC), then open the chat with the message;
 * email: sent from the parts mailbox with the PDF attached. Every share is recorded on the LPO (who, when, how).
 */
export function LpoShareButton({ mode, number, supplier, phoneDigits, email, emailReady, pdfHref, jobId, share }: {
  mode: "draft" | "final";
  number: string;
  supplier: string;
  phoneDigits: string | null;
  email: string | null;
  emailReady: boolean;
  pdfHref: string;
  jobId: string | null;
  share: (method: "whatsapp" | "email") => Promise<{ error?: string; message?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<{ error?: string; message?: string } | null>(null);
  const [busy, start] = useTransition();
  const draft = mode === "draft";
  const message = draft
    ? `Dear ${supplier},\nPlease check prices and availability on the attached DRAFT of our LPO ${number} (OFJ Automotive).\n${DRAFT_WORDS} The approved LPO follows.\nThank you.`
    : `Dear ${supplier},\nPlease find attached our LPO ${number} (OFJ Automotive). Please quote the LPO number on your delivery note and invoice.\nThank you.`;
  const wa = `https://wa.me/${(phoneDigits ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
  const run = (method: "whatsapp" | "email") =>
    start(async () => {
      const r = await share(method);
      setAnswer(r);
      if (!r.error) router.refresh();
    });
  return (
    <>
      <button type="button" onClick={() => { setAnswer(null); setOpen(true); }} className={`inline-flex min-h-11 items-center rounded-control px-4 text-sm font-bold ${draft ? "border-2 border-ink bg-white" : "bg-ink text-on-dark"}`} data-lpo-share={mode} data-lpo-share-supplier={supplier}>
        {draft ? `Share draft with ${supplier}` : "Share"}
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={() => setOpen(false)}>
              <div className="flex w-full max-w-lg max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} data-lpo-share-window={mode}>
                <span className="text-lg font-extrabold">{draft ? `Share the DRAFT of ${number}` : `Share ${number}`} · {supplier}</span>
                {draft ? <p className="rounded-control border-2 border-ink px-3 py-2 text-sm font-extrabold" data-lpo-draft-words>{DRAFT_WORDS}</p> : null}
                <div className="flex flex-col gap-2 rounded-control border border-line p-3">
                  <span className="text-sm font-bold">WhatsApp</span>
                  <span className="text-xs text-muted">1. Share the PDF (on a phone it opens the share list; on a computer it downloads – attach it in the chat).</span>
                  <SharePdfButton href={pdfHref} fileName={`OFJ ${draft ? "DRAFT " : ""}${number}.pdf`} jobId={jobId} kind={draft ? "lpo_draft" : "lpo"} />
                  <span className="text-xs text-muted">2. Open the chat with the message, then send.</span>
                  {phoneDigits ? (
                    <a href={wa} target="_blank" rel="noreferrer" onClick={() => run("whatsapp")} className="inline-flex min-h-11 w-fit items-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-lpo-share-whatsapp>Open WhatsApp to {supplier}</a>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-text">No phone saved for {supplier}. <Link href="/parts/suppliers" className="underline underline-offset-4">Add it under Suppliers</Link> <button type="button" onClick={() => run("whatsapp")} className="min-h-11 rounded-control border border-line-strong px-3 text-xs font-bold text-ink" data-lpo-share-whatsapp>I sent it myself – note it</button></span>
                  )}
                </div>
                <div className="flex flex-col gap-2 rounded-control border border-line p-3">
                  <span className="text-sm font-bold">Email</span>
                  {emailReady && email ? (
                    <button type="button" disabled={busy} onClick={() => run("email")} className="inline-flex min-h-11 w-fit items-center rounded-control border-2 border-ink px-4 text-sm font-bold disabled:opacity-50" data-lpo-share-email>{busy ? "Sending…" : `Email the PDF to ${email}`}</button>
                  ) : (
                    <span className="text-xs font-semibold text-amber-text">{!emailReady ? "Email is not set up yet: use WhatsApp." : <>No email saved for {supplier}. <Link href="/parts/suppliers" className="underline underline-offset-4">Add it under Suppliers</Link>.</>}</span>
                  )}
                </div>
                {answer?.error ? <p className="rounded-control bg-red-soft px-3 py-2 text-sm font-semibold text-red" data-lpo-share-error>{answer.error}</p> : null}
                {answer?.message ? <p className="rounded-control bg-green-soft px-3 py-2 text-sm font-semibold text-green-text" data-lpo-share-done>{answer.message}</p> : null}
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-control border border-line-strong px-4 text-sm font-bold">Close</button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
