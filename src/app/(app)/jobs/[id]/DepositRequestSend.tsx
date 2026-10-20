"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { Button, Input } from "@/components/ui";
import { markDepositRequested, prepareDepositRequest } from "./deposit-actions";

/**
 * "Send deposit request" (1.4, 21 October 2026): the message carries ONLY our short payment page
 * (erp.ofjauto.com/p/…) - never the gateway's own address, so WhatsApp previews OFJ, not the bank.
 * A pasted Pay-now link is validated against the allowed pay-page domains and saved on the page;
 * replacing it later keeps the same /p/ link working.
 */
export function DepositRequestSend({ jobId, message, phoneDigits, requestedAt }: { jobId: string; message: string; phoneDigits: string; requestedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const [shortLink, setShortLink] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [host, setHost] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const full = message.replaceAll("[link]", shortLink ?? "…");

  async function openDialog() {
    setBusy(true);
    const r: { error?: string; shortLink?: string; host?: string | null } = await prepareDepositRequest(jobId).catch(() => ({ error: "Could not make the payment page." }));
    setBusy(false);
    if (r.error || !r.shortLink) {
      setLinkError(r.error ?? "Could not make the payment page.");
      return;
    }
    setShortLink(r.shortLink);
    setOpen(true);
  }

  async function saveLink() {
    setLinkError(null);
    setBusy(true);
    const r: { error?: string; shortLink?: string; host?: string | null } = await prepareDepositRequest(jobId, link).catch(() => ({ error: "Could not save the link." }));
    setBusy(false);
    if (r.error) {
      setHost(null);
      setLinkError(r.error);
      return;
    }
    setHost(r.host ?? null);
  }

  const done = async () => {
    await markDepositRequested(jobId);
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button type="button" size="md" tone={requestedAt ? "secondary" : "primary"} disabled={busy} onClick={() => void openDialog()} data-send-deposit-request>
        {busy && !open ? "…" : requestedAt ? "Send the request again" : "Send deposit request"}
      </Button>
      {linkError && !open ? <p className="text-xs font-semibold text-red">{linkError}</p> : null}
      {open ? (
        <SendLinkDialog
          title="Send the deposit request"
          message={full}
          phoneDigits={phoneDigits}
          onClose={() => setOpen(false)}
          onSent={() => void done()}
          above={
            <div className="flex flex-col gap-1" data-deposit-gateway>
              <span className="text-xs font-semibold text-muted">Pay-now link (optional): pasted here, it opens from our payment page — it never goes in the message.</span>
              <span className="flex flex-wrap items-center gap-2">
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="paste the gateway pay-page link" className="flex-1 min-w-48" data-deposit-pay-link />
                <Button type="button" size="md" tone="secondary" disabled={busy} onClick={() => void saveLink()} data-save-gateway>{busy ? "…" : "Save link"}</Button>
              </span>
              {host ? <span className="text-xs font-semibold text-green" data-gateway-ok>Pay now opens {host} ✓</span> : null}
              {linkError ? <span className="text-xs font-semibold text-red" data-gateway-error>{linkError}</span> : null}
            </div>
          }
        />
      ) : null}
    </>
  );
}
