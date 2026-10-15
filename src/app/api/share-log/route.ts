import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** "PDF shared" on the job's history: who shared which document, from the share sheet or as a download. */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; kind?: string; fileName?: string; how?: string };
  if (!body.jobId || !/^[0-9a-f-]{36}$/i.test(body.jobId)) return NextResponse.json({ error: "No job" }, { status: 400 });
  const fileName = String(body.fileName ?? "PDF").slice(0, 120);
  const how = body.how === "downloaded" ? "downloaded to share" : "shared";
  await createAdminClient().from("job_events").insert({ job_id: body.jobId, event_type: "pdf_shared", note: `PDF ${how}: ${fileName} by ${staff.display_name}`, created_by: staff.id });
  return NextResponse.json({ ok: true });
}
