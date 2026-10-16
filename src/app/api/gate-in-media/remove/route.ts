import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { MEDIA_KIND_LABELS } from "@/lib/media";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The X on a gate-in photo or video: the row is marked removed (never deleted) and leaves the job card, the
 * checklist and the customer's link. Anyone who does gate-ins may remove while the gate-in is still open; once it
 * is finished only the owner can, and every removal is written in the job's history.
 */
export async function POST(request: NextRequest) {
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "editGateIn")) return NextResponse.json({ error: "Your role can't remove gate-in photos." }, { status: 403 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("gate_in_media").select("id, job_id, kind, removed_at").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (row.removed_at) return NextResponse.json({ ok: true });
  const [{ data: gi }, { data: job }] = await Promise.all([
    admin.from("gate_ins").select("is_complete").eq("job_id", row.job_id).maybeSingle(),
    admin.from("jobs").select("is_open").eq("id", row.job_id).maybeSingle(),
  ]);
  if (!job?.is_open) return NextResponse.json({ error: "This job is closed." }, { status: 403 });
  if (gi?.is_complete && staff.role_id !== "owner") return NextResponse.json({ error: "The gate-in is finished: only the owner can remove a photo or video now." }, { status: 403 });
  const { error } = await admin.from("gate_in_media").update({ removed_at: new Date().toISOString(), removed_by: staff.id, updated_by: staff.id }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const label = MEDIA_KIND_LABELS[row.kind as keyof typeof MEDIA_KIND_LABELS] ?? row.kind;
  await admin.from("job_events").insert({ job_id: row.job_id, event_type: "amendment", note: `Gate-in ${/video/.test(row.kind) ? "video" : "photo"} removed: ${label}`, created_by: staff.id });
  revalidatePath(`/jobs/${row.job_id}`);
  revalidatePath(`/jobs/${row.job_id}/media`);
  return NextResponse.json({ ok: true });
}
