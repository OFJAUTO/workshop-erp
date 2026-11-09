"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { MessageSendButton } from "@/components/MessageSendButton";
import { reloadIfStale } from "@/lib/app-version";
import { REDUCED_MARK } from "@/lib/qty-after-approval-rules";
import { keepPriceAction, reduceAfterApprovalAction } from "@/app/(app)/parts/qty-actions";

/**
 * Section 1 of 9 November 2026: fewer parts used than the customer approved. ONE card on the approved quotation:
 * "Reduce the customer's price to match" (the default) makes the next version, approved at once and marked
 * "Reduced after approval – no customer approval needed", then offers the WhatsApp message (information only).
 * "Keep the old price" needs the owner with a reason (an advisor asks him from here).
 */
export function QtyReduceCard({ jobId, quotationId, lines, isOwner, viewOnly }: { jobId: string; quotationId: string; lines: { lineId: string; words: string; asked: boolean }[]; isOwner: boolean; viewOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ words: string; message?: string; phoneDigits?: string; overpaid?: string | null; newId?: string; draft?: boolean } | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [reason, setReason] = useState("");
  const [kept, setKept] = useState<string | null>(null);
  const asked = lines.every((l) => l.asked);

  async function reduce() {
    setBusy(true);
    setError(null);
    try {
      const r = await reduceAfterApprovalAction(jobId, quotationId);
      setBusy(false);
      if (r.error || !r.ok) { setError(r.error ?? "Not saved. Try again."); return; }
      setDone({ words: r.words ?? "Reduced.", message: r.message, phoneDigits: r.phoneDigits, overpaid: r.overpaid, newId: r.newId, draft: r.draft });
    } catch (e) {
      setBusy(false);
      if (!reloadIfStale(e)) setError("Not saved: no connection. Try again.");
    }
  }
  async function keep() {
    setBusy(true);
    setError(null);
    try {
      const r = await keepPriceAction(jobId, quotationId, reason);
      setBusy(false);
      if (r.error || !r.ok) { setError(r.error ?? "Not saved. Try again."); return; }
      setKept(r.asked ? "The owner is asked to keep the approved price." : "The approved price is kept (written on the quotation).");
    } catch (e) {
      setBusy(false);
      if (!reloadIfStale(e)) setError("Not saved: no connection. Try again.");
    }
  }

  return (
    <div id="qty-reduce" className="flex flex-col gap-2 rounded-control border-2 border-amber-bar bg-amber-soft/40 p-4" data-qty-reduce>
      <span className="font-extrabold">Fewer parts used than the customer approved</span>
      <ul className="flex flex-col gap-1 text-sm">
        {lines.map((l) => <li key={l.lineId} data-qty-reduce-line>{l.words}</li>)}
      </ul>
      {done ? (
        <div className="flex flex-col gap-2">
          <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-qty-reduced>{done.words}</p>
          {done.overpaid ? <p className="text-sm font-semibold text-amber-text" data-qty-overpaid>{done.overpaid}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            {done.message ? <MessageSendButton label="Send to the customer (information)" title="Updated quotation – for information" message={done.message} phoneDigits={done.phoneDigits ?? ""} what="the reduced quotation (no approval needed)" target={{ jobId }} hook="qty-reduce-send" /> : null}
            {done.newId ? <Button type="button" size="md" tone="secondary" onClick={() => router.push(`/jobs/${jobId}/quote/${done.newId}`)} data-qty-open-new>Open the {done.draft ? "new version" : "reduced version"}</Button> : null}
          </div>
        </div>
      ) : kept ? (
        <p className="rounded-control border border-line bg-white px-3 py-2 text-sm font-bold" data-qty-kept>{kept}</p>
      ) : viewOnly ? (
        <p className="text-xs text-muted">View as is read-only.</p>
      ) : (
        <>
          <p className="text-xs text-muted">The default is to lower the customer&apos;s price: a new version marked &quot;{REDUCED_MARK}&quot;, sent to the customer for information.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="md" disabled={busy} onClick={() => void reduce()} data-qty-reduce-go>{busy && !keeping ? "Reducing…" : "Reduce the customer's price to match"}</Button>
            {!keeping ? <Button type="button" size="md" tone="ghost" disabled={busy || (!isOwner && asked)} onClick={() => setKeeping(true)} data-qty-keep-open>{!isOwner && asked ? "Owner asked to keep the price" : "Keep the old price…"}</Button> : null}
          </div>
          {keeping ? (
            <div className="flex flex-col gap-2 rounded-control border border-line bg-white p-3" data-qty-keep>
              <span className="text-sm font-bold">{isOwner ? "Keep the approved price: why?" : "Keeping the approved price needs the owner. Why?"}</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="rounded-control border border-line-strong px-3 py-2 text-sm" placeholder="The reason (at least 5 characters)" data-spell="" data-qty-keep-reason />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="md" disabled={busy || reason.trim().length < 5} onClick={() => void keep()} data-qty-keep-save>{isOwner ? "Keep the price" : "Ask the owner"}</Button>
                <Button type="button" size="md" tone="ghost" disabled={busy} onClick={() => setKeeping(false)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {error ? <p className="text-sm font-semibold text-red" data-qty-reduce-error>{error}</p> : null}
    </div>
  );
}
