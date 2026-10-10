"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button } from "@/components/ui";
import { markInvoiceSent, markReadySent } from "@/app/(app)/invoices/actions";

/** "Your car is ready" with the proforma link, or the tax invoice once paid: the WhatsApp message in the centre window, recorded when sent. */
export function ReadySendControl({ jobId, token, siteUrl, messageTemplate, phoneDigits, sentAt, kind = "proforma" }: { jobId: string; token: string | null; siteUrl: string; messageTemplate: string; phoneDigits: string; sentAt: string | null; kind?: "proforma" | "tax_invoice" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const message = token ? messageTemplate.replaceAll("[link]", `${siteUrl}/invoice/${token}`) : null;
  if (!token) return <p className="text-xs text-muted">The message is ready once the proforma is prepared.</p>;
  const tax = kind === "tax_invoice";
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="md" tone={sentAt ? "secondary" : "primary"} onClick={() => setOpen(true)}>{tax ? (sentAt ? "Send the tax invoice again" : "Send the tax invoice") : sentAt ? "Send the proforma again" : "Send the proforma"}</Button>
      {open ? <SendLinkDialog title={tax ? "Your tax invoice" : "Your car is ready"} message={message} phoneDigits={phoneDigits} onSent={(method) => start(async () => { if (tax) await markInvoiceSent(jobId, method); else await markReadySent(jobId, method); router.refresh(); })} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
