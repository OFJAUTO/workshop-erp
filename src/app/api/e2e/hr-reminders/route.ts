import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { hrRemindersHourly } from "@/lib/hr";

export const dynamic = "force-dynamic";

/** The HR document reminders now (Section 15 test). Never in production. */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) return NextResponse.json({ error: "Not available." }, { status: 404 });
  return NextResponse.json({ sent: await hrRemindersHourly() });
}
