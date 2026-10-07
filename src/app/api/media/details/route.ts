import { NextResponse, type NextRequest } from "next/server";
import { latestWheel, loadGateInFlags, loadMedia, mediaChecklist } from "@/lib/media";
import { authoriseUpload } from "@/lib/upload-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanWheelConditions, isWheelKind } from "@/lib/wheels";

/** Records the condition chosen under a wheel photo, or the note under the damage photos. */
export async function POST(request: NextRequest) {
  let body: { jobId?: string; token?: string; wheel?: { kind?: string; conditions?: string[] }; damageNote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "");
  if (!jobId) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const who = await authoriseUpload(jobId, body.token);
  if (!who) return NextResponse.json({ error: "Not allowed, or the link has expired." }, { status: 403 });

  const admin = createAdminClient();

  if (body.wheel) {
    const kind = String(body.wheel.kind ?? "");
    if (!isWheelKind(kind)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const conditions = cleanWheelConditions(Array.isArray(body.wheel.conditions) ? body.wheel.conditions.map(String) : []);
    if (conditions.length === 0) return NextResponse.json({ error: "Choose the wheel condition." }, { status: 400 });
    const row = latestWheel(await loadMedia(jobId), kind);
    if (!row) return NextResponse.json({ error: "Take the wheel photo first." }, { status: 400 });
    const { error } = await admin.from("gate_in_media").update({ wheel_condition: conditions, updated_by: who.staffId }).eq("id", row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (typeof body.damageNote === "string") {
    const note = body.damageNote.trim().slice(0, 500) || null;
    const { error } = await admin.from("gate_ins").update({ damage_note: note, updated_by: who.staffId }).eq("job_id", jobId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const checklist = mediaChecklist(await loadMedia(jobId), await loadGateInFlags(jobId));
  return NextResponse.json({ ok: true, checklist });
}
