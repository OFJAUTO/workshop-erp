"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button } from "@/components/ui";
import { markLpoSent } from "../../order-actions";

/**
 * "Send to supplier": the supplier copy of the LPO as a link in a short WhatsApp message, with Copy. Only
 * the supplier copy ever leaves the system: no job card, no dates per part, no names.
 */
export function LpoSendControl({ poId, number, dateText, link, phoneDigits, sentAt }: { poId: string; number: string; dateText: string; link: string; phoneDigits: string; sentAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const message = `OFJ Automotive · LPO ${number}, ${dateText}. The order is here:\n${link}`;
  return (
    <>
      <Button type="button" size="lg" tone={sentAt ? "secondary" : "primary"} onClick={() => setOpen(true)}>{sentAt ? "Send to supplier again" : "Send to supplier"}</Button>
      {open ? <SendLinkDialog title={`LPO ${number} to the supplier`} message={message} phoneDigits={phoneDigits} onSent={(method) => start(async () => { await markLpoSent(poId, method); router.refresh(); })} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
