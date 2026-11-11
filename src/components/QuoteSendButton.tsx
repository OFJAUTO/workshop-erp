"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logQuoteResend, prepareQuoteResend } from "@/app/(app)/quotes/actions";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button, LinkButton } from "@/components/ui";
import type { SendState } from "@/lib/quote-send-state";

/**
 * THE send / resend button (6 November 2026, Q-00062): always there for the owner and the advisors - on the job card's
 * quotation list, in the quotation and estimate page headers and in the lists' menus. Never sent: "Send to customer"
 * (its page runs the checks and sends; greyed with the reason while not ready, one tap opens the missing lines).
 * Finished: "Resend quote" opens the send window here, WhatsApp or copy, and the card says "Resent by …".
 */
export function QuoteSendButton({ state, pageHref, resentWords = null, autoOpen = false, size = "md" }: { state: SendState; /** The page of the version to send. */ pageHref: string; resentWords?: string | null; autoOpen?: boolean; size?: "md" | "lg" }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [win, setWin] = useState<{ message: string; phoneDigits: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const opened = useRef(false);
  const open = () => {
    setError(null);
    start(async () => {
      try {
        const r = await prepareQuoteResend(state.targetId);
        if (r.error || !r.message) setError(r.error ?? "Couldn't prepare the message.");
        else setWin({ message: r.message, phoneDigits: r.phoneDigits ?? "" });
      } catch {
        setError("No connection – try again.");
      }
    });
  };
  useEffect(() => {
    if (autoOpen && state.resend && state.enabled && !opened.current) {
      opened.current = true;
      open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page opens with ?send=1
  }, []);
  const sentVia = (method: "whatsapp" | "copy") =>
    start(async () => {
      const r = await logQuoteResend(state.targetId, method);
      if (r.error) setError(r.error);
      else setDone(true);
      router.refresh();
    });

  if (!state.enabled) {
    return (
      <span className="inline-flex flex-col gap-0.5" data-quote-send={state.label} data-quote-send-ready="0">
        <LinkButton href={pageHref} tone="secondary" size={size} className="opacity-60" data-quote-send-open>
          {state.label}
        </LinkButton>
        {state.reason ? <span className="text-xs font-semibold text-muted" data-quote-send-reason>{state.reason}</span> : null}
      </span>
    );
  }
  if (!state.resend) {
    return (
      <span className="inline-flex flex-col gap-0.5" data-quote-send={state.label} data-quote-send-ready="1">
        <LinkButton href={`${pageHref}?send=1`} size={size} data-quote-send-open>
          {state.label}
        </LinkButton>
        {state.reason ? <span className="text-xs text-muted" data-quote-send-reason>{state.reason}</span> : null}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-0.5" data-quote-send={state.label} data-quote-send-ready="1">
      <Button type="button" tone="secondary" size={size} onClick={open} disabled={busy} data-quote-send-open>
        {busy ? "Preparing…" : state.label}
      </Button>
      {done ? <span className="text-xs font-bold text-green-text" data-quote-resent>Resent ✓</span> : resentWords ? <span className="text-xs text-muted" data-quote-resent-words>{resentWords}</span> : null}
      {error ? <span className="text-xs font-bold text-red" data-quote-send-error>{error}</span> : null}
      {win ? <SendLinkDialog title="Quotation to the customer" message={win.message} phoneDigits={win.phoneDigits} onSent={sentVia} onClose={() => setWin(null)} /> : null}
    </span>
  );
}
