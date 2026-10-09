import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { JOB_FILES_BUCKET } from "@/lib/work-data";
import { FILE_KINDS, authoriseJobUpload } from "../prepare/route";

/** Step 2 of an upload: once the file is stored, record it against the job. */
export async function POST(request: NextRequest) {
  let body: { jobId?: string; path?: string; kind?: string; refId?: string | null; caption?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "");
  const path = String(body.path ?? "");
  const kind = String(body.kind ?? "");
  if (!jobId || !path.startsWith(`${jobId}/`) || !FILE_KINDS.includes(kind)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const who = await authoriseJobUpload(jobId);
  if (!who) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const admin = createAdminClient();
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed } = await admin.storage.from(JOB_FILES_BUCKET).list(folder, { search: name, limit: 1 });
  if (!listed?.some((f) => f.name === name)) return NextResponse.json({ error: "The file did not arrive. Try again." }, { status: 400 });
  const { data: row, error } = await admin
    .from("job_files")
    .insert({ job_id: jobId, kind, ref_id: body.refId ? String(body.refId) : null, storage_path: path, content_type: body.contentType ? String(body.contentType).slice(0, 80) : null, caption: body.caption ? String(body.caption).slice(0, 200) : null, uploaded_by: who.staffId, created_by: who.staffId, updated_by: who.staffId })
    .select("id")
    .single();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "Could not record the file." }, { status: 500 });
  const { data: signed } = await admin.storage.from(JOB_FILES_BUCKET).createSignedUrl(path, 3600);
  return NextResponse.json({ ok: true, id: row.id, path, url: signed?.signedUrl ?? null });
}
