import "server-only";
import { createAdminClient } from "./supabase/admin";
import { checklistItems, reportProblemsOf, type ChecklistSection, type InspectionStatus, type ItemStatus } from "./inspection";
import { workingHoursBetween, type WorkingTime } from "./working-time";

export const INSPECTION_BUCKET = "inspection-media";

export type InspectionRow = {
  id: string;
  job_id: string;
  path: "mechanical" | "bodyshop";
  technician_id: string | null;
  status: InspectionStatus;
  started_at: string | null;
  submitted_at: string | null;
  returned_at: string | null;
  return_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  technician_notes: string | null;
  manager_note: string | null;
  checklist: ChecklistSection[];
  measurements: Record<string, string | number>;
  target_minutes: number | null;
  elapsed_minutes: number | null;
  overrun_minutes: number | null;
  overdue_warned_at: string | null;
  show_prescan_to_customer: boolean;
  unlocked_until: string | null;
  measurements_original: Record<string, string | number> | null;
  measurements_edited_by: string | null;
  measurements_edited_at: string | null;
  measurements_edited_by_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type InspectionItemRow = {
  id: string;
  inspection_id: string;
  section_key: string;
  section_title: string;
  item_key: string;
  item_label: string;
  position: number;
  status: ItemStatus | null;
  remarks: string | null;
  parts_needed: string | null;
  labour_hours: number | null;
  edited_by: string | null;
  edited_at: string | null;
  original: Record<string, unknown> | null;
  edited_by_name?: string | null;
};

export type InspectionFindingRow = { id: string; inspection_id: string; job_request_id: string; found: string | null; needs: string | null; status: ItemStatus | null; edited_by: string | null; edited_at: string | null; original: Record<string, unknown> | null; edited_by_name?: string | null };

export type InspectionMediaRow = {
  id: string;
  inspection_id: string;
  item_key: string | null;
  job_request_id: string | null;
  kind: "photo" | "video" | "pdf";
  is_prescan: boolean;
  storage_path: string;
  caption: string | null;
  duration_s: number | null;
  taken_at: string;
  uploaded_by: string | null;
};

export type ChangeRequestRow = {
  id: string;
  inspection_id: string;
  requested_by: string | null;
  reason: string;
  status: "pending" | "approved" | "refused";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  requester: { display_name: string } | null;
  decider: { display_name: string } | null;
};

export type InspectionBundle = {
  inspection: InspectionRow;
  items: InspectionItemRow[];
  findings: InspectionFindingRow[];
  media: InspectionMediaRow[];
  mediaUrls: Record<string, string>;
  changeRequests: ChangeRequestRow[];
  technician: { display_name: string } | null;
  approver: { display_name: string } | null;
};

const INSPECTION_SELECT =
  "id, job_id, path, technician_id, status, started_at, submitted_at, returned_at, return_reason, approved_at, approved_by, technician_notes, manager_note, checklist, measurements, target_minutes, elapsed_minutes, overrun_minutes, overdue_warned_at, show_prescan_to_customer, unlocked_until, measurements_original, measurements_edited_by, measurements_edited_at, created_at, updated_at";

/** The mechanical inspection of a job with everything attached, or null when none exists yet. */
export async function loadInspection(jobId: string, path: "mechanical" | "bodyshop" = "mechanical"): Promise<InspectionBundle | null> {
  const admin = createAdminClient();
  const { data: insp } = await admin.from("inspections").select(INSPECTION_SELECT).eq("job_id", jobId).eq("path", path).eq("is_active", true).maybeSingle();
  if (!insp) return null;
  const inspection = insp as unknown as InspectionRow;
  const [{ data: items }, { data: findings }, { data: media }, { data: changes }, { data: tech }, { data: approver }] = await Promise.all([
    admin.from("inspection_items").select("id, inspection_id, section_key, section_title, item_key, item_label, position, status, remarks, parts_needed, labour_hours, edited_by, edited_at, original").eq("inspection_id", inspection.id).order("position"),
    admin.from("inspection_findings").select("id, inspection_id, job_request_id, found, needs, status, edited_by, edited_at, original").eq("inspection_id", inspection.id),
    admin.from("inspection_media").select("id, inspection_id, item_key, job_request_id, kind, is_prescan, storage_path, caption, duration_s, taken_at, uploaded_by").eq("inspection_id", inspection.id).order("taken_at"),
    admin
      .from("inspection_change_requests")
      .select("id, inspection_id, requested_by, reason, status, decided_by, decided_at, decision_note, created_at, requester:staff!inspection_change_requests_requested_by_fkey(display_name), decider:staff!inspection_change_requests_decided_by_fkey(display_name)")
      .eq("inspection_id", inspection.id)
      .order("created_at", { ascending: false }),
    inspection.technician_id ? admin.from("staff").select("display_name").eq("id", inspection.technician_id).maybeSingle() : Promise.resolve({ data: null }),
    inspection.approved_by ? admin.from("staff").select("display_name").eq("id", inspection.approved_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const mediaRows = (media ?? []) as InspectionMediaRow[];
  const mediaUrls: Record<string, string> = {};
  if (mediaRows.length) {
    const { data: signed } = await admin.storage.from(INSPECTION_BUCKET).createSignedUrls(
      mediaRows.map((m) => m.storage_path),
      3600,
    );
    for (const s of signed ?? []) if (s.path && s.signedUrl) mediaUrls[s.path] = s.signedUrl;
  }
  // Names of the people who edited during review.
  const editorIds = new Set<string>();
  for (const i of (items ?? []) as InspectionItemRow[]) if (i.edited_by) editorIds.add(i.edited_by);
  for (const f of (findings ?? []) as InspectionFindingRow[]) if (f.edited_by) editorIds.add(f.edited_by);
  if (inspection.measurements_edited_by) editorIds.add(inspection.measurements_edited_by);
  const { data: editors } = editorIds.size ? await admin.from("staff").select("id, display_name").in("id", Array.from(editorIds)) : { data: [] as { id: string; display_name: string }[] };
  const editorName = new Map((editors ?? []).map((e) => [e.id, e.display_name]));
  inspection.measurements_edited_by_name = inspection.measurements_edited_by ? (editorName.get(inspection.measurements_edited_by) ?? null) : null;
  return {
    inspection,
    items: ((items ?? []) as InspectionItemRow[]).map((i) => ({ ...i, edited_by_name: i.edited_by ? (editorName.get(i.edited_by) ?? null) : null })),
    findings: ((findings ?? []) as InspectionFindingRow[]).map((f) => ({ ...f, edited_by_name: f.edited_by ? (editorName.get(f.edited_by) ?? null) : null })),
    media: mediaRows,
    mediaUrls,
    changeRequests: (changes ?? []) as unknown as ChangeRequestRow[],
    technician: (tech as { display_name: string } | null) ?? null,
    approver: (approver as { display_name: string } | null) ?? null,
  };
}

/** Creates the inspection record with the current checklist when a technician is assigned. */
export async function ensureInspection(jobId: string, technicianId: string, checklist: ChecklistSection[], targetMinutes: number, by: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("inspections").select("id, status, technician_id").eq("job_id", jobId).eq("path", "mechanical").eq("is_active", true).maybeSingle();
  if (existing) {
    if (existing.status !== "approved" && existing.technician_id !== technicianId) {
      await admin.from("inspections").update({ technician_id: technicianId, updated_by: by }).eq("id", existing.id);
    }
    return existing.id as string;
  }
  const { data: created, error } = await admin
    .from("inspections")
    .insert({ job_id: jobId, path: "mechanical", technician_id: technicianId, status: "not_started", checklist, target_minutes: targetMinutes, created_by: by, updated_by: by })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the inspection.");
  const rows = checklistItems(checklist).map((i, position) => ({
    inspection_id: created.id,
    section_key: i.sectionKey,
    section_title: i.sectionTitle,
    item_key: i.key,
    item_label: i.label,
    position,
    created_by: by,
    updated_by: by,
  }));
  if (rows.length) await admin.from("inspection_items").insert(rows);
  return created.id as string;
}

/** Working minutes since the inspection started (until it was submitted, if it was). */
export function inspectionWorkingMinutes(insp: Pick<InspectionRow, "started_at" | "submitted_at" | "status" | "elapsed_minutes">, wt: WorkingTime, now = new Date()) {
  if (!insp.started_at) return 0;
  if (insp.status === "submitted" || insp.status === "approved") return insp.elapsed_minutes ?? Math.round(workingHoursBetween(insp.started_at, insp.submitted_at ?? now, wt) * 60);
  return Math.round(workingHoursBetween(insp.started_at, now, wt) * 60);
}

export function inspectionOverTarget(insp: Pick<InspectionRow, "started_at" | "submitted_at" | "status" | "elapsed_minutes" | "target_minutes">, wt: WorkingTime, now = new Date()) {
  const target = insp.target_minutes ?? 0;
  return target > 0 && inspectionWorkingMinutes(insp, wt, now) > target;
}

/** An approved report is locked unless the owner has approved a change request (which opens it for a day). */
export function inspectionLocked(insp: Pick<InspectionRow, "status" | "unlocked_until">, now = new Date()) {
  if (insp.status !== "approved") return false;
  return !(insp.unlocked_until && Date.parse(insp.unlocked_until) > now.getTime());
}

/** What still has to be done before the report can go to the manager (same rules as the technician's screen). */
export function reportProblems(b: InspectionBundle, requests: { id: string; text: string }[]): string[] {
  return reportProblemsOf({
    items: b.items.map((i) => ({ key: i.item_key, label: i.item_label, sectionKey: i.section_key, status: i.status, remarks: i.remarks ?? "" })),
    findings: requests.map((r) => {
      const f = b.findings.find((x) => x.job_request_id === r.id);
      return { requestId: r.id, text: r.text, status: f?.status ?? null, found: f?.found ?? "" };
    }),
    measurements: Object.fromEntries(Object.entries(b.inspection.measurements ?? {}).map(([k, v]) => [k, String(v)])),
  }).map((p) => p.label);
}
