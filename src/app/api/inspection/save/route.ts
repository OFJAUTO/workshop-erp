import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { ITEM_STATUSES, cleanMeasurementValue } from "@/lib/inspection";
import { inspectionLocked, type InspectionRow } from "@/lib/inspection-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

type Body = {
  // kept for the shape below
  inspectionId?: string;
  item?: { key: string; status?: string | null; remarks?: string; parts_needed?: string; labour_hours?: string | number | null };
  sectionAllGood?: string;
  finding?: { requestId: string; found?: string; needs?: string; status?: string | null };
  measurements?: Record<string, string>;
  technicianNotes?: string;
  prescanVisible?: boolean;
};

/** Saves one piece of the inspection report as the technician taps. Every change is kept at once. */
export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Please log in again." }, { status: 401 });
  const role = staff.role_id as RoleId;
  const admin = createAdminClient();
  const { data } = await admin.from("inspections").select("id, job_id, technician_id, status, unlocked_until, measurements, measurements_original").eq("id", String(body.inspectionId ?? "")).maybeSingle();
  if (!data) return NextResponse.json({ error: "Inspection not found." }, { status: 404 });
  const insp = data as unknown as Pick<InspectionRow, "id" | "job_id" | "technician_id" | "status" | "unlocked_until" | "measurements" | "measurements_original">;

  const isTech = role === "technician" && insp.technician_id === staff.id;
  const isManager = can(role, "approveInspections");
  if (body.prescanVisible !== undefined) {
    if (!(isManager || role === "service_advisor" || isTech)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    await admin.from("inspections").update({ show_prescan_to_customer: !!body.prescanVisible, updated_by: staff.id }).eq("id", insp.id);
    return NextResponse.json({ ok: true });
  }
  if (!isTech && !isManager) return NextResponse.json({ error: "Only the assigned technician can fill in this report." }, { status: 403 });
  if (insp.status === "submitted" && !isManager) return NextResponse.json({ error: "The report is with the workshop manager. It can be changed if it is sent back." }, { status: 423 });
  // A manager editing during review: stamp the change and keep the technician's original.
  const reviewing = isManager && insp.status === "submitted";
  const reviewStamp = reviewing ? { edited_by: staff.id, edited_at: new Date().toISOString() } : {};
  if (inspectionLocked(insp)) return NextResponse.json({ error: "This report is approved and locked. Ask the owner to approve a change first." }, { status: 423 });

  const stamp = { updated_by: staff.id };
  if (body.item) {
    const status = body.item.status ? String(body.item.status) : null;
    if (status && !(ITEM_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Bad status." }, { status: 400 });
    const patch: Record<string, unknown> = { ...stamp };
    if ("status" in body.item) patch.status = status;
    if ("remarks" in body.item) patch.remarks = String(body.item.remarks ?? "").trim().slice(0, 2000) || null;
    if ("parts_needed" in body.item) patch.parts_needed = String(body.item.parts_needed ?? "").trim().slice(0, 2000) || null;
    if ("labour_hours" in body.item) {
      const n = Number(body.item.labour_hours);
      patch.labour_hours = body.item.labour_hours === "" || body.item.labour_hours === null || !Number.isFinite(n) ? null : Math.min(999, Math.max(0, n));
    }
    if (reviewing) {
      const { data: cur } = await admin.from("inspection_items").select("status, remarks, parts_needed, original").eq("inspection_id", insp.id).eq("item_key", String(body.item.key)).maybeSingle();
      Object.assign(patch, reviewStamp, cur && !cur.original ? { original: { status: cur.status, remarks: cur.remarks, parts_needed: cur.parts_needed } } : {});
    }
    const { error } = await admin.from("inspection_items").update(patch).eq("inspection_id", insp.id).eq("item_key", String(body.item.key));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.sectionAllGood) {
    const { error } = await admin.from("inspection_items").update({ status: "good", ...stamp }).eq("inspection_id", insp.id).eq("section_key", String(body.sectionAllGood)).is("status", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.finding) {
    const status = body.finding.status ? String(body.finding.status) : null;
    if (status && !(ITEM_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Bad status." }, { status: 400 });
    const row: Record<string, unknown> = { inspection_id: insp.id, job_request_id: String(body.finding.requestId), ...stamp, created_by: staff.id };
    if ("found" in body.finding) row.found = String(body.finding.found ?? "").trim().slice(0, 2000) || null;
    if ("needs" in body.finding) row.needs = String(body.finding.needs ?? "").trim().slice(0, 2000) || null;
    if ("status" in body.finding) row.status = status;
    if (reviewing) {
      const { data: cur } = await admin.from("inspection_findings").select("found, needs, status, original").eq("inspection_id", insp.id).eq("job_request_id", String(body.finding.requestId)).maybeSingle();
      Object.assign(row, reviewStamp, cur && !cur.original ? { original: { found: cur.found, needs: cur.needs, status: cur.status } } : {});
    }
    const { error } = await admin.from("inspection_findings").upsert(row, { onConflict: "inspection_id,job_request_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.measurements) {
    const next: Record<string, string | number> = { ...(insp.measurements ?? {}) };
    for (const [k, v] of Object.entries(body.measurements)) {
      const clean = cleanMeasurementValue(k, String(v ?? ""));
      if (clean !== null) next[k] = clean;
    }
    const mPatch: Record<string, unknown> = { measurements: next, ...stamp };
    if (reviewing) Object.assign(mPatch, { measurements_edited_by: staff.id, measurements_edited_at: new Date().toISOString() }, insp.measurements_original ? {} : { measurements_original: insp.measurements ?? {} });
    const { error } = await admin.from("inspections").update(mPatch).eq("id", insp.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.technicianNotes !== undefined) {
    const { error } = await admin.from("inspections").update({ technician_notes: String(body.technicianNotes).trim().slice(0, 4000) || null, ...stamp }).eq("id", insp.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
