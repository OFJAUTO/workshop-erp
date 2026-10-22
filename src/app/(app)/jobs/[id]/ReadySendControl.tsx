"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button, Input } from "@/components/ui";
import { EXPECTED_METHODS, EXPECTED_METHOD_LABELS } from "@/lib/money-steps";
import { markInvoiceSent, markReadySent, prepareProformaSend } from "@/app/(app)/invoices/actions";

/**
 * "Your car is ready" with the proforma link, or the tax invoice once paid. For the proforma the window first asks
 * how the customer will pay (compulsory), offers Pay now (Network International, when set up) and a box to paste a
 * payment link; then the WhatsApp message. Recorded when sent.
 */
export function ReadySendControl({
  jobId,
  token,
  shortLink = null,
  siteUrl,
  messageTemplate,
  phoneDigits,
  sentAt,
  kind = "proforma",
  expectedMethod = null,
  payNowAvailable = false,
  payNowOn = false,
  size = "md",
  label = null,
  pdf = null,
  startWithPayNow = false,
  charges = {},
}: {
  jobId: string;
  token: string | null;
  /** The short address for the message (erp.ofjauto.com/m/xxxx). */
  shortLink?: string | null;
  siteUrl: string;
  messageTemplate: string;
  phoneDigits: string;
  sentAt: string | null;
  kind?: "proforma" | "tax_invoice";
  /** The method chosen the last time, pre-selected. */
  expectedMethod?: string | null;
  /** Network International keys are in place: the Pay now switch is offered. */
  payNowAvailable?: boolean;
  /** The customer's page already shows Pay now. */
  payNowOn?: boolean;
  size?: "md" | "lg";
  label?: string | null;
  pdf?: { href: string; fileName: string } | null;
  /** "Add Pay now and resend": the window opens with the switch on. */
  startWithPayNow?: boolean;
  /** Bank charge per method, shown next to the choice. */
  charges?: Record<string, number>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"how" | "message">(kind === "tax_invoice" ? "message" : "how");
  const [expected, setExpected] = useState<string | null>(expectedMethod);
  const [payNow, setPayNow] = useState(startWithPayNow || payNowOn);
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Before payment the link says proforma, never invoice; the tax invoice has its own address.
  const payLine = kind === "proforma" && (payNowOn || payNow || linkUrl.trim()) ? "\n\nYou can pay by card online: open the link and tap *Pay now*." : "";
  const message = token ? messageTemplate.replaceAll("[link]", shortLink ?? `${siteUrl}/${kind === "tax_invoice" ? "invoice" : "proforma"}/${token}`) + payLine : null;
  if (!token) return <p className="text-xs text-muted">The message is ready once the proforma is prepared.</p>;
  const tax = kind === "tax_invoice";
  const title = tax ? "Your tax invoice" : "Your car is ready";
  const buttonLabel = label ?? (tax ? (sentAt ? "Send the tax invoice again" : "Send the tax invoice") : sentAt ? (startWithPayNow ? "Add Pay now and resend" : "Send the proforma again") : "Send the proforma");

  function openWindow() {
    setError(null);
    setNote(null);
    setStep(tax ? "message" : "how");
    setOpen(true);
  }

  function continueToMessage() {
    if (!expected) {
      setError("Choose how the customer will pay.");
      return;
    }
    if (expected === "link" && !linkUrl.trim() && !payNow) {
      setError(payNowAvailable ? "Paste the payment link, or turn on Pay now." : "Paste the payment link first.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await prepareProformaSend(jobId, { expected, payNow: expected === "link" && payNow && !linkUrl.trim(), linkUrl: expected === "link" && linkUrl.trim() ? linkUrl.trim() : null });
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.payNowError) setNote(`${r.payNowError} The proforma can still go out: the customer sees the bank details.`);
      setStep("message");
      router.refresh();
    });
  }

  const sent = (method: "whatsapp" | "copy") =>
    start(async () => {
      const r = tax ? await markInvoiceSent(jobId, method) : await markReadySent(jobId, method, { expected });
      if (r.error) setError(r.error);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-1" data-ready-send={kind}>
      <Button type="button" size={size} tone={sentAt && !startWithPayNow ? "secondary" : "primary"} onClick={openWindow} className={size === "lg" ? "w-full" : ""}>
        {buttonLabel}
      </Button>
      {error && !open ? <span className="text-xs font-semibold text-red">{error}</span> : null}
      {open ? (
        <SendLinkDialog title={title} message={step === "message" ? message : null} phoneDigits={phoneDigits} onSent={sent} onClose={() => setOpen(false)} pdf={pdf ? { ...pdf, jobId, kind } : null} note={step === "message" ? note : null} spell={token ? { kind: "invoice", token } : null}>
          {step === "how" ? (
            <div className="flex flex-col gap-4" data-pay-how>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">How will the customer pay?</p>
                <div className="grid grid-cols-2 gap-2">
                  {EXPECTED_METHODS.map((m) => (
                    <button key={m} type="button" onClick={() => setExpected(m)} aria-pressed={expected === m} data-expected={m} className={`min-h-12 rounded-control border-2 px-2 text-sm font-bold flex flex-col items-center justify-center ${expected === m ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                      <span>{EXPECTED_METHOD_LABELS[m]}</span>
                      {charges[m] ? <span className={`text-[11px] font-semibold ${expected === m ? "text-white/80" : "text-muted"}`}>{charges[m]}% bank charge</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              {expected === "link" ? (
                <div className="flex flex-col gap-2" data-link-fields>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-muted">Paste the payment link (shown as a Pay now button on the proforma)</span>
                    <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" data-link-url />
                  </label>
                  {payNowAvailable && !linkUrl.trim() ? (
                    <label className="flex items-center gap-3 min-h-12 rounded-control border border-line-strong bg-white px-4 cursor-pointer" data-pay-now-switch>
                      <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-5 w-5 accent-ink" />
                      <span className="flex flex-col"><span className="text-sm font-bold">Create the link (Network International)</span><span className="text-xs text-muted">Pay now on the customer&apos;s page; the payment records itself.</span></span>
                    </label>
                  ) : null}
                </div>
              ) : null}
              {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
              <Button type="button" size="lg" className="w-full" disabled={pending || !expected} onClick={continueToMessage} data-pay-continue>{pending ? "Saving…" : "Continue to the message"}</Button>
            </div>
          ) : undefined}
        </SendLinkDialog>
      ) : null}
    </div>
  );
}
