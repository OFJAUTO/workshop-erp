"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { orderEstimatePartsNowAction } from "../money-actions";

/**
 * Part 4 (4 November 2026): ORDER PARTS NOW on an accepted estimate. One tap sends the priced parts
 * for LPO approval on a held job (opened at gate-in); with no advance received the owner sees the
 * warning at approval and may approve anyway.
 */
export function OrderPartsNow({ estimateId, pricedCount }: { estimateId: string; pricedCount: number }) {
  const router = useRouter();
  const [words, setWords] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const go = () => start(async () => {
    setError(null);
    const r = await orderEstimatePartsNowAction(estimateId);
    if (r.error) { setError(r.error); return; }
    setWords(r.words ?? "Sent for approval.");
    setJobId(r.jobId ?? null);
    router.refresh();
  });
  if (words) {
    return (
      <p className="basis-full rounded-control border-2 border-green bg-green-soft px-3 py-2 text-sm font-semibold" data-order-parts-done>
        {words}{jobId ? <> <a className="underline underline-offset-4" href={`/parts/${jobId}`} data-order-parts-open>Open the parts page</a></> : null}
      </p>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" tone="secondary" size="md" disabled={busy} onClick={go} data-order-parts-now>
        {busy ? "Sending…" : `Order parts now (${pricedCount} priced)`}
      </Button>
      {error ? <span className="text-xs font-semibold text-red" data-order-parts-error>{error}</span> : null}
    </span>
  );
}
