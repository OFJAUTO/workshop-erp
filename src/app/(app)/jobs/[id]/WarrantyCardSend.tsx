"use client";

import { CopyText } from "@/components/CopyText";
import { markWarrantyCardSent } from "../warranty-card-actions";

/** After gate-out: the short "Your OFJ warranty card" WhatsApp with its short link, one tap to send (written down). */
export function WarrantyCardSend({ jobId, message, phoneDigits, sentAt }: { jobId: string; message: string; phoneDigits: string; sentAt: string | null }) {
  return (
    <div className="flex flex-col gap-2" data-warranty-send>
      <p className="whitespace-pre-wrap text-sm text-muted" data-warranty-message>{message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          onClick={() => void markWarrantyCardSent(jobId)}
          className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white"
          data-warranty-whatsapp
        >
          {sentAt ? "Send again on WhatsApp" : "Send on WhatsApp"}
        </a>
        <CopyText text={message} label="Copy the message" />
        {sentAt ? <span className="text-xs text-muted" data-warranty-sent>Sent {new Date(sentAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
      </div>
    </div>
  );
}
