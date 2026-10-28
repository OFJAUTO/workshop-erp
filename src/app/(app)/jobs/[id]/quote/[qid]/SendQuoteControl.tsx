"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button } from "@/components/ui";
import { aed, roundingChoices } from "@/lib/quotes";
import { markQuoteSent, resendQuotation, roundQuotation, sendQuotation } from "@/app/(app)/quotes/actions";

/**
 * "Send quotation": the rounding question (to the nearest ten dirhams, down by default), the checks,
 * then the centre window with the message, Open WhatsApp and Copy.
 */
export function SendQuoteControl({ quotationId, kind, siteUrl, messageTemplate, phoneDigits, blocked, onBlocked, existingToken, shortLink = null, status, total, roundedTotal, again = false, compact = false, autoOpen = false, isOwner = false }: { /** The owner may send a quotation waiting for his approval (sending records it). */ isOwner?: boolean; /** The short address for an existing link (erp.ofjauto.com/m/xxxx), from the page. */ shortLink?: string | null; /** Opens the send window on arrival (the "send the revised quotation" link). */ autoOpen?: boolean; quotationId: string; kind: "quotation" | "estimate"; siteUrl: string; messageTemplate: string; phoneDigits: string; blocked: boolean; onBlocked: () => void; existingToken: string | null; status: string; total: number; roundedTotal: number | null; again?: boolean; /** In the bottom bar: a normal-sized button, the notes beside it. */ compact?: boolean }) {
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
  const choices = roundingChoices(total);
  const whole = Math.abs(total - Math.round(total)) < 0.005;

  function send() {
    setError(null);
    if (blocked) {
      onBlocked();
      return;
    }
    // Totals to customers are whole dirhams: rounded down to the nearest ten by default; up only if the advisor chooses it afterwards.
    if (!roundedTotal && !whole && status !== "expired") {
      go(choices.down);
      return;
    }
    go(null);
  }
  function go(rounded: number | null) {
    start(async () => {
      if (rounded !== null) {
        const r = await roundQuotation(quotationId, rounded);
        if (r.error) {
          setError(r.error);
          return;
        }
      }
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
      {roundedTotal && roundedTotal < total && status === "draft" && !pending ? (
        <p className="text-xs text-muted">
          Total rounded down to {aed(roundedTotal)} (from {aed(total)}), shown to the customer as a discount.{" "}
          <button type="button" onClick={() => start(async () => { const r = await roundQuotation(quotationId, choices.up); if (r.error) setError(r.error); router.refresh(); })} className="font-semibold underline underline-offset-4">Round up to {aed(choices.up)} instead</button>
        </p>
      ) : null}
      {pendingOwner ? <p className="text-xs font-semibold text-amber">Sent to the owner for approval: {pendingOwner.join("; ")}. You will be told when it is approved.</p> : null}
      {warranty ? <p className="text-xs font-semibold text-green">Warranty repair: approved without the customer. Planning starts.</p> : null}
      {error ? <p className="text-xs font-semibold text-red">{error}</p> : null}
      {open ? <SendLinkDialog title={kind === "estimate" ? "Estimate to the customer" : "Quotation to the customer"} message={message} phoneDigits={phoneDigits} onSent={sent} onClose={() => setOpen(false)} spell={{ kind: "quotation", id: quotationId }} /> : null}
    </div>
  );
}
