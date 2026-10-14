import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseInspectionUpload } from "../prepare/route";

/** The X on a thumbnail: the photo or video is marked removed (never deleted) and leaves the report and the customer's link. */
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
  const who = await authoriseInspectionUpload(inspectionId);
  if (!who) return NextResponse.json({ error: "Not allowed, or the report is locked." }, { status: 403 });
  const staff = await getCurrentStaff();
  const admin = createAdminClient();
  const { error } = await admin.from("inspection_media").update({ removed_at: new Date().toISOString(), removed_by: staff?.id ?? null, updated_by: staff?.id ?? null }).eq("id", id).eq("inspection_id", inspectionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
