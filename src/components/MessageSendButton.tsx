"use client";

import { useState } from "react";
import { logMessageSent } from "@/app/(app)/message-log-actions";
import { SendLinkDialog } from "@/components/SendLinkDialog";

/**
 * ONE send button for a customer message that is not a document's own send (audit M13, 6 November 2026): it opens
 * THE send window (the message to check and edit, WhatsApp or Copy, any number) and writes down who sent it and when.
 */
export function MessageSendButton({ label, title, message, phoneDigits, what, target, hook }: { label: string; title: string; message: string; phoneDigits: string; what: string; target: { jobId?: string | null; table?: "charge_entries"; recordId?: string | null }; hook?: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-message-send={hook ?? ""} {...(hook ? { [`data-${hook}`]: "" } : {})}>
        {sent ? `${label} again` : label}
      </button>
      {sent ? <span className="text-xs font-semibold text-green-text" data-message-sent={hook ?? ""}>Sent ✓ (written on the history)</span> : null}
      {open ? (
        <SendLinkDialog
          title={title}
          message={message}
          phoneDigits={phoneDigits}
          onSent={(method) => {
            setSent(true);
            void logMessageSent(target, what, method);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
