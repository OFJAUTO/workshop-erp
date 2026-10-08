import { NextResponse, type NextRequest } from "next/server";
import { INSPECTION_BUCKET } from "@/lib/inspection-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseInspectionUpload } from "../prepare/route";

/** Step 2 of an upload: once the file is stored, record it against the inspection. */
export async function POST(request: NextRequest) {
  let body: { inspectionId?: string; path?: string; kind?: string; itemKey?: string | null; requestId?: string | null; isPrescan?: boolean; duration?: number; caption?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const inspectionId = String(body.inspectionId ?? "");
  const path = String(body.path ?? "");
  const kind = String(body.kind ?? "");
  if (!inspectionId || !path.startsWith(`${inspectionId}/`) || !["photo", "video", "pdf"].includes(kind)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const who = await authoriseInspectionUpload(inspectionId);
  if (!who) return NextResponse.json({ error: "Not allowed, or the report is locked." }, { status: 403 });

  const admin = createAdminClient();
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed } = await admin.storage.from(INSPECTION_BUCKET).list(folder, { search: name, limit: 1 });
  if (!listed?.some((f) => f.name === name)) return NextResponse.json({ error: "The file did not arrive. Try again." }, { status: 400 });

  const { data: row, error } = await admin
    .from("inspection_media")
    .insert({
      inspection_id: inspectionId,
      item_key: body.itemKey ? String(body.itemKey) : null,
      job_request_id: body.requestId ? String(body.requestId) : null,
      kind,
      is_prescan: !!body.isPrescan && kind === "pdf",
      storage_path: path,
      caption: body.caption ? String(body.caption).slice(0, 200) : null,
      duration_s: body.duration ? Math.round(Number(body.duration)) : null,
      uploaded_by: who.staffId,
      created_by: who.staffId,
      updated_by: who.staffId,
    })
    .select("id")
    .single();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "Could not record the file." }, { status: 500 });
  const { data: signed } = await admin.storage.from(INSPECTION_BUCKET).createSignedUrl(path, 3600);
  return NextResponse.json({ ok: true, id: row.id, url: signed?.signedUrl ?? null });
}
