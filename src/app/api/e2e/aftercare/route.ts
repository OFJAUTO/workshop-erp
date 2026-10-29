import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { aftercareHourly } from "@/lib/aftercare";

export const dynamic = "force-dynamic";

/** The after-care reminders run for the named test jobs only (real jobs are never touched from a test). Never in production. */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { jobIds?: string[] };
  const jobIds = Array.isArray(body.jobIds) ? body.jobIds.map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)) : [];
  if (!jobIds.length) return NextResponse.json({ error: "Name the test jobs." }, { status: 400 });
  return NextResponse.json(await aftercareHourly({ jobIds }));
}
