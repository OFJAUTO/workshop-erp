import { NextResponse, type NextRequest } from "next/server";
import { checkLateJobs, recordJobRun } from "@/lib/background-jobs";
import { drainZohoOutbox } from "@/lib/zoho-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Every five minutes (Vercel cron): the Zoho outbox is drained — customers, deposits, tax invoices and payments
 * post to the organization zohoWriteOrg() names (OFJ TEST until go-live). Protected by CRON_SECRET, and the answer
 * is COUNTS ONLY: no Zoho data ever comes back through this route.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    const r = await drainZohoOutbox();
    const words = r.skipped ?? `${r.pushed} posted · ${r.failed} failed · ${r.waiting} waiting`;
    await recordJobRun("zoho", true, words).catch(() => null);
    await checkLateJobs(true).catch(() => null);
    return NextResponse.json({ ok: true, pushed: r.pushed, failed: r.failed, waiting: r.waiting });
  } catch (e) {
    await recordJobRun("zoho", false, `Problem: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`).catch(() => null);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
