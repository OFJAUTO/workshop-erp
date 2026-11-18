import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { approvalsDailyReminder } from "@/lib/approval-reminders";

export const dynamic = "force-dynamic";

/** The owner's daily approvals reminder, run once on the test server (forced past its once-a-day rule). Never in production. */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) return NextResponse.json({ error: "Not available." }, { status: 404 });
  return NextResponse.json({ result: await approvalsDailyReminder(Date.now(), { force: true }) });
}
