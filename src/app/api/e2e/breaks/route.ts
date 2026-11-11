import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { autoPauseBodyshopBreaks } from "@/lib/bodyshop";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The bodyshop break pause at a given time, for the named test people only (10 November 2026, Section 7). Never in production. */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { staffIds?: string[]; now?: string };
  const staffIds = Array.isArray(body.staffIds) ? body.staffIds.map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)) : [];
  if (!staffIds.length) return NextResponse.json({ error: "Name the test people." }, { status: 400 });
  const now = body.now ? Date.parse(body.now) : Date.now();
  return NextResponse.json({ paused: await autoPauseBodyshopBreaks(await getSettings(), { now, staffIds }) });
}
