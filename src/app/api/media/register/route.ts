import { NextResponse, type NextRequest } from "next/server";
import { GATE_IN_BUCKET, loadMedia, mediaChecklist } from "@/lib/media";
import { authoriseUpload } from "@/lib/upload-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Step 2 of an upload: once the file is stored, record it against the job. */
export async function POST(request: NextRequest) {
  let body: { jobId?: string; kind?: string; path?: string; duration?: number; caption?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "");
  const kind = String(body.kind ?? "");
  const path = String(body.path ?? "");
  if (!jobId || !kind || !path.startsWith(`${jobId}/`)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const who = await authoriseUpload(jobId, body.token);
  if (!who) return NextResponse.json({ error: "Not allowed, or the link has expired." }, { status: 403 });

  const admin = createAdminClient();
  // Make sure the file really exists before recording it.
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed } = await admin.storage.from(GATE_IN_BUCKET).list(folder, { search: name, limit: 1 });
  if (!listed?.some((f) => f.name === name)) {
    return NextResponse.json({ error: "The file did not arrive. Try again." }, { status: 400 });
  }

  const { error } = await admin.from("gate_in_media").insert({
    job_id: jobId,
    kind,
    storage_path: path,
    duration_s: body.duration ? Math.round(Number(body.duration)) : null,
    caption: body.caption ? String(body.caption).slice(0, 200) : null,
    uploaded_by: who.staffId,
    created_by: who.staffId,
    updated_by: who.staffId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const checklist = mediaChecklist(await loadMedia(jobId));
  return NextResponse.json({ ok: true, checklist });
}
