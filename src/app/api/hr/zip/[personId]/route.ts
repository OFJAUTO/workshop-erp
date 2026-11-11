import { NextResponse } from "next/server";
import { zipSync } from "fflate";
import { HR_BUCKET, HR_DOC_LABELS, hrActor, logHr } from "@/lib/hr";
import { hrFileName } from "@/lib/hr-rules";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Download all documents" (11 November 2026, Section 15): one zip of the person's current documents, logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const by = await hrActor();
  if (!by) return new NextResponse("Not allowed.", { status: 403 });
  const { personId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return new NextResponse("Not found.", { status: 404 });
  const admin = createAdminClient();
  const { data: p } = await admin.from("hr_people").select("passport_name").eq("id", personId).eq("is_active", true).maybeSingle();
  if (!p) return new NextResponse("Not found.", { status: 404 });
  const { data: docs } = await admin.from("hr_documents").select("id, kind, storage_path, file_name, content_type").eq("person_id", personId).eq("is_active", true).is("replaced_at", null);
  const files: Record<string, Uint8Array> = {};
  for (const d of (docs ?? []) as { id: string; kind: string; storage_path: string; file_name: string | null; content_type: string | null }[]) {
    const { data: blob } = await admin.storage.from(HR_BUCKET).download(d.storage_path);
    if (!blob) continue;
    let name = hrFileName(HR_DOC_LABELS[d.kind] ?? "Document", p.passport_name as string, d.file_name, d.content_type);
    for (let n = 2; files[name]; n++) name = name.replace(/(\.[a-z0-9]+)?$/i, ` (${n})$1`);
    files[name] = new Uint8Array(await blob.arrayBuffer());
  }
  if (!Object.keys(files).length) return new NextResponse("No documents uploaded yet.", { status: 404 });
  await logHr(by.id, "downloaded_all", { personId, detail: `${Object.keys(files).length} documents` });
  const zip = zipSync(files, { level: 0 });
  const safe = String(p.passport_name).replace(/[^\w .-]+/g, " ").trim().toUpperCase() || "PERSON";
  return new NextResponse(Buffer.from(zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="HR ${safe}.zip"`, "Cache-Control": "no-store" } });
}
