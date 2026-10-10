import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { CHECK_STATUSES, DISC_ACTIONS, DISC_CONDITIONS, ITEM_STATUSES, LEAK_REPAIRS, LEAK_SEVERITIES, TYRE_POSITIONS, cleanMeasurementValue, cleanPartsRows, partsRowsText } from "@/lib/inspection";
import { inspectionLocked, type InspectionRow } from "@/lib/inspection-data";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { technicianOnJob } from "@/lib/job-technicians";

type ItemPatch = {
  key: string;
  status?: string | null;
  remarks?: string;
  parts_needed?: string;
  labour_hours?: string | number | null;
  parts_rows?: unknown;
  dangerous?: boolean;
  dangerous_reason?: string | null;
  leak_severity?: string | null;
  leak_repair?: string | null;
  fluid_qty?: string | number | null;
  fluid_unit?: string | null;
  fluid_grade?: string | null;
  fluid_spec?: string | null;
  disc_condition?: string | null;
  disc_action?: string | null;
  disc_thickness?: string | number | null;
  disc_minimum?: string | number | null;
};
type Body = {
  inspectionId?: string;
  item?: ItemPatch;
  sectionAllGood?: string;
  /** Every item of a section gets one status, for example N/A. */
  sectionAll?: { key: string; status: string };
  finding?: { requestId: string; found?: string; needs?: string; status?: string | null };
  measurements?: Record<string, string>;
  technicianNotes?: string;
  prescanVisible?: boolean;
  /** Report-level answers: the estimated hours, the big-job tags, the scan step. */
  inspection?: { estimated_hours?: string | number | null; estimate_reason?: string | null; big_job_tags?: unknown; scan_read?: boolean; scan_not_possible_reason?: string | null };
};

const num = (v: unknown, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n * 100) / 100)) : null;
};
const text = (v: unknown, max: number) => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);
const oneOf = (v: unknown, list: readonly { value: string }[]) => (v === null || v === undefined || v === "" ? null : list.some((x) => x.value === v) ? String(v) : undefined);

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
  if (staff.viewingAs) return NextResponse.json({ error: "View only." }, { status: 403 });
  const role = staff.role_id as RoleId;
  const admin = createAdminClient();
  const { data } = await admin.from("inspections").select("id, job_id, technician_id, status, unlocked_until, measurements, measurements_original").eq("id", String(body.inspectionId ?? "")).maybeSingle();
  if (!data) return NextResponse.json({ error: "Inspection not found." }, { status: 404 });
  const insp = data as unknown as Pick<InspectionRow, "id" | "job_id" | "technician_id" | "status" | "unlocked_until" | "measurements" | "measurements_original">;

  const isTech = role === "technician" && (insp.technician_id === staff.id || (await technicianOnJob(insp.job_id, staff.id)));
  const isManager = can(role, "approveInspections");
  if (body.prescanVisible !== undefined) {
    // Show to customer / Hide from customer belongs to advisors and the owner.
    if (!can(role, "sendReport")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
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
  /** A dangerous finding: the manager, the advisor and the owner hear at once. */
  const alertDanger = async (what: string, reason: string | null) => {
    const { data: job } = await admin.from("jobs").select("id, job_number, department, gated_in_by").eq("id", insp.job_id).maybeSingle();
    if (!job) return;
    const n = { type: "dangerous_found", title: `DANGEROUS: ${what} · ${job.job_number}`, body: `${staff.display_name} marked it dangerous to drive${reason ? `: ${reason}` : ""}.`, jobId: job.id, href: `/jobs/${job.id}/inspection` };
    await notifyManagers(job.department, n);
    await notifyRoles(["owner"], n);
    if (job.gated_in_by) await notifyStaff([job.gated_in_by], n);
    await admin.from("job_events").insert({ job_id: job.id, event_type: "dangerous_found", note: `${staff.display_name} marked "${what}" dangerous to drive${reason ? `: ${reason}` : ""}`, created_by: staff.id });
  };

  if (body.item) {
    const it = body.item;
    const status = it.status ? String(it.status) : null;
    if (status && !(ITEM_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Bad status." }, { status: 400 });
    const patch: Record<string, unknown> = { ...stamp };
    if ("status" in it) patch.status = status;
    if ("remarks" in it) patch.remarks = text(it.remarks, 2000);
    if ("parts_needed" in it) patch.parts_needed = text(it.parts_needed, 2000);
    if ("parts_rows" in it) {
      const rows = cleanPartsRows(it.parts_rows);
      patch.parts_rows = rows;
      patch.parts_needed = partsRowsText(rows) || null;
    }
    if ("labour_hours" in it) {
      const n = Number(it.labour_hours);
      patch.labour_hours = it.labour_hours === "" || it.labour_hours === null || !Number.isFinite(n) ? null : Math.min(999, Math.max(0, n));
    }
    if ("dangerous" in it) patch.dangerous = !!it.dangerous;
    if ("dangerous_reason" in it) patch.dangerous_reason = text(it.dangerous_reason, 300);
    for (const [k, list] of [["leak_severity", LEAK_SEVERITIES], ["leak_repair", LEAK_REPAIRS], ["disc_condition", DISC_CONDITIONS], ["disc_action", DISC_ACTIONS]] as const) {
      if (k in it) {
        const v = oneOf(it[k], list);
        if (v === undefined) return NextResponse.json({ error: `Bad ${k.replace("_", " ")}.` }, { status: 400 });
        patch[k] = v;
      }
    }
    if ("fluid_qty" in it) patch.fluid_qty = num(it.fluid_qty, 100000);
    if ("fluid_unit" in it) patch.fluid_unit = text(it.fluid_unit, 8);
    if ("fluid_grade" in it) patch.fluid_grade = text(it.fluid_grade, 40);
    if ("fluid_spec" in it) patch.fluid_spec = text(it.fluid_spec, 120);
    if ("disc_thickness" in it) patch.disc_thickness = num(it.disc_thickness, 1000);
    if ("disc_minimum" in it) patch.disc_minimum = num(it.disc_minimum, 1000);
    const { data: cur } = await admin.from("inspection_items").select("item_label, status, remarks, parts_needed, original, dangerous, dangerous_reason").eq("inspection_id", insp.id).eq("item_key", String(it.key)).maybeSingle();
    if (!cur) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    if (reviewing) Object.assign(patch, reviewStamp, cur.original ? {} : { original: { status: cur.status, remarks: cur.remarks, parts_needed: cur.parts_needed } });
    const { error } = await admin.from("inspection_items").update(patch).eq("inspection_id", insp.id).eq("item_key", String(it.key));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (patch.dangerous === true && !cur.dangerous) await alertDanger(cur.item_label, (patch.dangerous_reason as string | null) ?? cur.dangerous_reason ?? null);
  }
  if (body.sectionAllGood) {
    const { error } = await admin.from("inspection_items").update({ status: "good", ...stamp }).eq("inspection_id", insp.id).eq("section_key", String(body.sectionAllGood)).is("status", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.sectionAll) {
    const status = String(body.sectionAll.status ?? "");
    if (!(ITEM_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Bad status." }, { status: 400 });
    const { error } = await admin.from("inspection_items").update({ status, ...stamp, ...reviewStamp }).eq("inspection_id", insp.id).eq("section_key", String(body.sectionAll.key));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.finding) {
    const status = body.finding.status ? String(body.finding.status) : null;
    if (status && !(CHECK_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Bad status." }, { status: 400 });
    const row: Record<string, unknown> = { inspection_id: insp.id, job_request_id: String(body.finding.requestId), ...stamp, created_by: staff.id };
    if ("found" in body.finding) row.found = text(body.finding.found, 2000);
    if ("needs" in body.finding) row.needs = text(body.finding.needs, 2000);
    if ("status" in body.finding) row.status = status;
    if (reviewing) {
      const { data: cur } = await admin.from("inspection_findings").select("found, needs, status, original").eq("inspection_id", insp.id).eq("job_request_id", String(body.finding.requestId)).maybeSingle();
      Object.assign(row, reviewStamp, cur && !cur.original ? { original: { found: cur.found, needs: cur.needs, status: cur.status } } : {});
    }
    const { error } = await admin.from("inspection_findings").upsert(row, { onConflict: "inspection_id,job_request_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.measurements) {
    const before = { ...(insp.measurements ?? {}) };
    const next: Record<string, string | number> = { ...before };
    for (const [k, v] of Object.entries(body.measurements)) {
      const clean = cleanMeasurementValue(k, String(v ?? ""));
      if (clean !== null) next[k] = clean;
    }
    const mPatch: Record<string, unknown> = { measurements: next, ...stamp };
    if (reviewing) Object.assign(mPatch, { measurements_edited_by: staff.id, measurements_edited_at: new Date().toISOString() }, insp.measurements_original ? {} : { measurements_original: insp.measurements ?? {} });
    const { error } = await admin.from("inspections").update(mPatch).eq("id", insp.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of TYRE_POSITIONS) {
      if (String(next[`tyre_${p.key}_danger`] ?? "") === "1" && String(before[`tyre_${p.key}_danger`] ?? "") !== "1") await alertDanger(`${p.label} tyre`, String(next[`tyre_${p.key}_danger_reason`] ?? "") || null);
    }
  }
  if (body.technicianNotes !== undefined) {
    const { error } = await admin.from("inspections").update({ technician_notes: text(body.technicianNotes, 4000), ...stamp }).eq("id", insp.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (body.inspection) {
    const i = body.inspection;
    const patch: Record<string, unknown> = { ...stamp };
    if ("estimated_hours" in i) {
      const n = num(i.estimated_hours, 999);
      patch.estimated_hours = n === null ? null : Math.round(n * 10) / 10;
    }
    if ("estimate_reason" in i) patch.estimate_reason = text(i.estimate_reason, 300);
    if ("big_job_tags" in i) patch.big_job_tags = Array.isArray(i.big_job_tags) ? Array.from(new Set(i.big_job_tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))).slice(0, 12) : [];
    if (i.scan_read) patch.scan_read_at = new Date().toISOString();
    if ("scan_not_possible_reason" in i) patch.scan_not_possible_reason = text(i.scan_not_possible_reason, 300);
    const { error } = await admin.from("inspections").update(patch).eq("id", insp.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (patch.scan_not_possible_reason) {
      const { data: job } = await admin.from("jobs").select("id, job_number, department").eq("id", insp.job_id).maybeSingle();
      if (job) await notifyManagers(job.department, { type: "scan_approval", title: `Scan not possible, approve? · ${job.job_number}`, body: `${staff.display_name}: ${patch.scan_not_possible_reason}`, jobId: job.id, href: `/jobs/${job.id}/inspection` });
    }
  }
  return NextResponse.json({ ok: true });
}
