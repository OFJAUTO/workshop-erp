import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { canEditBody, cleanFinding, isBodyshopAssessor, isBodyshopStaff, loadBodyState, notifyBodyshopAssessment } from "@/lib/bodyshop-findings";
import { panelLabel } from "@/lib/car-outline";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The bodyshop findings of an inspection, saved as they are tapped: open the section, save or remove one panel's
 * finding, answer the accident questions, and (bodyshop staff, the owner) mark the assessment checked.
 * Every answer comes back as the whole bodyshop state.
 */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Please log in again." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { inspectionId?: string; op?: string; finding?: Record<string, unknown>; panel?: string; airbags?: boolean | null; structural?: boolean | null };
  const admin = createAdminClient();
  const { data: insp } = await admin.from("inspections").select("id, job_id, status, bodyshop_opened_at, bodyshop_checked_at").eq("id", String(body.inspectionId ?? "")).maybeSingle();
  if (!insp) return NextResponse.json({ error: "Inspection not found." }, { status: 404 });
  const s = { id: staff.id, role_id: staff.role_id, department_id: (staff as { department_id?: string | null }).department_id ?? null, viewingAs: staff.viewingAs };
  if (!(await canEditBody(s, insp))) return NextResponse.json({ error: insp.bodyshop_checked_at ? "The bodyshop manager has checked these findings: only bodyshop staff or the owner change them now." : "Not allowed." }, { status: 403 });
  const now = new Date().toISOString();
  const stamp = { updated_by: staff.id };

  if (body.op === "open") {
    if (!insp.bodyshop_opened_at) await admin.from("inspections").update({ bodyshop_opened_at: now, bodyshop_opened_by: staff.id, ...stamp }).eq("id", insp.id);
  } else if (body.op === "save" && body.finding) {
    const f = cleanFinding(body.finding);
    if ("error" in f) return NextResponse.json({ error: f.error }, { status: 400 });
    const { data: existing } = await admin.from("bodyshop_findings").select("id").eq("inspection_id", insp.id).eq("panel", f.panel).eq("is_active", true).maybeSingle();
    if (existing) await admin.from("bodyshop_findings").update({ ...f, ...stamp }).eq("id", existing.id);
    else {
      const { count } = await admin.from("bodyshop_findings").select("id", { count: "exact", head: true }).eq("inspection_id", insp.id).eq("is_active", true);
      const { error } = await admin.from("bodyshop_findings").insert({ ...f, inspection_id: insp.id, job_id: insp.job_id, position: count ?? 0, created_by: staff.id, ...stamp });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!insp.bodyshop_opened_at) await admin.from("inspections").update({ bodyshop_opened_at: now, bodyshop_opened_by: staff.id, ...stamp }).eq("id", insp.id);
    // The bodyshop manager hears about the first finding (once), unless the bodyshop is already on it.
    if (!isBodyshopStaff(s) || staff.role_id === "owner") await notifyBodyshopAssessment(insp.id, insp.job_id, staff.display_name);
  } else if (body.op === "remove" && body.panel) {
    await admin.from("bodyshop_findings").update({ is_active: false, ...stamp }).eq("inspection_id", insp.id).eq("panel", String(body.panel)).eq("is_active", true);
    await admin.from("job_events").insert({ job_id: insp.job_id, event_type: "bodyshop_finding_removed", note: `Bodyshop finding on the ${panelLabel(String(body.panel)).toLowerCase()} removed by ${staff.display_name}`, created_by: staff.id });
  } else if (body.op === "accident") {
    const patch: Record<string, unknown> = { ...stamp };
    if ("airbags" in body) patch.airbags_deployed = body.airbags === null ? null : !!body.airbags;
    if ("structural" in body) patch.structural_damage = body.structural === null ? null : !!body.structural;
    await admin.from("inspections").update(patch).eq("id", insp.id);
    if (body.structural === true) await admin.from("job_events").insert({ job_id: insp.job_id, event_type: "bodyshop_assessment", note: `Structural / chassis damage suspected by ${staff.display_name}: chassis measurement needed`, created_by: staff.id });
  } else if (body.op === "checked") {
    if (!isBodyshopAssessor(s)) return NextResponse.json({ error: "Only the bodyshop manager or the owner mark the assessment checked." }, { status: 403 });
    await admin.from("inspections").update({ bodyshop_checked_at: now, bodyshop_checked_by: staff.id, ...stamp }).eq("id", insp.id);
    await admin.from("job_events").insert({ job_id: insp.job_id, event_type: "bodyshop_assessment", note: `Bodyshop findings checked by ${staff.display_name}`, created_by: staff.id });
  } else return NextResponse.json({ error: "Bad request." }, { status: 400 });

  return NextResponse.json({ ok: true, state: await loadBodyState(insp.id) });
}
