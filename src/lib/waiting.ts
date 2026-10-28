import "server-only";
import type { CurrentStaff } from "./auth";
import { jobConcernsSide, sideOfDepartment, type InspectionStatus } from "./inspection";
import { formatWait, workingMinutesSince, workingTimeOf, type JobStatus } from "./jobs";
import { depositsWaiting } from "./deposits";
import { nextStepOf } from "./next-step";
import { loadPartsLiveMap, planningOnOf } from "./parts-data";
import { loadQuoteSummaries } from "./quote-data";
import { quoteState } from "./quotes";
import type { RoadTestRow } from "./road-test";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { workSidesForJobs } from "./staff-picker";

export type Urgency = "red" | "amber" | "grey";

/**
 * How hard a task is knocking (1.2, 21 October 2026): red = money to record, a tax invoice to issue or a
 * customer waiting with the car Ready; amber = today's operational work (approvals, pricing, assigning);
 * grey comes only from the when-you-can extras (recovery, month-end). An amber task older than a day turns
 * red where it is shown.
 */
export function urgencyOf(i: { actorRole: string | null; status: string; line: string }): Urgency {
  if (/order now/i.test(i.line)) return "red";
  if (i.actorRole === "accounts") return "red";
  if (/deposit/i.test(i.line) && /record|waiting for the deposit/i.test(i.line)) return "red";
  if (["ready", "pending_payment", "in_delivery"].includes(i.status)) return "red";
  return "amber";
}

export type WaitingItem = {
  jobId: string;
  jobNumber: string;
  plate: string;
  car: string;
  /** What to do, short (the step line); the full sentence sits in hint for the tooltip. */
  what: string;
  hint: string;
  actionLabel: string;
  href: string;
  since: string;
  wait: string;
  role: string;
  urgency: Urgency;
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
  plan_released_at: string | null;
  plan_bodyshop_released_at: string | null;
  bodyshop_started_at: string | null;
  plan_date_confirmed_at: string | null;
  deposit_requested_at: string | null;
  work_done_at: string | null;
  wash_sent_at: string | null;
};

const SELECT =
  "id, job_number, job_kind, status, is_open, department, assigned_to, gated_in_by, gated_in_at, first_approval_at, stage_entered_at, plan_released_at, plan_bodyshop_released_at, bodyshop_started_at, plan_date_confirmed_at, deposit_requested_at, work_done_at, wash_sent_at, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name), gate_in:gate_ins(is_complete), inspection:inspections(status, technician_id, submitted_at, approved_at), approval:approval_requests(sent_at, opened_at, approved_at, approver_name, created_at, sent_by), road_test:road_tests(status, decision)";

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
  // The live parts picture of every job at the parts step: no stored flag decides whose move it is.
  const planningJobs = all.filter((j) => ["approved", "waiting_parts"].includes(j.status) || (j.department === "both" && j.status === "in_work"));
  const [partsLiveMap, sidesMap] = await Promise.all([loadPartsLiveMap(all.filter((j) => ["approved", "waiting_parts"].includes(j.status)).map((j) => j.id)), workSidesForJobs(planningJobs.map((j) => ({ id: j.id, department: (j.department as string | null) ?? null })))]);
  // The advance payments still short, one bulk read: the step bar and the lists all see the same facts.
  const depositOf = new Map((await depositsWaiting()).map((d) => [d.jobId, d]));
  // The live proforma or tax invoice of the cars at the money steps, so the next step never says "proforma to prepare" on a paid car.
  const moneyIds = all.filter((j) => ["ready", "pending_payment", "in_delivery"].includes(j.status)).map((j) => j.id);
  const { data: invRows } = moneyIds.length ? await admin.from("invoices").select("job_id, kind, sent_at, converted_to").in("job_id", moneyIds).eq("status", "issued").eq("is_active", true).is("converted_to", null).in("kind", ["proforma", "tax_invoice"]) : { data: [] as { job_id: string; kind: string; sent_at: string | null }[] };
  const invoiceOf = new Map<string, { kind: "proforma" | "tax_invoice"; sent_at: string | null }>();
  for (const r of (invRows ?? []) as { job_id: string; kind: string; sent_at: string | null }[]) if (!invoiceOf.has(r.job_id) || r.kind === "tax_invoice") invoiceOf.set(r.job_id, { kind: r.kind as "proforma" | "tax_invoice", sent_at: r.sent_at });
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
      extra: {
        // Without these two stamps a finished job still read "In work, waiting on the technician" here,
        // so the manager's "confirm the work" task never reached his Waiting list (found by sim path a).
        workFinishedAt: j.work_done_at,
        washSentAt: j.wash_sent_at,
        ...(invoiceOf.has(j.id) ? { invoiced: true, invoiceKind: invoiceOf.get(j.id)!.kind, readySent: invoiceOf.get(j.id)!.kind === "proforma" && !!invoiceOf.get(j.id)!.sent_at, invoiceSent: invoiceOf.get(j.id)!.kind === "tax_invoice" && !!invoiceOf.get(j.id)!.sent_at } : {}),
        ...(partsLiveMap.has(j.id) ? { parts: partsLiveMap.get(j.id)!, planningOn: planningOnOf(j, partsLiveMap.get(j.id)!, sidesMap.get(j.id)) } : {}),
        ...(depositOf.has(j.id) ? { deposit: { required: depositOf.get(j.id)!.required, received: depositOf.get(j.id)!.received, short: true, requestedAt: j.deposit_requested_at } } : {}),
      },
    });
    if (!step.actorRole || step.actorRole === "customer") continue;
    const mine =
      role === "owner"
        ? true
        : role === "workshop_manager"
          ? step.actorRole === "workshop_manager" && (step.side ? !side || step.side === side : jobConcernsSide(j.department, side))
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
      what: step.line,
      hint: step.next,
      actionLabel: step.action?.label ?? "Open",
      href: step.action?.href ?? (role === "technician" ? `/my-jobs/${j.id}` : `/jobs/${j.id}`),
      since: step.since,
      wait: formatWait(workingMinutesSince(step.since, wt, now), wt),
      role: step.actorRole,
      urgency: urgencyOf({ actorRole: step.actorRole, status: j.status, line: step.line }),
    });
  }
  out.sort((a, b) => a.since.localeCompare(b.since));
  return out;
}
