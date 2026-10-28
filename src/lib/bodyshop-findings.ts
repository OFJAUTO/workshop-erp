import "server-only";
import { BODY_ACTIONS, DAMAGE_TYPES, SEVERITIES, actionLabel, damageWords, panelLabel, PANEL_LABEL, severityLabel } from "./car-outline";
import { sideOfDepartment } from "./inspection";
import { technicianOnJob } from "./job-technicians";
import { notifyManagers, notifyRoles } from "./notifications";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { LINE_TEXT_MAX, tooLongWords } from "./text-limits";

/**
 * Bodyshop findings inside the inspection (23 October 2026, section 7): a front-accident car has body damage as
 * well as mechanical damage. One finding per panel of the car outline - damage, severity, action, photos (required),
 * a remark, internal hours and parts - plus the accident questions. The technician opens it; the bodyshop manager
 * is told and completes or checks it; after the check only bodyshop staff and the owner change it.
 */
export type BodyFinding = { id: string; panel: string; damage: string[]; severity: string | null; action: string | null; remark: string | null; labour_hours: number | null };
export type BodyState = {
  findings: BodyFinding[];
  openedAt: string | null;
  airbags: boolean | null;
  structural: boolean | null;
  checkedAt: string | null;
  checkedBy: string | null;
};

const FINDING_SELECT = "id, panel, damage, severity, action, remark, labour_hours, position";

export async function loadBodyState(inspectionId: string): Promise<BodyState> {
  const admin = createAdminClient();
  const [{ data: rows }, { data: insp }] = await Promise.all([
    admin.from("bodyshop_findings").select(FINDING_SELECT).eq("inspection_id", inspectionId).eq("is_active", true).order("position"),
    admin.from("inspections").select("bodyshop_opened_at, airbags_deployed, structural_damage, bodyshop_checked_at, bodyshop_checked_by").eq("id", inspectionId).maybeSingle(),
  ]);
  const checker = insp?.bodyshop_checked_by ? (await admin.from("staff").select("display_name").eq("id", insp.bodyshop_checked_by).maybeSingle()).data?.display_name ?? null : null;
  return {
    findings: ((rows ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), panel: String(r.panel), damage: (r.damage as string[] | null) ?? [], severity: (r.severity as string | null) ?? null, action: (r.action as string | null) ?? null, remark: (r.remark as string | null) ?? null, labour_hours: r.labour_hours === null || r.labour_hours === undefined ? null : Number(r.labour_hours) })),
    openedAt: (insp?.bodyshop_opened_at as string | null) ?? null,
    airbags: (insp?.airbags_deployed as boolean | null) ?? null,
    structural: (insp?.structural_damage as boolean | null) ?? null,
    checkedAt: (insp?.bodyshop_checked_at as string | null) ?? null,
    checkedBy: checker,
  };
}

/** Bodyshop staff: the owner, workshop managers of the bodyshop side, team leaders of bodyshop sections. */
export function isBodyshopStaff(staff: { role_id: string; department_id?: string | null }): boolean {
  if (staff.role_id === "owner") return true;
  if (staff.role_id === "workshop_manager" || staff.role_id === "team_leader") return sideOfDepartment(staff.department_id ?? null) === "bodyshop";
  return false;
}

/**
 * Who may change the bodyshop findings: bodyshop staff and the owner always; before the bodyshop check, also the
 * technicians on the car while the report is with them, and the mechanical manager reviewing it.
 */
export async function canEditBody(staff: { id: string; role_id: string; department_id?: string | null; viewingAs?: unknown }, insp: { job_id: string; status: string; bodyshop_checked_at: string | null }): Promise<boolean> {
  if (staff.viewingAs) return false;
  if (isBodyshopStaff(staff)) return true;
  if (insp.bodyshop_checked_at) return false;
  if (staff.role_id === "technician") return ["not_started", "in_progress", "returned"].includes(insp.status) && (await technicianOnJob(insp.job_id, staff.id));
  if (staff.role_id === "workshop_manager") return insp.status === "submitted" || insp.status === "in_progress";
  return false;
}

/** Cleans a finding from the browser: known words only. */
export function cleanFinding(input: Record<string, unknown>): { panel: string; damage: string[]; severity: string | null; action: string | null; remark: string | null; labour_hours: number | null } | { error: string } {
  const panel = String(input.panel ?? "");
  if (!PANEL_LABEL[panel]) return { error: "Unknown panel." };
  const damage = Array.isArray(input.damage) ? Array.from(new Set(input.damage.map(String).filter((d) => DAMAGE_TYPES.some((t) => t.value === d)))) : [];
  const severity = SEVERITIES.some((s) => s.value === input.severity) ? String(input.severity) : null;
  const action = BODY_ACTIONS.some((a) => a.value === input.action) ? String(input.action) : null;
  const remark = typeof input.remark === "string" ? input.remark.replace(/\s+/g, " ").trim() || null : null;
  if (remark && remark.length > LINE_TEXT_MAX) return { error: tooLongWords(remark.length) };
  const h = Number(String(input.labour_hours ?? "").replace(",", "."));
  const labour_hours = input.labour_hours === null || input.labour_hours === undefined || input.labour_hours === "" || !Number.isFinite(h) ? null : Math.min(999, Math.max(0, Math.round(h * 100) / 100));
  return { panel, damage, severity, action, remark, labour_hours };
}

/** The bodyshop manager hears once that a car needs a bodyshop assessment: "Bodyshop assessment needed – Dubai C 877 Urus". */
export async function notifyBodyshopAssessment(inspectionId: string, jobId: string, byName: string) {
  const admin = createAdminClient();
  const { data: insp } = await admin.from("inspections").select("bodyshop_notified_at").eq("id", inspectionId).maybeSingle();
  if (insp?.bodyshop_notified_at) return;
  await admin.from("inspections").update({ bodyshop_notified_at: new Date().toISOString() }).eq("id", inspectionId);
  const { data: job } = await admin.from("jobs").select("job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, model:vehicle_models(name))").eq("id", jobId).maybeSingle();
  const v = job?.vehicle as unknown as (Parameters<typeof formatPlate>[0] & { model: { name: string } | null }) | null;
  const car = [v ? formatPlate(v) : job?.job_number, v?.model?.name].filter(Boolean).join(" ");
  const n = { type: "bodyshop_assessment", title: `Bodyshop assessment needed – ${car}`, body: `${byName} found body damage during the inspection. Complete or check the bodyshop findings.`, jobId, href: `/jobs/${jobId}/inspection#body` };
  await notifyManagers("bodyshop", n);
  await notifyRoles(["owner"], n);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_assessment", note: `Bodyshop findings opened by ${byName}; the bodyshop manager was told` });
}

/** What still has to be done on the bodyshop part before the report goes to the manager: a photo on every finding. */
export async function bodyProblems(inspectionId: string): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: rows }, { data: media }] = await Promise.all([
    admin.from("bodyshop_findings").select("panel").eq("inspection_id", inspectionId).eq("is_active", true),
    admin.from("inspection_media").select("item_key").eq("inspection_id", inspectionId).like("item_key", "body.%").is("removed_at", null),
  ]);
  const withPhoto = new Set((media ?? []).map((m) => String(m.item_key)));
  return (rows ?? []).filter((r) => !withPhoto.has(`body.${r.panel}`)).map((r) => `Bodyshop: add a photo of the ${panelLabel(String(r.panel)).toLowerCase()}`);
}

/** "Front bumper – Repair & paint": the quotation line for a finding. */
export function bodyLineTitle(f: Pick<BodyFinding, "panel" | "action">): string {
  return [panelLabel(f.panel), actionLabel(f.action)].filter(Boolean).join(" – ");
}
/** "Dent, Crack · Severe": the words for the report and the line note. */
export function bodyFindingWords(f: Pick<BodyFinding, "damage" | "severity">): string {
  return [damageWords(f.damage), severityLabel(f.severity)].filter(Boolean).join(" · ");
}
