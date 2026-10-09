import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { JOB_FILES_BUCKET } from "@/lib/work-data";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf" };
export const FILE_KINDS = ["work_photo", "additional_work", "wash_photo", "gate_out_photo", "delivery_photo", "handover_photo", "supplier_invoice", "qc_postscan", "return_photo"];

/** Any signed-in member of staff may add a file to an open job (photos of work, a wash, a delivery, a supplier invoice). */
export async function authoriseJobUpload(jobId: string) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return null;
  const { data } = await createAdminClient().from("jobs").select("id, is_open").eq("id", jobId).maybeSingle();
  if (!data) return null;
  return { staffId: staff.id, jobId: data.id as string };
}

/** Step 1 of an upload: a one-time address for the file. */
export async function POST(request: NextRequest) {
  let body: { jobId?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const contentType = String(body.contentType ?? "").split(";")[0].trim();
  if (!EXT[contentType]) return NextResponse.json({ error: "That file type is not accepted. Use a photo, a short video or a PDF." }, { status: 400 });
  const who = await authoriseJobUpload(String(body.jobId ?? ""));
  if (!who) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const path = `${who.jobId}/${Date.now()}-${randomBytes(3).toString("hex")}.${EXT[contentType]}`;
  const { data, error } = await createAdminClient().storage.from(JOB_FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });
  return NextResponse.json({ path: data.path, url: data.signedUrl });
}
