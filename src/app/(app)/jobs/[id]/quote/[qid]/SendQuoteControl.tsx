"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button } from "@/components/ui";
import { markQuoteSent, resendQuotation, sendQuotation } from "@/app/(app)/quotes/actions";

/** "Send quotation": checks, then the centre window with the message, Open WhatsApp and Copy. */
export function SendQuoteControl({ quotationId, kind, siteUrl, messageTemplate, phoneDigits, blocked, onBlocked, existingToken, status, again = false }: { quotationId: string; kind: "quotation" | "estimate"; siteUrl: string; messageTemplate: string; phoneDigits: string; blocked: boolean; onBlocked: () => void; existingToken: string | null; status: string; again?: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(existingToken);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOwner, setPendingOwner] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  const message = token ? messageTemplate.replaceAll("[link]", `${siteUrl}/quote/${token}`) : null;
  const label = kind === "estimate" ? "Send estimate" : "Send quotation";

  function send() {
    setError(null);
    if (blocked) {
      onBlocked();
      return;
    }
    start(async () => {
      const res = status === "expired" ? await resendQuotation(quotationId) : await sendQuotation(quotationId, {});
      if (res.pendingOwner) {
        setPendingOwner(res.pendingOwner);
        router.refresh();
        return;
      }
      if (res.error || !res.token) {
        setError(res.error ?? "Could not create the link.");
        return;
      }
      setToken(res.token);
      setOpen(true);
      router.refresh();
    });
  }
  const sent = (method: "whatsapp" | "copy") =>
    start(async () => {
      const res = await markQuoteSent(quotationId, method);
      if (res.error) setError(res.error);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      {again ? (
        <button type="button" onClick={() => setOpen(true)} className="self-start text-xs font-bold underline underline-offset-4">
          Send again
        </button>
      ) : (
        <Button type="button" size="lg" disabled={pending || status === "pending_owner"} onClick={send} className={`w-full ${blocked ? "opacity-60" : ""}`}>
          {pending ? "Checking…" : status === "pending_owner" ? "Waiting for the owner" : status === "expired" ? "Re-send" : label}
        </Button>
      )}
      {pendingOwner ? <p className="text-xs font-semibold text-amber">Sent to the owner for approval: {pendingOwner.join("; ")}. You will be told when it is approved.</p> : null}
      {error ? <p className="text-xs font-semibold text-red">{error}</p> : null}
      {open ? <SendLinkDialog title={kind === "estimate" ? "Estimate to the customer" : "Quotation to the customer"} message={message} phoneDigits={phoneDigits} onSent={sent} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
