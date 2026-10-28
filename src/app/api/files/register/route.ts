import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/app-errors";
import { reopenZoho } from "@/lib/zoho-sync";
import { isUuid } from "@/lib/uuid";
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
  if (who.roleId === "team_leader" && kind !== "bodyshop_photo") return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  // A stored file is registered once: an existing path is never signed again for someone else.
  const { data: already } = await createAdminClient().from("job_files").select("id").eq("storage_path", path).limit(1);
  if ((already ?? []).length) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  // ref_id is a uuid column: a file is tied to a payment, an LPO, a work line or a panel's own key (a uuid).
  const refId = body.refId ? String(body.refId) : null;
  if (refId && !isUuid(refId)) {
    await logAppError("file register: reference is not a uuid", new Error(`ref_id ${String(body.refId).slice(0, 80)}`), { staffId: who.staffId, jobId, detail: { kind } });
    return NextResponse.json({ error: "Couldn't attach the file – nothing was saved. Try again or tell the owner." }, { status: 400 });
  }
  const admin = createAdminClient();
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data: listed } = await admin.storage.from(JOB_FILES_BUCKET).list(folder, { search: name, limit: 1 });
  if (!listed?.some((f) => f.name === name)) return NextResponse.json({ error: "The file did not arrive. Try again." }, { status: 400 });
  const { data: row, error } = await admin
    .from("job_files")
    .insert({ job_id: jobId, kind, ref_id: refId, storage_path: path, content_type: body.contentType ? String(body.contentType).slice(0, 80) : null, caption: body.caption ? String(body.caption).slice(0, 200) : null, uploaded_by: who.staffId, created_by: who.staffId, updated_by: who.staffId })
    .select("id")
    .single();
  if (error || !row) {
    await logAppError("file register: insert", error ?? new Error("no row"), { staffId: who.staffId, jobId, detail: { kind } });
    return NextResponse.json({ error: "Couldn't attach the file – nothing was saved. Try again or tell the owner." }, { status: 500 });
  }
  // Zoho Books phase 2: a supplier-invoice scan added AFTER the bill posted attaches on the next sync run.
  if (kind === "supplier_invoice" && refId) {
    const { data: zpo } = await admin.from("purchase_orders").select("id, zoho_bill_id").eq("id", refId).maybeSingle();
    if ((zpo as { zoho_bill_id?: string | null } | null)?.zoho_bill_id) await reopenZoho("bill", refId);
  }
  const { data: signed } = await admin.storage.from(JOB_FILES_BUCKET).createSignedUrl(path, 3600);
  return NextResponse.json({ ok: true, id: row.id, path, url: signed?.signedUrl ?? null });
}
