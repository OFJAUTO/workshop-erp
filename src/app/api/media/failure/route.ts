import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { getCurrentDevice } from "@/lib/devices";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A failed upload, written down with the device, the person, the step and the error, so a photo that never
 * arrived can be explained afterwards. Best effort: the browser sends it as a beacon and never waits for it.
 */
export async function POST(request: NextRequest) {
  let body: { jobId?: string | null; inspectionId?: string | null; kind?: string; step?: string; error?: string; token?: string | null; sizeBytes?: number | null; contentType?: string | null; extra?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const kind = String(body.kind ?? "").slice(0, 60);
  const step = String(body.step ?? "").slice(0, 40);
  const error = String(body.error ?? "").slice(0, 500);
  if (!kind || !step || !error) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const admin = createAdminClient();
  const [staff, device] = await Promise.all([getCurrentStaff().catch(() => null), getCurrentDevice().catch(() => null)]);
  let jobId = body.jobId && UUID.test(body.jobId) ? body.jobId : null;
  const inspectionId = body.inspectionId && UUID.test(body.inspectionId) ? body.inspectionId : null;
  let via: string = staff ? "login" : "none";
  // A phone upload link: the upload belongs to the person who made the link.
  let staffId: string | null = staff?.id ?? null;
  if (!staff && body.token) {
    const { data: link } = await admin.from("upload_links").select("job_id, created_by").eq("token", String(body.token)).maybeSingle();
    if (link) {
      via = "link";
      staffId = (link.created_by as string | null) ?? null;
      jobId = jobId ?? (link.job_id as string);
    }
  }
  if (!jobId && inspectionId) {
    const { data: insp } = await admin.from("inspections").select("job_id").eq("id", inspectionId).maybeSingle();
    jobId = (insp?.job_id as string | null) ?? null;
  }
  const extra = body.extra && typeof body.extra === "object" ? body.extra : {};
  await admin.from("upload_failures").insert({
    job_id: jobId,
    inspection_id: inspectionId,
    kind,
    step,
    error,
    staff_id: staffId,
    via,
    device_id: device?.id ?? null,
    device_name: device?.name ?? null,
    user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
    size_bytes: typeof body.sizeBytes === "number" && Number.isFinite(body.sizeBytes) ? Math.round(body.sizeBytes) : null,
    content_type: body.contentType ? String(body.contentType).slice(0, 80) : null,
    extra: JSON.parse(JSON.stringify(extra).slice(0, 2000) || "{}"),
  });
  return NextResponse.json({ ok: true });
}
