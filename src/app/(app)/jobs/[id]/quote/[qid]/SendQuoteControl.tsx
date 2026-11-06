"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button } from "@/components/ui";
import { markQuoteSent, resendQuotation, sendQuotation } from "@/app/(app)/quotes/actions";

/**
 * "Send quotation": the checks, then the centre window with the message, Open WhatsApp and Copy.
 * The total goes out exactly as it stands; a round-off is the advisor's own choice through the
 * "Round off" button in the Summary (3 November 2026) - nothing is rounded by itself any more.
 */
export function SendQuoteControl({ quotationId, kind, siteUrl, messageTemplate, phoneDigits, blocked, onBlocked, existingToken, shortLink = null, status, again = false, compact = false, autoOpen = false, isOwner = false }: { /** The owner may send a quotation waiting for his approval (sending records it). */ isOwner?: boolean; /** The short address for an existing link (erp.ofjauto.com/m/xxxx), from the page. */ shortLink?: string | null; /** Opens the send window on arrival (the "send the revised quotation" link). */ autoOpen?: boolean; quotationId: string; kind: "quotation" | "estimate"; siteUrl: string; messageTemplate: string; phoneDigits: string; blocked: boolean; onBlocked: () => void; existingToken: string | null; status: string; again?: boolean; /** In the bottom bar: a normal-sized button, the notes beside it. */ compact?: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(existingToken);
  const [short, setShort] = useState<string | null>(shortLink);
  // Arriving from "send the revised quotation": the window is open from the start.
  const [open, setOpen] = useState(autoOpen && !!existingToken);
  const [error, setError] = useState<string | null>(null);
  const [pendingOwner, setPendingOwner] = useState<string[] | null>(null);
  const [warranty, setWarranty] = useState(false);
  const [pending, start] = useTransition();
  const message = token ? messageTemplate.replaceAll("[link]", short ?? `${siteUrl}/quote/${token}`) : null;
  const label = kind === "estimate" ? "Send estimate" : "Send quotation";

  function send() {
    setError(null);
    if (blocked) {
      onBlocked();
      return;
    }
    go();
  }
  function go() {
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
      if (res.warranty) {
        setWarranty(true);
        router.refresh();
        return;
      }
      setToken(res.token);
      if (res.short) setShort(res.short);
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

  // Arriving with ?send=1 on a first send (6 November 2026): the link is made and the window opens by itself.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoOpen && !existingToken && !blocked && !again && !autoStarted.current) {
      autoStarted.current = true;
      go();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-2"}>
      {again ? (
        <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold">
          Send again
        </button>
      ) : (
        <Button type="button" size={compact ? "md" : "lg"} disabled={pending || (status === "pending_owner" && !isOwner)} onClick={send} className={`${compact ? "" : "w-full"} ${blocked ? "opacity-60" : ""}`}>
          {pending ? "Checking…" : status === "pending_owner" ? (isOwner ? "Approve and send" : "Waiting for the owner") : status === "expired" ? "Re-send" : label}
        </Button>
      )}
      {pendingOwner ? <p className="text-xs font-semibold text-amber">Sent to the owner for approval: {pendingOwner.join("; ")}. You will be told when it is approved.</p> : null}
      {warranty ? <p className="text-xs font-semibold text-green">Warranty repair: approved without the customer. Planning starts.</p> : null}
      {error ? <p className="text-xs font-semibold text-red">{error}</p> : null}
      {open ? <SendLinkDialog title={kind === "estimate" ? "Estimate to the customer" : "Quotation to the customer"} message={message} phoneDigits={phoneDigits} onSent={sent} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
