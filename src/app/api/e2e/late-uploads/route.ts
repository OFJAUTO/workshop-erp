import { e2eRefused } from "@/lib/e2e-guard";
import { NextResponse, type NextRequest } from "next/server";
import { alertLateUploads } from "@/lib/upload-pending";

export const dynamic = "force-dynamic";

/** The 15-minute late-upload alert, for the named test jobs only (real cars are never told from a test). Never in production. */
export async function POST(request: NextRequest) {
  if (e2eRefused(request)) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { jobIds?: string[] };
  const jobIds = Array.isArray(body.jobIds) ? body.jobIds.map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)) : [];
  if (!jobIds.length) return NextResponse.json({ error: "Name the test jobs." }, { status: 400 });
  return NextResponse.json({ told: await alertLateUploads(Date.now(), { jobIds }) });
}
