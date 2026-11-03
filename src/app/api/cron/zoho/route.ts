import { NextResponse, type NextRequest } from "next/server";
import { checkLateJobs, recordJobRun } from "@/lib/background-jobs";
import { reconcileDay } from "@/lib/zoho-reconcile";
import { zohoCronTick } from "@/lib/zoho-manual";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DRAIN_LIMIT = 25;

/**
 * Every five minutes (Vercel cron). Since 3 November 2026 the sync to Zoho is MANUAL by default: this run then sends
 * nothing — it counts what waits for Sync to Zoho and keeps the read-only reconciliation (every recent day that is due,
 * not only yesterday: a day held back until its documents were sent is compared once they went). Only while the
 * owner switched the sync to automatic does it send (customers, deposits, tax invoices, payments, bills… to the
 * organization the go-live switch names, 25 at a time). It records every run, so the job is never "late" on manual.
 * Protected by CRON_SECRET, and the answer is COUNTS ONLY: no Zoho data ever comes back through this route.
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
    const r = await zohoCronTick(DRAIN_LIMIT);
    await recordJobRun("zoho", true, r.words).catch(() => null);
    await checkLateJobs(true).catch(() => null);
    // Every recent day compared on this run (oldest first); "reconciled" stays the latest one, as before.
    const last = r.recon[r.recon.length - 1];
    return NextResponse.json({ ok: true, pushed: r.pushed, failed: r.failed, waiting: r.waiting, ...(last ? { reconciled: last.day, reconciliation: last.status, reconciledDays: r.recon } : {}) });
  } catch (e) {
    await recordJobRun("zoho", false, `Problem: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`).catch(() => null);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
