"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button, Input } from "@/components/ui";
import { markDepositRequested } from "./deposit-actions";

/**
 * "Send deposit request" on the job card's Advance payment box: the written WhatsApp message with the
 * amount, an optional pasted Pay now link added underneath, and the stamp on the job once it goes out.
 */
export function DepositRequestSend({ jobId, message, phoneDigits, requestedAt }: { jobId: string; message: string; phoneDigits: string; requestedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const router = useRouter();
  const clean = link.trim();
  const full = clean ? `${message}\n\nPay online:\n${clean}` : message;
  const done = async () => {
    await markDepositRequested(jobId);
    setOpen(false);
    router.refresh();
  };
  return (
    <>
      <Button type="button" size="md" tone={requestedAt ? "secondary" : "primary"} onClick={() => setOpen(true)} data-send-deposit-request>
        {requestedAt ? "Send the request again" : "Send deposit request"}
      </Button>
      {open ? (
        <SendLinkDialog
          title="Send the deposit request"
          message={full}
          phoneDigits={phoneDigits}
          onClose={() => setOpen(false)}
          onSent={() => void done()}
          above={
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Payment link (optional, added under the message)</span>
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="paste a Pay now link" data-deposit-pay-link />
            </label>
          }
        />
      ) : null}
    </>
  );
}
