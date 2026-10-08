import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { INSPECTION_BUCKET, inspectionLocked } from "@/lib/inspection-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf" };

/**
 * Who may add files to an inspection: the assigned technician, a workshop manager or the owner, while
 * the report is open. The pre-scan PDF may still be attached while the report is with the manager.
 */
export async function authoriseInspectionUpload(inspectionId: string, contentType?: string) {
  const staff = await getCurrentStaff();
  if (!staff) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("inspections").select("id, technician_id, status, unlocked_until").eq("id", inspectionId).maybeSingle();
  if (!data) return null;
  const role = staff.role_id as RoleId;
  const allowed = (role === "technician" && data.technician_id === staff.id) || can(role, "approveInspections") || role === "service_advisor" || role === "qc_inspector";
  if (!allowed) return null;
  if (data.status === "submitted" && role === "technician" && contentType !== "application/pdf") return null;
  if (inspectionLocked(data)) return null;
  return { staffId: staff.id, inspectionId: data.id as string };
}

/** Step 1 of an upload: a one-time address for the file. */
export async function POST(request: NextRequest) {
  let body: { inspectionId?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const contentType = String(body.contentType ?? "").split(";")[0].trim();
  if (!EXT[contentType]) return NextResponse.json({ error: "That file type is not accepted. Use a photo, a video or a PDF." }, { status: 400 });
  const who = await authoriseInspectionUpload(String(body.inspectionId ?? ""), contentType);
  if (!who) return NextResponse.json({ error: "Not allowed, or the report is locked." }, { status: 403 });
  const path = `${who.inspectionId}/${Date.now()}-${randomBytes(3).toString("hex")}.${EXT[contentType]}`;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(INSPECTION_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });
  return NextResponse.json({ path: data.path, url: data.signedUrl });
}
