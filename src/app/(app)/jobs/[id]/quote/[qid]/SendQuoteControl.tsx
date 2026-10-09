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
export function SendQuoteControl({ quotationId, kind, siteUrl, messageTemplate, phoneDigits, blocked, onBlocked, existingToken, status, total, roundedTotal, again = false }: { quotationId: string; kind: "quotation" | "estimate"; siteUrl: string; messageTemplate: string; phoneDigits: string; blocked: boolean; onBlocked: () => void; existingToken: string | null; status: string; total: number; roundedTotal: number | null; again?: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(existingToken);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOwner, setPendingOwner] = useState<string[] | null>(null);
  const [warranty, setWarranty] = useState(false);
  const [pending, start] = useTransition();
  const message = token ? messageTemplate.replaceAll("[link]", `${siteUrl}/quote/${token}`) : null;
  const label = kind === "estimate" ? "Send estimate" : "Send quotation";
  const choices = roundingChoices(total);
  const whole = Math.abs(total - Math.round(total)) < 0.005;

  function send() {
    setError(null);
    if (blocked) {
      onBlocked();
      return;
    }
    // Totals to customers are whole dirhams: ask once, unless it already is or was rounded before.
    if (!roundedTotal && !whole && status !== "expired") {
      setAsking(true);
      return;
    }
    go(null);
  }
  function go(rounded: number | null) {
    setAsking(false);
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
      {asking ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">Round the total?</span>
            <p className="text-sm text-muted">The total is {aed(total)}. The customer sees a whole figure; the amount before VAT takes the difference.</p>
            <button type="button" onClick={() => go(choices.down)} className="min-h-14 rounded-control bg-ink text-white text-base font-extrabold">{aed(choices.down)} <span className="text-xs font-semibold opacity-80">(down)</span></button>
            <button type="button" onClick={() => go(choices.up)} className="min-h-14 rounded-control border-2 border-ink bg-white text-base font-extrabold">{aed(choices.up)} <span className="text-xs font-semibold text-muted">(up)</span></button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-10 text-sm font-semibold text-muted">Back</button>
          </div>
        </div>
      ) : null}
      {pendingOwner ? <p className="text-xs font-semibold text-amber">Sent to the owner for approval: {pendingOwner.join("; ")}. You will be told when it is approved.</p> : null}
      {warranty ? <p className="text-xs font-semibold text-green">Warranty repair: approved without the customer. Planning starts.</p> : null}
      {error ? <p className="text-xs font-semibold text-red">{error}</p> : null}
      {open ? <SendLinkDialog title={kind === "estimate" ? "Estimate to the customer" : "Quotation to the customer"} message={message} phoneDigits={phoneDigits} onSent={sent} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
