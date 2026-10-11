import "server-only";
import type { CurrentStaff } from "./auth";
import { jobConcernsSide, sideOfDepartment, type InspectionStatus } from "./inspection";
import { formatWait, workingMinutesSince, workingTimeOf, type JobStatus } from "./jobs";
import { nextStepOf } from "./next-step";
import { loadQuoteSummaries } from "./quote-data";
import { quoteState } from "./quotes";
import type { RoadTestRow } from "./road-test";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

export type WaitingItem = {
  jobId: string;
  jobNumber: string;
  plate: string;
  car: string;
  /** What to do, in plain words. */
  what: string;
  actionLabel: string;
  href: string;
  since: string;
  wait: string;
  role: string;
};

type Row = {
  id: string;
  job_number: string;
  job_kind: string | null;
  status: JobStatus;
  is_open: boolean;
  department: string | null;
  assigned_to: string | null;
  gated_in_by: string;
  gated_in_at: string;
  first_approval_at: string | null;
  stage_entered_at: string;
  vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  assignee: { display_name: string } | null;
  approval: { sent_at: string | null; opened_at: string | null; approved_at: string | null; approver_name: string | null; created_at: string; sent_by: string | null }[] | null;
  road_test: Pick<RoadTestRow, "status" | "decision">[] | null;
  gate_in: { is_complete: boolean } | null;
  inspection: { status: InspectionStatus; technician_id: string | null; submitted_at: string | null; approved_at: string | null }[] | null;
};

const SELECT =
  "id, job_number, job_kind, status, is_open, department, assigned_to, gated_in_by, gated_in_at, first_approval_at, stage_entered_at, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name), gate_in:gate_ins(is_complete), inspection:inspections(status, technician_id, submitted_at, approved_at), approval:approval_requests(sent_at, opened_at, approved_at, approver_name, created_at, sent_by), road_test:road_tests(status, decision)";

/**
 * "Waiting on you": every open car whose next step is this person's move, oldest wait first. The owner sees
 * everyone's. A manager sees their department's; a technician the cars they are on; an advisor their own cars.
 */
export async function loadWaitingOnYou(staff: CurrentStaff, settings: Settings): Promise<WaitingItem[]> {
  const admin = createAdminClient();
  const role = staff.role_id;
  const [{ data }, { data: onCar }] = await Promise.all([
    admin.from("jobs").select(SELECT).eq("is_open", true),
    role === "technician" ? admin.from("job_technicians").select("job_id").eq("staff_id", staff.id).eq("is_active", true).is("left_at", null) : Promise.resolve({ data: [] as { job_id: string }[] }),
  ]);
  const all = (data ?? []) as unknown as Row[];
  const summaries = await loadQuoteSummaries(all.filter((j) => ["pending_quote", "pending_customer_approval"].includes(j.status)).map((j) => j.id));
  const myCars = new Set((onCar ?? []).map((t) => t.job_id));
  const side = role === "owner" ? null : sideOfDepartment(staff.department_id);
  const wt = workingTimeOf(settings);
  const now = new Date();
  const out: WaitingItem[] = [];
  for (const j of all) {
    const insp = j.inspection?.find((i) => i.status === "in_progress" || i.status === "submitted" || i.status === "approved" || i.status === "returned" || i.status === "not_started") ?? null;
    const latestApproval = (j.approval ?? []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
    const step = nextStepOf(j.id, {
      status: j.status,
      is_open: j.is_open,
      assigned_to: j.assigned_to,
      first_approval_at: j.first_approval_at,
      gated_in_at: j.gated_in_at,
      stage_entered_at: j.stage_entered_at,
      assigneeName: j.assignee?.display_name ?? null,
      advisorName: null,
      managerLabel: j.department === "bodyshop" ? "the bodyshop manager" : "the workshop manager",
      inspection: insp ? { status: insp.status, technician_id: insp.technician_id, submitted_at: insp.submitted_at, approved_at: insp.approved_at } : null,
      roadTest: j.road_test?.[0] ?? null,
      approval: latestApproval,
      gateInComplete: !!j.gate_in?.is_complete,
      loose: j.job_kind === "loose",
      quote: summaries.has(j.id) ? quoteState(summaries.get(j.id)!, !!insp && insp.status === "approved") : null,
    });
    if (!step.actorRole || step.actorRole === "customer") continue;
    const mine =
      role === "owner"
        ? true
        : role === "workshop_manager"
          ? step.actorRole === "workshop_manager" && jobConcernsSide(j.department, side)
          : role === "technician"
            ? step.actorRole === "technician" && (j.assigned_to === staff.id || myCars.has(j.id))
            : role === "service_advisor"
              ? step.actorRole === "service_advisor" && (j.gated_in_by === staff.id || (j.approval ?? []).some((a) => a.sent_by === staff.id))
              : role === "gate_in"
                ? step.actorRole === "gate_in" && j.gated_in_by === staff.id
                : step.actorRole === role;
    if (!mine) continue;
    out.push({
      jobId: j.id,
      jobNumber: j.job_number,
      plate: j.vehicle ? formatPlate(j.vehicle) : j.job_number,
      car: [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" "),
      what: step.next,
      actionLabel: step.action?.label ?? "Open",
      href: step.action?.href ?? (role === "technician" ? `/my-jobs/${j.id}` : `/jobs/${j.id}`),
      since: step.since,
      wait: formatWait(workingMinutesSince(step.since, wt, now), wt),
      role: step.actorRole,
    });
  }
  out.sort((a, b) => a.since.localeCompare(b.since));
  return out;
}
