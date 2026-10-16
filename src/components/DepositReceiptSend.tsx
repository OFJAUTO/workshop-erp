"use client";

import { useState } from "react";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button } from "@/components/ui";

/** "Send receipt" on a deposit: the WhatsApp message with the receipt link, Share PDF, copy. */
export function DepositReceiptSend({ number, message, phoneDigits, pdfHref, fileName, jobId }: { number: string; message: string; phoneDigits: string; pdfHref: string; fileName: string; jobId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" tone="secondary" size="md" onClick={() => setOpen(true)} data-send-receipt={number}>
        Send receipt
      </Button>
      {open ? <SendLinkDialog title={`Send receipt ${number}`} message={message} phoneDigits={phoneDigits} pdf={{ href: pdfHref, fileName, jobId, kind: "receipt" }} onClose={() => setOpen(false)} onSent={() => setOpen(false)} /> : null}
    </>
  );
}
