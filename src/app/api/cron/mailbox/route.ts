import { NextResponse, type NextRequest } from "next/server";
import { checkLateJobs, recordJobRun } from "@/lib/background-jobs";
import { checkScansMailbox } from "@/lib/mailbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Every five minutes (Vercel cron): the scans mailbox is read and new reports filed. Protected by CRON_SECRET. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const result = await checkScansMailbox();
  // Recorded for Settings > Background jobs (23 October 2026); the hourly job's lateness is checked here too.
  await recordJobRun("mailbox", result.ok, result.ok ? `${result.checked} new · ${result.stored} report${result.stored === 1 ? "" : "s"} filed` : `Problem: ${result.error ?? "unknown"}`).catch(() => null);
  await checkLateJobs(true).catch(() => null);
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
