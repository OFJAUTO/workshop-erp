"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button } from "@/components/ui";
import { markReadySent } from "@/app/(app)/invoices/actions";

/** "Your car is ready": the WhatsApp message with the invoice link, in the centre window, recorded when sent. */
export function ReadySendControl({ jobId, token, siteUrl, messageTemplate, phoneDigits, sentAt }: { jobId: string; token: string | null; siteUrl: string; messageTemplate: string; phoneDigits: string; sentAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const message = token ? messageTemplate.replaceAll("[link]", `${siteUrl}/invoice/${token}`) : null;
  if (!token) return <p className="text-xs text-muted">The message is ready once the invoice is issued.</p>;
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="md" tone={sentAt ? "secondary" : "primary"} onClick={() => setOpen(true)}>{sentAt ? "Send again: car is ready" : "Send: your car is ready"}</Button>
      {open ? <SendLinkDialog title="Your car is ready" message={message} phoneDigits={phoneDigits} onSent={(method) => start(async () => { await markReadySent(jobId, method); router.refresh(); })} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
