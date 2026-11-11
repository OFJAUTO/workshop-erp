import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { passwordSummaryDaily } from "@/lib/password-alerts";

export const dynamic = "force-dynamic";

/** The evening password sign-in summary at a chosen moment (Section 14 test). Never in production. */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { nowMs?: number };
  const nowMs = Number(body.nowMs) || Date.now();
  return NextResponse.json({ counted: await passwordSummaryDaily(nowMs) });
}
