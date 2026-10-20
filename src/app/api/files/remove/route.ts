import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

/** The X on a job file's thumbnail: the file is marked removed (never deleted). The uploader, the owner, accounts or Parts may remove. */
export async function POST(request: NextRequest) {
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const admin = createAdminClient();
  const { data: file } = await admin.from("job_files").select("id, uploaded_by").eq("id", id).maybeSingle();
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
  const role = staff.role_id as RoleId;
  const allowed = file.uploaded_by === staff.id || role === "owner" || role === "accounts" || can(role, "managePurchaseOrders");
  if (!allowed) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const { error } = await admin.from("job_files").update({ removed_at: new Date().toISOString(), removed_by: staff.id, updated_by: staff.id }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
