import { NextResponse, type NextRequest } from "next/server";
import { logAppError } from "@/lib/app-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { inspectionTarget } from "@/lib/upload-targets/inspection";
import { isRefusal } from "@/lib/upload-targets/common";

const TYPE_OF_KIND: Record<string, string> = { photo: "image/jpeg", video: "video/mp4", pdf: "application/pdf" };

/**
 * The X on a thumbnail: the photo or video is marked removed (never deleted) and leaves the report and the customer's link.
 * The same people may take a file off as may add one there (31 October 2026: the owner's direct edit, the bodyshop
 * findings after approval and the road-test photos included - it follows the inspection place's own rule).
 */
export async function POST(request: NextRequest) {
  let body: { inspectionId?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const inspectionId = String(body.inspectionId ?? "");
  const id = String(body.id ?? "");
  if (!inspectionId || !id) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("inspection_media").select("id, item_key, kind").eq("id", id).eq("inspection_id", inspectionId).maybeSingle();
  if (!row) return NextResponse.json({ error: "That file is no longer on the report." }, { status: 404 });
  const who = await inspectionTarget.authorise(inspectionId, { itemKey: row.item_key }, TYPE_OF_KIND[String(row.kind)] ?? null);
  if (isRefusal(who)) return NextResponse.json({ error: who.error }, { status: who.status });
  const { error } = await admin.from("inspection_media").update({ removed_at: new Date().toISOString(), removed_by: who.staffId, updated_by: who.staffId }).eq("id", id).eq("inspection_id", inspectionId);
  if (error) {
    await logAppError("inspection media remove", error, { staffId: who.staffId, detail: { inspectionId, id } });
    return NextResponse.json({ error: "Couldn't take the file off – try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
