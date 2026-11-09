"use client";

import { useState } from "react";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button, Input } from "@/components/ui";
import { reloadIfStale } from "@/lib/app-version";
import { markPaymentLinkSent, preparePaymentLink } from "./payment-link-actions";

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Send payment link" on the job card (1 November 2026, 1.9): the full balance or a custom amount, deposit asked or not.
 * The message (Settings > WhatsApp: payment link) carries our /p/ page; the bank's own pay-by-link can be pasted to open
 * from it. Accounts record the money when it arrives.
 */
export function PaymentLinkSend({ jobId, balance, message, phoneDigits }: { jobId: string; balance: number | null; message: string; phoneDigits: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"full" | "custom">(balance && balance > 0 ? "full" : "custom");
  const [custom, setCustom] = useState("");
  const [gateway, setGateway] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ shortLink: string; amount: number; host: string | null } | null>(null);
  const typed = Number(custom.replace(/,/g, "")) || 0;
  const amount = mode === "full" && balance ? balance : typed;

  const make = async () => {
    setError(null);
    setBusy(true);
    const r = await preparePaymentLink(jobId, amount, gateway.trim() ? gateway : undefined).catch((e) => (reloadIfStale(e) ? { error: "A new version is loading…" } : { error: "No connection – try again." }));
    setBusy(false);
    if ("error" in r && r.error) return setError(r.error);
    if ("shortLink" in r && r.shortLink) setReady({ shortLink: r.shortLink, amount: r.amount ?? amount, host: r.host ?? null });
  };
  const close = () => {
    setOpen(false);
    setReady(null);
  };
  const full = ready ? message.replaceAll("[amount]", money(ready.amount)).replaceAll("[link]", ready.shortLink) : null;

  return (
    <>
      <Button type="button" size="md" tone="secondary" className="w-full" onClick={() => setOpen(true)} data-send-payment-link>
        Send payment link
      </Button>
      {open ? (
        <SendLinkDialog title="Send a payment link" message={full} phoneDigits={phoneDigits} onClose={close} onSent={() => { if (ready) void markPaymentLinkSent(jobId, ready.amount); close(); }}>
          {!ready ? (
            <div className="flex flex-col gap-3" data-payment-link-amount>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={!balance || balance <= 0} onClick={() => setMode("full")} aria-pressed={mode === "full"} data-link-full className={`min-h-12 rounded-control border-2 text-sm font-bold disabled:opacity-50 ${mode === "full" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>
                  {balance && balance > 0 ? `Full balance · AED ${money(balance)}` : "Full balance (no total yet)"}
                </button>
                <button type="button" onClick={() => setMode("custom")} aria-pressed={mode === "custom"} data-link-custom className={`min-h-12 rounded-control border-2 text-sm font-bold ${mode === "custom" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>
                  Custom amount
                </button>
              </div>
              {mode === "custom" ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Amount to ask for (AED)</span>
                  <Input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="decimal" className="max-w-56" data-link-amount />
                </label>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted">Pay-now link from the bank (optional): it opens from our payment page and never goes in the message.</span>
                <Input value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="paste the gateway pay-page link" spellCheck={false} data-link-gateway />
              </label>
              {error ? <p className="text-sm font-semibold text-red" data-link-error>{error}</p> : null}
              <div>
                <Button type="button" size="md" disabled={busy || !(amount > 0)} onClick={() => void make()} data-link-make>{busy ? "…" : `Make the link for AED ${money(amount || 0)}`}</Button>
              </div>
            </div>
          ) : null}
        </SendLinkDialog>
      ) : null}
    </>
  );
}
