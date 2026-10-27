import { NextResponse, type NextRequest } from "next/server";
import { checkLateJobs, recordJobRun } from "@/lib/background-jobs";
import { reconcileDay, reconcileYesterdayIfDue } from "@/lib/zoho-reconcile";
import { drainZohoOutbox } from "@/lib/zoho-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DRAIN_LIMIT = 25;

/**
 * Every five minutes (Vercel cron): the Zoho outbox is drained — customers, deposits, tax invoices and payments
 * post to the organization the go-live switch names (OFJ TEST until go-live). Protected by CRON_SECRET, and the
 * answer is COUNTS ONLY: no Zoho data ever comes back through this route.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  // A named day re-runs just that day's reconciliation, against the book that owns the day (counts only).
  const reconcile = request.nextUrl.searchParams.get("reconcile");
  if (reconcile && /^\d{4}-\d{2}-\d{2}$/.test(reconcile)) {
    try {
      const { status } = await reconcileDay(reconcile);
      return NextResponse.json({ ok: true, day: reconcile, status });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e instanceof Error ? e.message : "failed").slice(0, 200) }, { status: 503 });
    }
  }
  try {
    const r = await drainZohoOutbox(DRAIN_LIMIT);
    // Yesterday's books are checked once the queue has caught up (its own catch: a Zoho hiccup never kills the drain's record).
    const recon = await reconcileYesterdayIfDue({ drainSaturated: r.pushed + r.failed + r.waiting >= DRAIN_LIMIT });
    const words = (r.skipped ?? `${r.pushed} posted · ${r.failed} failed · ${r.waiting} waiting`) + (recon ? ` · reconciled ${recon.day}: ${recon.status}` : "");
    await recordJobRun("zoho", true, words).catch(() => null);
    await checkLateJobs(true).catch(() => null);
    return NextResponse.json({ ok: true, pushed: r.pushed, failed: r.failed, waiting: r.waiting, ...(recon ? { reconciled: recon.day, reconciliation: recon.status } : {}) });
  } catch (e) {
    await recordJobRun("zoho", false, `Problem: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`).catch(() => null);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
