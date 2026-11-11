import { NextResponse, type NextRequest } from "next/server";
import { HR_BUCKET, HR_DOC_LABELS, hrActor, logHr } from "@/lib/hr";
import { hrFileName } from "@/lib/hr-rules";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * One HR document (11 November 2026, Section 15): checked, logged, then a private link that works for 60 seconds.
 * `?download=1` saves it instead of opening it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const by = await hrActor();
  if (!by) return new NextResponse("Not allowed.", { status: 403 });
  const { docId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(docId)) return new NextResponse("Not found.", { status: 404 });
  const admin = createAdminClient();
  const { data: d } = await admin.from("hr_documents").select("id, person_id, kind, storage_path, file_name, content_type").eq("id", docId).eq("is_active", true).maybeSingle();
  if (!d) return new NextResponse("Not found.", { status: 404 });
  const { data: p } = await admin.from("hr_people").select("passport_name").eq("id", d.person_id).maybeSingle();
  const download = request.nextUrl.searchParams.get("download") === "1";
  await logHr(by.id, download ? "downloaded" : "viewed", { personId: d.person_id as string, documentId: docId, detail: HR_DOC_LABELS[d.kind as string] ?? null });
  const name = hrFileName(HR_DOC_LABELS[d.kind as string] ?? "Document", (p?.passport_name as string | undefined) ?? "", d.file_name as string | null, d.content_type as string | null);
  const { data: signed, error } = await admin.storage.from(HR_BUCKET).createSignedUrl(d.storage_path as string, 60, download ? { download: name } : undefined);
  if (error || !signed?.signedUrl) return new NextResponse("Couldn't open the file. Try again.", { status: 503 });
  return NextResponse.redirect(signed.signedUrl, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
