import { getSettings } from "@/lib/settings";
import { ppfByCutMethod } from "./ppf-cut-data";
import { workingTimeOf } from "@/lib/jobs";
import { countedMinutes, type WorkingTime } from "@/lib/working-time";
import "server-only";
import { randomBytes } from "node:crypto";
import { STAGE_DEFS, addDaysIso, neededSignoffs, sectionOfDepartment, spreadDueDates, stageDef, stageKeysFor, stageLabelFor, workingDaysBetween, type Section, type SignoffKey, type StageSection } from "./bodyshop-kinds";
import { formatDate } from "./format";
import { ensureProforma } from "./invoice-flow";
import { INVOICE_SELECT, nextDocumentNumber, toInvoice } from "./invoice-data";
import { dubaiDate } from "./jobs";
import { newToken } from "./media";
import { jobAdvisorIds, notifyStaff } from "./notifications";
import { LINE_SELECT, approvedQuotations, toLine } from "./quote-data";
import { isUnchosen, round2, type QuoteLine } from "./quotes";
import { bankChargePercentFor, type Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { rowMissing, stageAsks, warrantyCardOf } from "./warranty-data";
import { kindsOfLine, type SideLine } from "./job-sides";
import { workSidesOf } from "./staff-picker";
import { SECTION_OF_TEAM, teamOf } from "./teams";

export type Actor = { id: string; display_name: string; role_id?: string; department_id?: string | null };

export type StageRow = { id: string; job_id: string; position: number; key: string; label: string; section: StageSection; est_hours: number; due_date: string | null; status: "pending" | "active" | "done" | "skipped"; started_at: string | null; done_at: string | null; done_by: string | null; heads_up_sent_at: string | null; late_notified_at: string | null };
export type AssignmentRow = { id: string; job_id: string; staff_id: string; section: string; assigned_at: string; name: string; photoUrl: string | null };
export type ClockingRow = { id: string; job_id: string; stage_id: string | null; staff_id: string; started_at: string; ended_at: string | null; minutes: number | null; name: string };
export type SignoffRow = { id: string; job_id: string; role_key: SignoffKey; staff_id: string | null; signed_at: string; on_behalf: boolean; name: string };
export type RemovedItemRow = { id: string; job_id: string; label: string; photo_path: string | null; removed_at: string; refitted_at: string | null };
export type UpdateRow = { id: string; job_id: string; kind: "arrived" | "film" | "ready"; photo_id: string | null; token: string; sent_at: string | null };
export type Person = { id: string; name: string; section: Section | null; role_id: string; photoUrl: string | null };

export const STAGE_SELECT = "id, job_id, position, key, label, section, est_hours, due_date, status, started_at, done_at, done_by, heads_up_sent_at, late_notified_at";
const VEHICLE_SELECT = "kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, colour, model_year, photo_path, make:vehicle_makes(name), model:vehicle_models(name)";
export type Vehicle = { kind?: "car" | "loose" | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; colour: string | null; model_year: number | null; photo_path: string | null; make: { name: string } | null; model: { name: string } | null };
export type BodyshopJobRow = { id: string; job_number: string; status: string; stage: string; is_open: boolean; department: string | null; customer_id: string; vehicle_id: string; gated_in_by: string | null; gated_in_at: string; promised_at: string | null; booked_at: string | null; booked_arrival_at: string | null; bodyshop_started_at: string | null; bodyshop_handover_token: string | null; bodyshop_after_photo_id: string | null; final_check_appointment_id: string | null; gated_out_at: string | null; vehicle: Vehicle | null };
export const JOB_SELECT = `id, job_number, status, stage, is_open, department, customer_id, vehicle_id, gated_in_by, gated_in_at, promised_at, booked_at, booked_arrival_at, bodyshop_started_at, bodyshop_handover_token, bodyshop_after_photo_id, final_check_appointment_id, gated_out_at, vehicle:vehicles(${VEHICLE_SELECT})`;

export const carText = (v: Vehicle | null | undefined) => (v ? `${[v.make?.name, v.model?.name].filter(Boolean).join(" ")}${v.has_plate ? ` (${formatPlate(v)})` : ""}` : "the car");
export const shortCar = (v: Vehicle | null | undefined) => (v ? [v.make?.name, v.model?.name].filter(Boolean).join(" ") || formatPlate(v) : "Car");

const toStage = (r: Record<string, unknown>): StageRow => ({ ...(r as unknown as StageRow), position: Number(r.position), est_hours: Number(r.est_hours) || 0 });

/** The bodyshop managers (workshop managers of a bodyshop department), the leaders by section, and everyone who works there. */
export async function bodyshopPeople(): Promise<{ managers: Person[]; leaders: Person[]; staff: Person[]; all: Person[] }> {
  const admin = createAdminClient();
  const { data } = await admin.from("staff").select("id, display_name, role_id, department_id, photo_path").eq("is_active", true).in("department_id", ["bodyshop", "paint", "ppf_tint", "detailing"]).order("display_name");
  const rows = data ?? [];
  const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
  const { data: signed } = paths.length ? await admin.storage.from("staff-photos").createSignedUrls(paths, 3600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlOf = new Map((signed ?? []).filter((s) => s.path).map((s) => [s.path as string, s.signedUrl]));
  const all: Person[] = rows.map((r) => ({ id: r.id, name: r.display_name, section: sectionOfDepartment(r.department_id), role_id: r.role_id, photoUrl: r.photo_path ? (urlOf.get(r.photo_path) ?? null) : null }));
  return { managers: all.filter((p) => p.role_id === "workshop_manager"), leaders: all.filter((p) => p.role_id === "team_leader"), staff: all.filter((p) => p.role_id === "technician" || p.role_id === "team_leader"), all };
}
const idsOf = (ps: Person[]) => ps.map((p) => p.id);
/**
 * Everyone to tell about a car: the bodyshop managers and the advisors in charge; the leaders of the sections the car
 * goes through only when `withLeaders` (their own sign-off) - car-wide news is not theirs (B2).
 */
export async function involvedIds(jobId: string, sections: string[], advisorId: string | null, withLeaders = false) {
  const { managers, leaders } = await bodyshopPeople();
  const secs = new Set(sections);
  const advisors = await jobAdvisorIds(jobId);
  return Array.from(new Set([...idsOf(managers), ...(withLeaders ? idsOf(leaders.filter((l) => l.section && secs.has(l.section))) : []), ...advisors, ...(advisorId && !advisors.length ? [advisorId] : [])]));
}

/** The approved packages on the car: kinds, and the film or tint details written on the lines. */
export async function approvedKinds(jobId: string): Promise<{ kinds: string[]; lines: QuoteLine[]; film: { colour: string | null; code: string | null } | null; tintPercent: number | null; quotationId: string | null }> {
  const admin = createAdminClient();
  const quotes = await approvedQuotations(jobId);
  if (!quotes.length) return { kinds: [], lines: [], film: null, tintPercent: null, quotationId: null };
  const { data: lineRows } = await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", quotes.map((q) => q.id)).eq("is_active", true);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isUnchosen(l));
  const serviceIds = Array.from(new Set(lines.map((l) => l.service_id).filter((x): x is string => !!x)));
  const { data: svcs } = serviceIds.length ? await admin.from("services").select("id, bodyshop_kind, department").in("id", serviceIds) : { data: [] as { id: string; bodyshop_kind: string | null; department: string | null }[] };
  const svcOf = new Map((svcs ?? []).map((s) => [s.id as string, s]));
  let kinds = Array.from(new Set(lines.flatMap((l) => kindsOfLine(l as unknown as SideLine, l.service_id ? svcOf.get(l.service_id) : null))));
  // A bodyshop job's own work (labour or a service with no package kind behind it) still runs through stages.
  if (!kinds.length && lines.some((l) => l.line_type === "labour" || l.line_type === "package" || l.line_type === "other")) {
    const { data: j } = await admin.from("jobs").select("department").eq("id", jobId).maybeSingle();
    if (j?.department === "bodyshop") kinds = ["other"];
  }
  const filmLine = lines.find((l) => l.film_colour || l.film_code);
  const tintLine = lines.find((l) => l.tint_percent);
  return { kinds, lines, film: filmLine ? { colour: filmLine.film_colour ?? null, code: filmLine.film_code ?? null } : null, tintPercent: tintLine?.tint_percent ?? null, quotationId: quotes[0].id };
}

export async function loadStages(jobId: string): Promise<StageRow[]> {
  const { data } = await createAdminClient().from("bodyshop_stages").select(STAGE_SELECT).eq("job_id", jobId).eq("is_active", true).order("position");
  return ((data ?? []) as Record<string, unknown>[]).map(toStage);
}
export const currentStage = (stages: StageRow[]) => stages.find((s) => s.status === "active") ?? stages.find((s) => s.status === "pending") ?? null;
export const nextStageAfter = (stages: StageRow[], s: StageRow) => stages.find((x) => x.position > s.position && x.status !== "done" && x.status !== "skipped") ?? null;

/** Minutes clocked on a car, open clockings counted to now. */
export function clockedMinutes(rows: { started_at: string; ended_at: string | null; minutes: number | null }[], now = Date.now(), wt: WorkingTime | null = null) {
  // A running clocking counts opening hours only (break left out) when the hours are known; closed ones keep their minutes.
  return rows.reduce((a, c) => a + (c.minutes !== null ? c.minutes : c.ended_at ? 0 : wt ? countedMinutes(c.started_at, now, wt) : Math.max(0, Math.round((now - Date.parse(c.started_at)) / 60000))), 0);
}

export type BodyshopJob = {
  job: BodyshopJobRow;
  customer: { full_name: string; company_name: string | null; phone: string | null } | null;
  stages: StageRow[];
  assignments: AssignmentRow[];
  clockings: ClockingRow[];
  signoffs: SignoffRow[];
  removedItems: RemovedItemRow[];
  updates: UpdateRow[];
  kinds: string[];
  film: { colour: string | null; code: string | null } | null;
  tintPercent: number | null;
  quotationId: string | null;
  needed: SignoffKey[];
  waitingOn: SignoffKey[];
  minutes: number;
  people: { managers: Person[]; leaders: Person[]; staff: Person[]; all: Person[] };
  advisorName: string | null;
};

export async function loadBodyshopJob(jobId: string): Promise<BodyshopJob | null> {
  const admin = createAdminClient();
  const { data: jobRaw } = await admin.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!jobRaw) return null;
  const job = jobRaw as unknown as BodyshopJobRow;
  const [stages, { data: asg }, { data: clk }, { data: sig }, { data: rem }, { data: upd }, approved, people, { data: customer }, { data: advisor }] = await Promise.all([
    loadStages(jobId),
    admin.from("bodyshop_assignments").select("id, job_id, staff_id, section, assigned_at, staff:staff!bodyshop_assignments_staff_id_fkey(display_name, photo_path)").eq("job_id", jobId).is("removed_at", null).eq("is_active", true).order("assigned_at"),
    admin.from("bodyshop_clockings").select("id, job_id, stage_id, staff_id, started_at, ended_at, minutes, staff:staff!bodyshop_clockings_staff_id_fkey(display_name)").eq("job_id", jobId).eq("is_active", true).order("started_at"),
    admin.from("bodyshop_signoffs").select("id, job_id, role_key, staff_id, signed_at, on_behalf, staff:staff!bodyshop_signoffs_staff_id_fkey(display_name)").eq("job_id", jobId).eq("is_active", true),
    admin.from("bodyshop_removed_items").select("id, job_id, label, photo_path, removed_at, refitted_at").eq("job_id", jobId).eq("is_active", true).order("removed_at"),
    admin.from("bodyshop_updates").select("id, job_id, kind, photo_id, token, sent_at").eq("job_id", jobId).eq("is_active", true),
    approvedKinds(jobId),
    bodyshopPeople(),
    admin.from("customers").select("full_name, company_name, phone").eq("id", job.customer_id).maybeSingle(),
    job.gated_in_by ? admin.from("staff").select("display_name").eq("id", job.gated_in_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const photoPaths = (asg ?? []).map((a) => (a.staff as unknown as { photo_path: string | null } | null)?.photo_path).filter((p): p is string => !!p);
  const { data: signed } = photoPaths.length ? await admin.storage.from("staff-photos").createSignedUrls(Array.from(new Set(photoPaths)), 3600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlOf = new Map((signed ?? []).filter((s) => s.path).map((s) => [s.path as string, s.signedUrl]));
  const sections = stages.map((s) => s.section);
  const needed = neededSignoffs(sections);
  const signoffs: SignoffRow[] = (sig ?? []).map((s) => ({ id: s.id, job_id: s.job_id, role_key: s.role_key as SignoffKey, staff_id: s.staff_id, signed_at: s.signed_at, on_behalf: !!s.on_behalf, name: (s.staff as unknown as { display_name: string } | null)?.display_name ?? "" }));
  return {
    job,
    customer: (customer as { full_name: string; company_name: string | null; phone: string | null } | null) ?? null,
    stages,
    assignments: (asg ?? []).map((a) => ({ id: a.id, job_id: a.job_id, staff_id: a.staff_id, section: a.section, assigned_at: a.assigned_at, name: (a.staff as unknown as { display_name: string } | null)?.display_name ?? "", photoUrl: (a.staff as unknown as { photo_path: string | null } | null)?.photo_path ? (urlOf.get((a.staff as unknown as { photo_path: string }).photo_path) ?? null) : null })),
    clockings: (clk ?? []).map((c) => ({ id: c.id, job_id: c.job_id, stage_id: c.stage_id, staff_id: c.staff_id, started_at: c.started_at, ended_at: c.ended_at, minutes: c.minutes === null ? null : Number(c.minutes), name: (c.staff as unknown as { display_name: string } | null)?.display_name ?? "" })),
    signoffs,
    removedItems: (rem ?? []) as RemovedItemRow[],
    updates: (upd ?? []) as UpdateRow[],
    kinds: approved.kinds,
    film: approved.film,
    tintPercent: approved.tintPercent,
    quotationId: approved.quotationId,
    needed,
    waitingOn: needed.filter((k) => !signoffs.some((s) => s.role_key === k)),
    minutes: clockedMinutes(clk ?? [], Date.now(), workingTimeOf(await getSettings(), "bodyshop")),
    people,
    advisorName: (advisor as { display_name: string } | null)?.display_name ?? null,
  };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Before the car arrives                                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

/** A bodyshop quotation before the car arrives: a booked job (closed until gate-in) and its draft quotation. */
export async function createBodyshopJob(customerId: string, vehicleId: string, actor: Actor, settings: Settings): Promise<{ error?: string; jobId?: string; quotationId?: string }> {
  const admin = createAdminClient();
  const { data: vehicle } = await admin.from("vehicles").select("id, customer_id").eq("id", vehicleId).maybeSingle();
  if (!vehicle || vehicle.customer_id !== customerId) return { error: "That car does not belong to the chosen customer." };
  const { data: open } = await admin.from("jobs").select("id, job_number, status").eq("vehicle_id", vehicleId).or("is_open.eq.true,status.eq.booked").maybeSingle();
  if (open) return { error: `This car already has ${open.status === "booked" ? "a booked quotation" : "an open job"} (${open.job_number}).` };
  const now = new Date().toISOString();
  const { data: job, error } = await admin.from("jobs").insert({ vehicle_id: vehicleId, customer_id: customerId, status: "booked", stage: "quote", is_open: false, department: "bodyshop", priority: "normal", gated_in_by: actor.id, advisor_id: actor.id, gated_in_at: now, booked_at: now, bodyshop_handover_token: randomBytes(18).toString("hex"), created_by: actor.id, updated_by: actor.id }).select("id, job_number").single();
  if (error || !job) return { error: error?.message ?? "Could not create the booking." };
  const { data: q, error: qErr } = await admin.from("quotations").insert({ kind: "quotation", job_id: job.id, customer_id: customerId, vehicle_id: vehicleId, validity_days: Number(settings.quote_validity_days) || 7, vat_percent: 5, created_by: actor.id, updated_by: actor.id }).select("id, number").single();
  if (qErr || !q) return { error: qErr?.message ?? "Could not start the quotation." };
  await admin.from("job_events").insert({ job_id: job.id, event_type: "bodyshop_booked", note: `Bodyshop quotation ${q.number} started before the car arrived (${actor.display_name})`, created_by: actor.id });
  return { jobId: job.id, quotationId: q.id };
}

/** The arrival and the promised handover: on the job and on the calendar (a car drop for the bodyshop). */
export async function bookArrival(jobId: string, arrivalIso: string, promisedDate: string, actor: Actor): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job) return { error: "Job not found." };
  await admin.from("jobs").update({ booked_arrival_at: arrivalIso, promised_at: promisedDate, updated_by: actor.id }).eq("id", jobId);
  const { kinds } = await approvedKinds(jobId);
  const reason = `Bodyshop: ${kinds.length ? kinds.map((k) => stageLabelFor(k, kinds)).join(", ").replace(/install/g, "").trim() : "booked work"}`.slice(0, 120);
  const { data: existing } = await admin.from("appointments").select("id").eq("job_id", jobId).eq("kind", "car_drop").in("status", ["booked"]).maybeSingle();
  if (existing) await admin.from("appointments").update({ starts_at: arrivalIso, reason, updated_by: actor.id }).eq("id", existing.id);
  else await admin.from("appointments").insert({ kind: "car_drop", department: "bodyshop", customer_id: job.customer_id, vehicle_id: job.vehicle_id, job_id: jobId, reason, starts_at: arrivalIso, duration_minutes: 30, advisor_id: actor.id, created_by: actor.id, updated_by: actor.id });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_booked", note: `Arrival ${formatDate(arrivalIso)}, handover promised ${formatDate(promisedDate)} (${actor.display_name})`, created_by: actor.id });
  if (job.promised_at && job.promised_at !== promisedDate && job.status !== "booked") await tellHandoverMoved(jobId, promisedDate, actor);
  return {};
}

/** "Request deposit": a proforma for part of the approved quotation; it is folded into the final proforma later. */
export async function requestDeposit(jobId: string, amount: number, actor: Actor, settings: Settings): Promise<{ error?: string; number?: string; token?: string }> {
  const admin = createAdminClient();
  const quotes = await approvedQuotations(jobId);
  const q = quotes[0];
  if (!q) return { error: "The quotation is not approved yet." };
  if (!(amount > 0)) return { error: "Enter the deposit amount." };
  if (amount > q.total_aed) return { error: "The deposit cannot be more than the quotation." };
  const job = await jobRow(jobId);
  if (!job) return { error: "Job not found." };
  const { data: existing } = await admin.from("invoices").select(INVOICE_SELECT).eq("job_id", jobId).eq("kind", "proforma").eq("status", "issued").eq("is_active", true).is("converted_to", null).not("deposit_for_quotation_id", "is", null).maybeSingle();
  if (existing) {
    const inv = toInvoice(existing as Record<string, unknown>);
    return { number: inv.number, token: inv.token ?? undefined };
  }
  const [{ data: customer }] = await Promise.all([admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", job.customer_id).maybeSingle()]);
  const v = job.vehicle;
  const net = round2(amount / 1.05);
  const vat = round2(amount - net);
  const number = await nextDocumentNumber("proforma", settings);
  const token = newToken();
  const { data: inv, error } = await admin.from("invoices").insert({ number, kind: "proforma", job_id: jobId, customer_id: job.customer_id, vehicle_id: job.vehicle_id, token, labour_mode: "itemised", subtotal_aed: net, discount_aed: 0, taxable_aed: net, vat_aed: vat, total_aed: amount, agreed_total_aed: null, warranty_credit_aed: 0, discount_note: null, deposit_for_quotation_id: q.id, issue_reason: "Deposit", prepared_by: actor.id, issued_by: actor.id, customer_snapshot: customer ?? null, vehicle_snapshot: v ? { title: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" "), variant: null, plate: formatPlate(v), vin: v.vin } : null, created_by: actor.id, updated_by: actor.id }).select("id, number, token").single();
  if (error || !inv) return { error: error?.message ?? "Could not prepare the deposit proforma." };
  await admin.from("invoice_lines").insert({ invoice_id: inv.id, position: 0, section: "fees", description: `Deposit on quotation ${q.number}`, details: `Deducted from the final invoice (quotation total AED ${q.total_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })})`, part_number: null, quantity: 1, unit_price: net, amount_aed: net, vat_aed: vat, total_aed: amount, cost_aed: null });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "proforma_issued", note: `Deposit proforma ${number} for AED ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })} (${actor.display_name})`, created_by: actor.id });
  return { number: inv.number, token: inv.token };
}

/** Called when the final proforma is prepared: a deposit proforma folds into it and its payments move across. */
export async function foldDepositProforma(jobId: string, finalInvoiceId: string, by: string | null) {
  const admin = createAdminClient();
  const { data: deposits } = await admin.from("invoices").select("id").eq("job_id", jobId).eq("kind", "proforma").eq("is_active", true).is("converted_to", null).not("deposit_for_quotation_id", "is", null).neq("id", finalInvoiceId);
  for (const d of deposits ?? []) {
    await admin.from("payments").update({ invoice_id: finalInvoiceId, updated_by: by }).eq("invoice_id", d.id).eq("is_active", true);
    await admin.from("invoices").update({ converted_to: finalInvoiceId, updated_by: by }).eq("id", d.id);
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Gate-in: the booked job opens                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

/** The booked job behind a calendar appointment, if the car was quoted before it arrived. */
export async function bookedJobOf(appointmentId: string | null, vehicleId: string): Promise<{ id: string; job_number: string } | null> {
  const admin = createAdminClient();
  if (appointmentId) {
    const { data: appt } = await admin.from("appointments").select("job_id").eq("id", appointmentId).maybeSingle();
    if (appt?.job_id) {
      const { data: j } = await admin.from("jobs").select("id, job_number, status").eq("id", appt.job_id).eq("status", "booked").maybeSingle();
      if (j) return { id: j.id, job_number: j.job_number };
    }
  }
  const { data: j } = await admin.from("jobs").select("id, job_number").eq("vehicle_id", vehicleId).eq("status", "booked").order("booked_at", { ascending: false }).limit(1).maybeSingle();
  return j ? { id: j.id, job_number: j.job_number } : null;
}

/**
 * The gate-in is complete on a bodyshop car with an approved quotation: the stages are built from the packages,
 * their due dates spread back from the promised handover, the first stage goes active and its section is told.
 */
export async function startBodyshopWork(jobId: string, actor: Actor | null, settings: Settings, opts: { start?: string | null; keepStatus?: boolean } = {}): Promise<{ error?: string; started?: boolean }> {
  const admin = createAdminClient();
  const { data: jobRaw } = await admin.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  const job = jobRaw as unknown as BodyshopJobRow | null;
  if (!job || !job.is_open) return { error: "This job is not open." };
  if (job.bodyshop_started_at) return { started: false };
  const { kinds } = await approvedKinds(jobId);
  if (!kinds.length) return { error: "No approved bodyshop packages on this car yet." };
  const keys = stageKeysFor(kinds);
  const defs = keys.map((k) => stageDef(k)!).filter(Boolean);
  // The start day picked at the release spreads the due dates (today when started from the gate-in).
  const today = opts.start && opts.start > dubaiDate() ? opts.start : dubaiDate();
  const workingDays = (settings.working_days ?? []) as string[];
  const totalHours = defs.reduce((a, d) => a + d.hours, 0);
  const promised = job.promised_at && job.promised_at >= today ? job.promised_at : addDaysIso(today, Math.max(1, Math.ceil(totalHours / 8) + 1));
  const dues = spreadDueDates(defs.map((d) => d.hours), today, promised, workingDays);
  const now = new Date().toISOString();
  const rows = defs.map((d, i) => ({ job_id: jobId, position: i + 1, key: d.key, label: stageLabelFor(d.key, kinds), section: d.section, est_hours: d.hours, due_date: dues[i], status: i === 0 ? "active" : "pending", started_at: i === 0 ? now : null, created_by: actor?.id ?? null, updated_by: actor?.id ?? null }));
  await admin.from("bodyshop_stages").insert(rows);
  // The job's status moves to In work only from before the work; a car already in work, or a mixed car whose
  // mechanical side is still in planning, keeps its status and its clocks.
  const keep = !!opts.keepStatus || !["gate_in_pending", "pending_approval", "approved", "waiting_parts", "booked"].includes(job.status);
  const route = defs.map((d) => stageLabelFor(d.key, kinds)).join(" → ");
  if (keep) {
    await admin.from("jobs").update({ bodyshop_started_at: now, promised_at: promised, bodyshop_handover_token: job.bodyshop_handover_token ?? randomBytes(18).toString("hex"), updated_by: actor?.id ?? null }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "planning", note: `Bodyshop stages started: ${route}; handover ${formatDate(promised)}${actor ? ` (${actor.display_name})` : ""}`, created_by: actor?.id ?? null });
  } else {
    await admin.from("jobs").update({ status: "in_work", stage: "work", stage_entered_at: now, bodyshop_started_at: now, work_started_at: now, promised_at: promised, bodyshop_handover_token: job.bodyshop_handover_token ?? randomBytes(18).toString("hex"), updated_by: actor?.id ?? null }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: job.status, to_status: "in_work", note: `Bodyshop work started: ${route}; handover ${formatDate(promised)}${actor ? ` (${actor.display_name})` : ""}`, created_by: actor?.id ?? null });
  }
  const stages = await loadStages(jobId);
  const first = stages[0];
  if (first) await tellSection(job, first, `${shortCar(job.vehicle)} is in: ${first.label} first, due ${formatDate(first.due_date)}.`);
  const next = stages[1];
  if (next && first) await headsUp(job, first, next);
  return { started: true };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Stages                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

async function jobRow(jobId: string): Promise<BodyshopJobRow | null> {
  const { data } = await createAdminClient().from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  return (data as unknown as BodyshopJobRow) ?? null;
}
async function leaderIdsOf(section: StageSection) {
  const { leaders, managers } = await bodyshopPeople();
  if (section === "strip_refit" || section === "qc" || section === "handover") return idsOf(managers);
  if (section === "electrical") {
    const { data } = await createAdminClient().from("staff").select("id").eq("role_id", "workshop_manager").eq("department_id", "mechanical").eq("is_active", true);
    return (data ?? []).map((d) => d.id as string);
  }
  return idsOf(leaders.filter((l) => l.section === section));
}
/** A section is told a stage of theirs is on. */
async function tellSection(job: BodyshopJobRow, stage: StageRow, body: string) {
  await notifyStaff(await leaderIdsOf(stage.section), { type: stage.section === "electrical" ? "bodyshop_electrical" : "bodyshop_heads_up", title: `${stage.label} · ${shortCar(job.vehicle)}`, body, jobId: job.id, href: stage.section === "electrical" ? "/assign" : `/bodyshop/${job.id}` });
}
/** One stage early: "G63 coming to PPF after prep, about 2 h." */
async function headsUp(job: BodyshopJobRow, current: StageRow, next: StageRow) {
  if (next.heads_up_sent_at) return;
  const admin = createAdminClient();
  await admin.from("bodyshop_stages").update({ heads_up_sent_at: new Date().toISOString() }).eq("id", next.id);
  const h = current.est_hours ? `, about ${current.est_hours % 1 === 0 ? current.est_hours : current.est_hours.toFixed(1)} h` : "";
  await notifyStaff(await leaderIdsOf(next.section), { type: "bodyshop_heads_up", title: `${shortCar(job.vehicle)} coming to ${next.label}`, body: `${shortCar(job.vehicle)} coming to ${next.label.toLowerCase()} after ${current.label.toLowerCase()}${h}. Due ${formatDate(next.due_date)}.`, jobId: job.id, href: `/bodyshop/${job.id}` });
}

/** A stage is done: the next one goes active, its section is told, and the one after it gets the heads-up. QC done puts the car at Ready. */
export async function setStageDone(stageId: string, actor: Actor, settings: Settings): Promise<{ error?: string; ok?: boolean }> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("bodyshop_stages").select(STAGE_SELECT).eq("id", stageId).maybeSingle();
  if (!raw) return { error: "Stage not found." };
  const stage = toStage(raw as Record<string, unknown>);
  if (stage.status === "done") return { ok: true };
  const job = await jobRow(stage.job_id);
  if (!job) return { error: "Job not found." };
  if (stage.key === "refit") {
    const { data: items } = await admin.from("bodyshop_removed_items").select("id, label").eq("job_id", job.id).eq("is_active", true).is("refitted_at", null);
    if ((items ?? []).length) return { error: `${(items ?? []).length} removed item${(items ?? []).length === 1 ? " is" : "s are"} not ticked back on yet: ${(items ?? []).map((i) => i.label).join(", ")}.` };
  }
  // Section 12: the warranty details are written at the end of the stage that fitted them; QC confirms the set.
  if (["ppf", "tint", "detail", "clean", "qc"].includes(stage.key)) {
    const card = await warrantyCardOf(job.id, settings);
    if (card?.rows.length) {
      if (stage.key === "qc") {
        if (card.missing.length) return { error: `Warranty details missing: ${card.missing.join(", ")}.` };
        if (!card.confirmedAt) return { error: 'QC ticks "Warranty details complete" before QC is done.' };
      } else {
        const all = await loadStages(job.id);
        const miss = stageAsks(stage, all.map((s) => s.key), card.rows).flatMap((r) => rowMissing(r).map((m) => `${r.product === "ppf" ? "PPF" : r.product === "tint" ? "tint" : "ceramic"} ${m}`));
        if (miss.length) return { error: `Before ${stage.label} is done, write down the warranty details: ${miss.join(", ")}.` };
      }
    }
  }
  const now = new Date().toISOString();
  await admin.from("bodyshop_stages").update({ status: "done", done_at: now, done_by: actor.id, updated_by: actor.id }).eq("id", stageId);
  // Open clockings on this stage end with it.
  const { data: open } = await admin.from("bodyshop_clockings").select("id, started_at").eq("stage_id", stageId).is("ended_at", null);
  for (const c of open ?? []) await admin.from("bodyshop_clockings").update({ ended_at: now, minutes: Math.max(1, Math.round((Date.parse(now) - Date.parse(c.started_at)) / 60000)), updated_by: actor.id }).eq("id", c.id);
  const stages = await loadStages(job.id);
  const next = nextStageAfter(stages, stage);
  await admin.from("job_events").insert({ job_id: job.id, event_type: "bodyshop_stage", note: `${stage.label} done by ${actor.display_name}${next ? `; next ${next.label}` : ""}`, created_by: actor.id });
  if (next && next.key !== "handover") {
    await admin.from("bodyshop_stages").update({ status: "active", started_at: next.started_at ?? now, updated_by: actor.id }).eq("id", next.id);
    await tellSection(job, next, `${shortCar(job.vehicle)} is with you now: ${next.label}, due ${formatDate(next.due_date)}.`);
    const after = nextStageAfter(stages, next);
    if (after && after.key !== "handover") await headsUp(job, next, after);
  }
  // The work is finished when QC is done (or nothing but the handover is left): the car is Ready and the proforma prepares itself.
  const left = stages.filter((s) => s.id !== stageId && s.status !== "done" && s.status !== "skipped" && s.key !== "handover");
  // A mixed car: the bodyshop finishing never moves the job to Ready on its own; the mechanical side carries the car
  // through its own QC and wash. The release sign-off is still asked now.
  const mixed = job.department === "both" && (await workSidesOf(job.id, job.department)).includes("mechanical");
  if (!left.length && mixed) {
    const handover = stages.find((s) => s.key === "handover");
    if (handover && handover.status === "pending") await admin.from("bodyshop_stages").update({ status: "active", started_at: now, updated_by: actor.id }).eq("id", handover.id);
    await admin.from("job_events").insert({ job_id: job.id, event_type: "bodyshop_stage", note: `Bodyshop side complete (${actor.display_name}); the mechanical side takes the car through QC to Ready`, created_by: actor.id });
    const needed = neededSignoffs(stages.map((s) => s.section));
    await notifyStaff(await involvedIds(job.id, stages.map((s) => s.section), job.gated_in_by, true), { type: "bodyshop_signoff", title: `Sign-off needed · ${shortCar(job.vehicle)}`, body: `The bodyshop work is complete; the mechanical work carries on. Sign the release: ${needed.map((k) => ({ manager: "bodyshop manager", ppf: "PPF leader", detailing: "detailing leader", paint: "paint leader" })[k]).join(", ")}.`, jobId: job.id, href: `/bodyshop/${job.id}#signoff` });
  }
  if (!left.length && job.status === "in_work" && !mixed) {
    await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now, updated_by: actor.id }).eq("id", job.id);
    await admin.from("job_events").insert({ job_id: job.id, event_type: "status_change", from_status: "in_work", to_status: "ready", note: `Bodyshop work complete (${actor.display_name}); waiting for the release sign-off`, created_by: actor.id });
    try {
      await ensureProforma(job.id, { id: actor.id, display_name: actor.display_name }, settings);
    } catch {
      /* no approved lines to invoice yet: the advisor prepares it */
    }
    const handover = stages.find((s) => s.key === "handover");
    if (handover) await admin.from("bodyshop_stages").update({ status: "active", started_at: now, updated_by: actor.id }).eq("id", handover.id);
    const needed = neededSignoffs(stages.map((s) => s.section));
    await notifyStaff(await involvedIds(job.id, stages.map((s) => s.section), job.gated_in_by, true), { type: "bodyshop_signoff", title: `Sign-off needed · ${shortCar(job.vehicle)}`, body: `The work is complete. Sign the release: ${needed.map((k) => ({ manager: "bodyshop manager", ppf: "PPF leader", detailing: "detailing leader", paint: "paint leader" })[k]).join(", ")}. Handover ${formatDate(job.promised_at)}.`, jobId: job.id, href: `/bodyshop/${job.id}#signoff` });
  }
  return { ok: true };
}

export async function reopenStage(stageId: string, actor: Actor): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("bodyshop_stages").select(STAGE_SELECT).eq("id", stageId).maybeSingle();
  if (!raw) return { error: "Stage not found." };
  const stage = toStage(raw as Record<string, unknown>);
  await admin.from("bodyshop_stages").update({ status: "active", done_at: null, done_by: null, started_at: stage.started_at ?? new Date().toISOString(), updated_by: actor.id }).eq("id", stageId);
  const job = await jobRow(stage.job_id);
  if (job && job.status === "ready") await admin.from("jobs").update({ status: "in_work", stage: "work", updated_by: actor.id }).eq("id", job.id);
  await admin.from("job_events").insert({ job_id: stage.job_id, event_type: "bodyshop_stage", note: `${stage.label} reopened by ${actor.display_name}`, created_by: actor.id });
  return {};
}

export async function setStageDue(stageId: string, date: string, actor: Actor): Promise<{ error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date." };
  const admin = createAdminClient();
  const { data: raw } = await admin.from("bodyshop_stages").select(STAGE_SELECT).eq("id", stageId).maybeSingle();
  if (!raw) return { error: "Stage not found." };
  const stage = toStage(raw as Record<string, unknown>);
  await admin.from("bodyshop_stages").update({ due_date: date, updated_by: actor.id }).eq("id", stageId);
  if (stage.key === "handover") {
    const job = await jobRow(stage.job_id);
    if (job && job.promised_at !== date) {
      await admin.from("jobs").update({ promised_at: date, updated_by: actor.id }).eq("id", job.id);
      await tellHandoverMoved(job.id, date, actor);
    }
  }
  await admin.from("job_events").insert({ job_id: stage.job_id, event_type: "bodyshop_stage", note: `${stage.label} due ${formatDate(date)} (${actor.display_name})`, created_by: actor.id });
  return {};
}

export async function addStage(jobId: string, key: string | null, custom: { label: string; section: StageSection } | null, actor: Actor): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const def = key ? stageDef(key) : null;
  const label = def?.label ?? custom?.label?.trim();
  const section = def?.section ?? custom?.section;
  if (!label || !section) return { error: "Choose a stage, or type its name and pick the team." };
  const stages = await loadStages(jobId);
  const handover = stages.find((s) => s.key === "handover");
  const position = handover ? handover.position : (stages.at(-1)?.position ?? 0) + 1;
  if (handover) await admin.from("bodyshop_stages").update({ position: handover.position + 1, updated_by: actor.id }).eq("id", handover.id);
  const prev = stages.filter((s) => s.position < position).at(-1);
  await admin.from("bodyshop_stages").insert({ job_id: jobId, position, key: def?.key ?? `custom_${Date.now()}`, label, section, est_hours: def?.hours ?? 2, due_date: prev?.due_date ?? handover?.due_date ?? null, status: stages.some((s) => s.status === "active" || s.status === "pending") ? "pending" : "active", created_by: actor.id, updated_by: actor.id });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_stage", note: `Stage ${label} added by ${actor.display_name}`, created_by: actor.id });
  return {};
}

export async function removeStage(stageId: string, actor: Actor): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("bodyshop_stages").select(STAGE_SELECT).eq("id", stageId).maybeSingle();
  if (!raw) return { error: "Stage not found." };
  const stage = toStage(raw as Record<string, unknown>);
  if (stage.key === "handover") return { error: "The handover stays." };
  await admin.from("bodyshop_stages").update({ status: "skipped", is_active: false, updated_by: actor.id }).eq("id", stageId);
  const stages = await loadStages(stage.job_id);
  if (stage.status === "active") {
    const next = stages.find((s) => s.status === "pending");
    if (next) await admin.from("bodyshop_stages").update({ status: "active", started_at: new Date().toISOString(), updated_by: actor.id }).eq("id", next.id);
  }
  await admin.from("job_events").insert({ job_id: stage.job_id, event_type: "bodyshop_stage", note: `Stage ${stage.label} removed by ${actor.display_name}`, created_by: actor.id });
  return {};
}

export async function moveStage(stageId: string, direction: -1 | 1, actor: Actor): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("bodyshop_stages").select(STAGE_SELECT).eq("id", stageId).maybeSingle();
  if (!raw) return { error: "Stage not found." };
  const stage = toStage(raw as Record<string, unknown>);
  const stages = await loadStages(stage.job_id);
  const i = stages.findIndex((s) => s.id === stageId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= stages.length) return {};
  const other = stages[j];
  if (other.key === "handover" || stage.key === "handover") return { error: "The handover stays last." };
  await admin.from("bodyshop_stages").update({ position: other.position, updated_by: actor.id }).eq("id", stage.id);
  await admin.from("bodyshop_stages").update({ position: stage.position, updated_by: actor.id }).eq("id", other.id);
  return {};
}

/** A stage ran late: every later due date and the handover move by the same days, and the manager and advisor are told. */
export async function shiftAfterLateStage(stage: StageRow, daysLate: number, settings: Settings) {
  const admin = createAdminClient();
  const job = await jobRow(stage.job_id);
  if (!job || daysLate <= 0) return;
  const stages = await loadStages(job.id);
  const workingDays = (settings.working_days ?? []) as string[];
  const shift = (d: string) => {
    let out = d;
    for (let n = 0; n < daysLate; n++) {
      out = addDaysIso(out, 1);
      while (workingDaysBetween(out, out, workingDays)[0] !== out) out = addDaysIso(out, 1);
    }
    return out;
  };
  for (const s of stages) if (s.position >= stage.position && s.due_date && s.status !== "done") await admin.from("bodyshop_stages").update({ due_date: shift(s.due_date) }).eq("id", s.id);
  const newPromised = job.promised_at ? shift(job.promised_at) : null;
  if (newPromised) await admin.from("jobs").update({ promised_at: newPromised }).eq("id", job.id);
  await admin.from("bodyshop_stages").update({ late_notified_at: new Date().toISOString() }).eq("id", stage.id);
  const { managers } = await bodyshopPeople();
  const ids = Array.from(new Set([...idsOf(managers), ...(job.gated_in_by ? [job.gated_in_by] : [])]));
  if (stage.status === "active") ids.push(...(await leaderIdsOf(stage.section)).filter((x) => !ids.includes(x)));
  await notifyStaff(ids, { type: "bodyshop_late", title: `${shortCar(job.vehicle)} ${stage.label} late by ${daysLate} day${daysLate === 1 ? "" : "s"}`, body: `Handover now ${formatDate(newPromised ?? job.promised_at)}.`, jobId: job.id, href: `/bodyshop/${job.id}` });
  await admin.from("job_events").insert({ job_id: job.id, event_type: "bodyshop_late", note: `${stage.label} late by ${daysLate} day${daysLate === 1 ? "" : "s"}; handover moved to ${formatDate(newPromised ?? job.promised_at)}`, created_by: null });
  if (newPromised) await tellHandoverMoved(job.id, newPromised, null, true);
}

/** The handover date changed: everyone involved is told at once. */
export async function tellHandoverMoved(jobId: string, date: string, actor: Actor | null, quiet = false) {
  const job = await jobRow(jobId);
  if (!job) return;
  const stages = await loadStages(jobId);
  const ids = await involvedIds(jobId, stages.map((s) => s.section), job.gated_in_by);
  await notifyStaff(ids.filter((id) => id !== actor?.id), { type: "bodyshop_handover_moved", title: `${shortCar(job.vehicle)} handover now ${formatDate(date)}`, body: quiet ? "A stage ran late." : `Changed by ${actor?.display_name ?? "the system"}.`, jobId, href: `/bodyshop/${jobId}` });
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Removed items, people, clocking                                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */

export async function addRemovedItem(jobId: string, label: string, photoPath: string | null, actor: Actor) {
  const clean = label.trim().slice(0, 80);
  if (!clean) return { error: "Type what came off." };
  await createAdminClient().from("bodyshop_removed_items").insert({ job_id: jobId, label: clean, photo_path: photoPath, removed_by: actor.id, created_by: actor.id, updated_by: actor.id });
  return {};
}
export async function tickRefitted(itemId: string, on: boolean, actor: Actor) {
  await createAdminClient().from("bodyshop_removed_items").update({ refitted_at: on ? new Date().toISOString() : null, refitted_by: on ? actor.id : null, updated_by: actor.id }).eq("id", itemId);
  return {};
}

export async function assignPerson(jobId: string, staffId: string, actor: Actor): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: s } = await admin.from("staff").select("id, display_name, department_id, team, role_id").eq("id", staffId).eq("is_active", true).maybeSingle();
  if (!s) return { error: "Person not found." };
  const section = SECTION_OF_TEAM[teamOf(s)] ?? sectionOfDepartment(s.department_id);
  if (!section) return { error: `${s.display_name} is not in a bodyshop team.` };
  const { data: existing } = await admin.from("bodyshop_assignments").select("id").eq("job_id", jobId).eq("staff_id", staffId).is("removed_at", null).eq("is_active", true).maybeSingle();
  if (existing) return {};
  await admin.from("bodyshop_assignments").insert({ job_id: jobId, staff_id: staffId, section, assigned_by: actor.id, created_by: actor.id, updated_by: actor.id });
  if (staffId !== actor.id) await notifyStaff([staffId], { type: "bodyshop_heads_up", title: `You are on a car`, body: `${actor.display_name} put you on a car in the bodyshop.`, jobId, href: `/bodyshop/${jobId}` });
  return {};
}
export async function unassignPerson(jobId: string, staffId: string, actor: Actor) {
  await createAdminClient().from("bodyshop_assignments").update({ removed_at: new Date().toISOString(), removed_by: actor.id, updated_by: actor.id }).eq("job_id", jobId).eq("staff_id", staffId).is("removed_at", null);
  return {};
}

/** Clock in on a car (the active stage); any other open clocking of the person ends first. */
export async function clockIn(jobId: string, staffId: string, source: "tablet" | "leader" | "board", by: string | null): Promise<{ error?: string; stage?: string }> {
  const admin = createAdminClient();
  await clockOut(staffId, by);
  const stages = await loadStages(jobId);
  const stage = currentStage(stages);
  await admin.from("bodyshop_clockings").insert({ job_id: jobId, stage_id: stage?.id ?? null, staff_id: staffId, source, created_by: by, updated_by: by });
  // Clocking on counts as being on the car.
  const { data: existing } = await admin.from("bodyshop_assignments").select("id").eq("job_id", jobId).eq("staff_id", staffId).is("removed_at", null).eq("is_active", true).maybeSingle();
  if (!existing) {
    const { data: s } = await admin.from("staff").select("department_id, team").eq("id", staffId).maybeSingle();
    await admin.from("bodyshop_assignments").insert({ job_id: jobId, staff_id: staffId, section: (s ? SECTION_OF_TEAM[teamOf(s)] : null) ?? sectionOfDepartment(s?.department_id) ?? "strip_refit", assigned_by: by, created_by: by, updated_by: by });
  }
  return { stage: stage?.label };
}
export async function clockOut(staffId: string, by: string | null): Promise<{ minutes: number }> {
  const admin = createAdminClient();
  const { data: open } = await admin.from("bodyshop_clockings").select("id, started_at").eq("staff_id", staffId).is("ended_at", null).eq("is_active", true);
  let total = 0;
  const now = new Date();
  const wt = workingTimeOf(await getSettings(), "bodyshop");
  for (const c of open ?? []) {
    const minutes = Math.max(1, countedMinutes(c.started_at, now, wt));
    total += minutes;
    await admin.from("bodyshop_clockings").update({ ended_at: now.toISOString(), minutes, updated_by: by }).eq("id", c.id);
  }
  return { minutes: total };
}
export async function openClockingOf(staffId: string): Promise<{ job_id: string; started_at: string } | null> {
  const { data } = await createAdminClient().from("bodyshop_clockings").select("job_id, started_at").eq("staff_id", staffId).is("ended_at", null).eq("is_active", true).limit(1).maybeSingle();
  return (data as { job_id: string; started_at: string } | null) ?? null;
}

/** The labour cost of a bodyshop car: clocked minutes × each person's hourly rate (by department, else the workshop rate). */
export async function bodyshopLabourCost(jobId: string, settings: Settings): Promise<{ minutes: number; cost: number }> {
  const admin = createAdminClient();
  const { data } = await admin.from("bodyshop_clockings").select("staff_id, started_at, ended_at, minutes, staff:staff!bodyshop_clockings_staff_id_fkey(department_id)").eq("job_id", jobId).eq("is_active", true);
  const byDept = (settings.technician_cost_rate_by_department ?? {}) as Record<string, number>;
  const bodyshopRate = Number(settings.bodyshop_cost_rate_aed) || 0;
  const base = bodyshopRate || Number(settings.technician_cost_rate_aed) || 0;
  let minutes = 0;
  let cost = 0;
  for (const c of data ?? []) {
    const m = clockedMinutes([c]);
    const dept = (c.staff as unknown as { department_id: string | null } | null)?.department_id ?? "";
    const rate = bodyshopRate || Number(byDept[dept] ?? byDept.bodyshop ?? base) || base;
    minutes += m;
    cost += (m / 60) * rate;
  }
  return { minutes, cost: round2(cost) };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Release sign-off                                                                                                */
/* ------------------------------------------------------------------------------------------------------------ */

export async function signoffState(jobId: string) {
  const [stages, { data: sig }] = await Promise.all([loadStages(jobId), createAdminClient().from("bodyshop_signoffs").select("role_key").eq("job_id", jobId).eq("is_active", true)]);
  const needed = neededSignoffs(stages.map((s) => s.section));
  const signed = new Set((sig ?? []).map((s) => s.role_key as SignoffKey));
  return { needed, signed: Array.from(signed), waitingOn: needed.filter((k) => !signed.has(k)), complete: needed.every((k) => signed.has(k)), hasStages: stages.length > 0 };
}

export async function signOff(jobId: string, roleKey: SignoffKey, actor: Actor, onBehalf: boolean): Promise<{ error?: string; complete?: boolean }> {
  const admin = createAdminClient();
  const state = await signoffState(jobId);
  if (!state.needed.includes(roleKey)) return { error: "That sign-off is not needed on this car." };
  if (state.signed.includes(roleKey)) return { complete: state.complete };
  const { data: js } = await admin.from("jobs").select("is_open, status").eq("id", jobId).maybeSingle();
  if (!js?.is_open || !["ready", "pending_payment"].includes(String(js.status))) return { error: "The release is signed when the work is complete and the car is Ready." };
  await admin.from("bodyshop_signoffs").insert({ job_id: jobId, role_key: roleKey, staff_id: actor.id, on_behalf: onBehalf, created_by: actor.id, updated_by: actor.id });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_signoff", note: `Release signed by ${actor.display_name}${onBehalf ? ` on behalf of the ${roleKey === "manager" ? "bodyshop manager" : `${roleKey} leader`}` : ""}`, created_by: actor.id });
  const after = await signoffState(jobId);
  if (after.complete) {
    const job = await jobRow(jobId);
    if (job) await notifyStaff(await involvedIds(jobId, (await loadStages(jobId)).map((s) => s.section), job.gated_in_by, true), { type: "bodyshop_signoff", title: `${shortCar(job.vehicle)} signed off, ready to hand over`, body: `Every sign-off is in. Handover ${formatDate(job.promised_at)}.`, jobId, href: `/jobs/${jobId}/gate-out` });
  }
  return { complete: after.complete };
}

/** "Not ready": the car goes back to that section's last stage, the handover moves a day, everyone is told. */
export async function notReady(jobId: string, roleKey: SignoffKey, reason: string, actor: Actor, settings: Settings): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const clean = reason.trim().slice(0, 200);
  if (clean.length < 3) return { error: "Say in a few words what is not ready." };
  const stages = await loadStages(jobId);
  const state = await signoffState(jobId);
  if (!state.needed.includes(roleKey)) return { error: "That sign-off is not needed on this car." };
  const { data: js } = await admin.from("jobs").select("is_open, status").eq("id", jobId).maybeSingle();
  if (!js?.is_open || !["ready", "pending_payment"].includes(String(js.status))) return { error: "Not ready is for a car waiting for its release sign-off." };
  const section: StageSection = roleKey === "manager" ? "strip_refit" : roleKey;
  // A leader reopens their own team's stage; the bodyshop manager may reopen the last stage done if strip and refit had none.
  const back = [...stages].reverse().find((s) => s.section === section && s.status === "done") ?? (roleKey === "manager" ? [...stages].reverse().find((s) => s.status === "done" && s.key !== "handover") : undefined);
  if (!back) return { error: "There is no finished stage of your team on this car to send back." };
  const now = new Date().toISOString();
  if (back) await admin.from("bodyshop_stages").update({ status: "active", done_at: null, done_by: null, updated_by: actor.id }).eq("id", back.id);
  const handover = stages.find((s) => s.key === "handover");
  if (handover) await admin.from("bodyshop_stages").update({ status: "pending", updated_by: actor.id }).eq("id", handover.id);
  await admin.from("bodyshop_signoffs").update({ is_active: false, updated_by: actor.id }).eq("job_id", jobId).eq("is_active", true);
  const job = await jobRow(jobId);
  if (!job) return { error: "Job not found." };
  const workingDays = (settings.working_days ?? []) as string[];
  let newPromised = job.promised_at ? addDaysIso(job.promised_at, 1) : null;
  while (newPromised && workingDaysBetween(newPromised, newPromised, workingDays)[0] !== newPromised) newPromised = addDaysIso(newPromised, 1);
  await admin.from("jobs").update({ status: "in_work", stage: "work", stage_entered_at: now, ...(newPromised ? { promised_at: newPromised } : {}), updated_by: actor.id }).eq("id", jobId);
  if (handover && newPromised) await admin.from("bodyshop_stages").update({ due_date: newPromised }).eq("id", handover.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_not_ready", note: `Not ready (${actor.display_name}): ${clean}. Back to ${back?.label ?? "the work"}; handover ${formatDate(newPromised ?? job.promised_at)}.`, created_by: actor.id });
  const ids = await involvedIds(jobId, stages.map((s) => s.section), job.gated_in_by);
  if (back) await tellSection(job, { ...back, status: "active" }, `${shortCar(job.vehicle)} is back with you: ${clean}`);
  await notifyStaff(ids, { type: "bodyshop_not_ready", title: `${shortCar(job.vehicle)} not ready: ${clean}`, body: `${actor.display_name} sent it back to ${back?.label ?? "the work"}. Handover now ${formatDate(newPromised ?? job.promised_at)}.`, jobId, href: `/bodyshop/${jobId}` });
  return {};
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Customer updates and handover                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

export async function recordUpdate(jobId: string, kind: "arrived" | "film" | "ready", photoId: string | null, actor: Actor): Promise<{ token: string }> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("bodyshop_updates").select("id, token").eq("job_id", jobId).eq("kind", kind).eq("is_active", true).maybeSingle();
  if (existing) {
    await admin.from("bodyshop_updates").update({ photo_id: photoId, updated_by: actor.id }).eq("id", existing.id);
    return { token: existing.token };
  }
  const { data: made } = await admin.from("bodyshop_updates").insert({ job_id: jobId, kind, photo_id: photoId, created_by: actor.id, updated_by: actor.id }).select("token").single();
  return { token: made?.token ?? "" };
}
export async function markUpdateSent(jobId: string, kind: "arrived" | "film" | "ready", actor: Actor) {
  const admin = createAdminClient();
  await admin.from("bodyshop_updates").update({ sent_at: new Date().toISOString(), sent_by: actor.id, updated_by: actor.id }).eq("job_id", jobId).eq("kind", kind).eq("is_active", true);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_update", note: `Customer update sent: ${kind === "arrived" ? "Your car has arrived" : kind === "film" ? "Film is going on" : "Your car is ready for collection"} (${actor.display_name})`, created_by: actor.id });
}
export async function setAfterPhoto(jobId: string, photoId: string | null, actor: Actor) {
  await createAdminClient().from("jobs").update({ bodyshop_after_photo_id: photoId, updated_by: actor.id }).eq("id", jobId);
}

/** The car has left: everyone involved hears it; a PPF car gets its final check visit on the calendar. */
export async function afterBodyshopHandover(jobId: string, finalCheckDate: string | null, actor: Actor) {
  const admin = createAdminClient();
  const job = await jobRow(jobId);
  if (!job) return;
  const stages = await loadStages(jobId);
  const handover = stages.find((s) => s.key === "handover");
  const now = new Date().toISOString();
  if (handover && handover.status !== "done") await admin.from("bodyshop_stages").update({ status: "done", done_at: now, done_by: actor.id, updated_by: actor.id }).eq("id", handover.id);
  const ids = await involvedIds(jobId, stages.map((s) => s.section), job.gated_in_by);
  await notifyStaff(ids, { type: "bodyshop_left", title: `${shortCar(job.vehicle)} has left the workshop`, body: `Handed over ${formatDate(now)}.`, jobId, href: `/jobs/${jobId}` });
  if (finalCheckDate && /^\d{4}-\d{2}-\d{2}$/.test(finalCheckDate) && !job.final_check_appointment_id) {
    const { data: appt } = await admin.from("appointments").insert({ kind: "customer_visit", department: "bodyshop", customer_id: job.customer_id, vehicle_id: job.vehicle_id, job_id: jobId, reason: "PPF final check", starts_at: new Date(`${finalCheckDate}T10:00:00+04:00`).toISOString(), duration_minutes: 30, advisor_id: job.gated_in_by, created_by: actor.id, updated_by: actor.id }).select("id").single();
    if (appt) await admin.from("jobs").update({ final_check_appointment_id: appt.id }).eq("id", jobId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_final_check", note: `Final check booked for ${formatDate(finalCheckDate)} (${actor.display_name})`, created_by: actor.id });
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Lists: the board, a leader's section, the tablets, the electricians' tasks, the cron                             */
/* ------------------------------------------------------------------------------------------------------------ */

export type BoardCar = {
  job: BodyshopJobRow;
  stages: StageRow[];
  current: StageRow | null;
  people: { id: string; name: string }[];
  minutes: number;
  pictureUrl: string | null;
  signoff: { needed: SignoffKey[]; signed: SignoffKey[]; waitingOn: SignoffKey[] };
  tone: "red" | "amber" | "normal";
  /** Section 6: the plain-words status for a car whose bodyshop stages have not started yet. */
  phase: string | null;
};

/** Every open bodyshop car with its stages, people and sign-off state, in due order. */
export async function loadBoard(): Promise<{ cars: BoardCar[]; goingOut: BoardCar[]; today: string; tomorrow: string }> {
  const admin = createAdminClient();
  const wtBoard = workingTimeOf(await getSettings(), "bodyshop");
  // Section 6 (21 October): EVERY open job with bodyshop work belongs on the board - mixed ("both")
  // cars included, and cars still in inspection, quoting or approval, not only the ones already in work.
  const { data: jobs } = await admin.from("jobs").select(JOB_SELECT).eq("is_open", true).in("department", ["bodyshop", "both"]).order("promised_at", { ascending: true, nullsFirst: false });
  const rows = (jobs ?? []) as unknown as BodyshopJobRow[];
  if (!rows.length) {
    const today = dubaiDate();
    return { cars: [], goingOut: [], today, tomorrow: addDaysIso(today, 1) };
  }
  const ids = rows.map((j) => j.id);
  const [{ data: stageRows }, { data: asg }, { data: clk }, { data: sig }] = await Promise.all([
    admin.from("bodyshop_stages").select(STAGE_SELECT).in("job_id", ids).eq("is_active", true).order("position"),
    admin.from("bodyshop_assignments").select("job_id, staff_id, staff:staff!bodyshop_assignments_staff_id_fkey(display_name)").in("job_id", ids).is("removed_at", null).eq("is_active", true),
    admin.from("bodyshop_clockings").select("job_id, started_at, ended_at, minutes").in("job_id", ids).eq("is_active", true),
    admin.from("bodyshop_signoffs").select("job_id, role_key").in("job_id", ids).eq("is_active", true),
  ]);
  const picPaths = rows.map((j) => j.vehicle?.photo_path).filter((p): p is string => !!p);
  const { data: signed } = picPaths.length ? await admin.storage.from("vehicle-photos").createSignedUrls(picPaths, 3600) : { data: [] as { path: string | null; signedUrl: string }[] };
  const picOf = new Map((signed ?? []).filter((s) => s.path).map((s) => [s.path as string, s.signedUrl]));
  const today = dubaiDate();
  const tomorrow = addDaysIso(today, 1);
  // Cars whose stages have not started yet (inspection, quoting, approval, parts): their PLANNED stages
  // come from the newest quotation's bodyshop lines, so each section sees what is coming to it.
  const stagelessIds = rows.filter((j) => !((stageRows ?? []) as { job_id: string }[]).some((s) => s.job_id === j.id)).map((j) => j.id);
  const plannedOf = new Map<string, { key: string; label: string; section: StageSection }[]>();
  if (stagelessIds.length) {
    const { data: lineRows } = await admin
      .from("quotation_lines")
      .select("id, line_type, side, title, package_key, package_items, film_colour, film_code, tint_percent, quotation:quotations!inner(job_id, status, is_active, version), service:services(bodyshop_kind, department)")
      .in("quotation.job_id", stagelessIds)
      .eq("is_active", true)
      .eq("quotation.is_active", true)
      .neq("quotation.status", "cancelled");
    const kindsOf = new Map<string, Set<string>>();
    for (const l of (lineRows ?? []) as unknown as (SideLine & { quotation: { job_id: string } | null; service: { bodyshop_kind: string | null; department: string | null } | null })[]) {
      const jid = l.quotation?.job_id;
      if (!jid) continue;
      for (const kind of kindsOfLine(l, l.service)) {
        if (!kindsOf.has(jid)) kindsOf.set(jid, new Set());
        kindsOf.get(jid)!.add(kind);
      }
    }
    for (const [jid, kinds] of kindsOf) {
      const keys = stageKeysFor(Array.from(kinds));
      plannedOf.set(jid, STAGE_DEFS.filter((d) => keys.includes(d.key)).map((d) => ({ key: d.key, label: d.label, section: d.section })));
    }
  }
  const cars: BoardCar[] = rows.map((job) => {
    const real = ((stageRows ?? []) as Record<string, unknown>[]).map(toStage).filter((s) => s.job_id === job.id);
    const planned = real.length ? [] : (plannedOf.get(job.id) ?? []);
    const stages = real.length
      ? real
      : planned.map((p, i) => toStage({ id: `plan:${job.id}:${p.key}`, job_id: job.id, position: i, key: p.key, label: p.label, section: p.section, est_hours: null, due_date: null, status: "pending", started_at: null, done_at: null, done_by: null, heads_up_sent_at: null, late_notified_at: null } as unknown as Record<string, unknown>));
    const current = currentStage(real);
    const needed = neededSignoffs(stages.map((s) => s.section));
    const signedKeys = (sig ?? []).filter((s) => s.job_id === job.id).map((s) => s.role_key as SignoffKey);
    const due = current?.due_date ?? job.promised_at;
    const tone: BoardCar["tone"] = due && due < today ? "red" : due === today ? "amber" : "normal";
    return {
      job,
      stages,
      current,
      people: (asg ?? []).filter((a) => a.job_id === job.id).map((a) => ({ id: a.staff_id, name: (a.staff as unknown as { display_name: string } | null)?.display_name ?? "" })),
      minutes: clockedMinutes((clk ?? []).filter((c) => c.job_id === job.id), Date.now(), wtBoard),
      pictureUrl: job.vehicle?.photo_path ? (picOf.get(job.vehicle.photo_path) ?? null) : null,
      signoff: { needed, signed: signedKeys, waitingOn: needed.filter((k) => !signedKeys.includes(k)) },
      tone,
      phase: real.length ? null : (BOARD_PHASE[job.status] ?? job.status.replace(/_/g, " ")),
    };
  });
  const order = (a: BoardCar, b: BoardCar) => ((a.current?.due_date ?? a.job.promised_at ?? "9999") < (b.current?.due_date ?? b.job.promised_at ?? "9999") ? -1 : 1);
  cars.sort(order);
  const goingOut = cars.filter((c) => c.job.promised_at && c.job.promised_at <= tomorrow).sort((a, b) => ((a.job.promised_at ?? "") < (b.job.promised_at ?? "") ? -1 : 1));
  return { cars, goingOut, today, tomorrow };
}

/** The plain-words phase of a bodyshop car before its stages start. */
const BOARD_PHASE: Record<string, string> = {
  gate_in_pending: "Gate-in running",
  pending_approval: "Waiting for the customer's job-card approval",
  pending_assignment: "Waiting to be assigned",
  pending_road_test: "Road test",
  in_inspection: "Inspection running",
  pending_inspection: "Inspection to start",
  pending_quote: "Quotation being prepared",
  pending_customer_approval: "Quotation with the customer",
  approved: "Approved, parts and planning",
  waiting_parts: "Waiting for parts",
  in_work: "In work",
  pending_qc: "QC",
  pending_wash: "Wash",
  ready: "Ready",
  pending_payment: "Awaiting payment",
  in_delivery: "Out for delivery",
};

/** A section's cars in due order: the ones whose current stage is theirs first, then the ones coming to them. */
export function sectionCars(cars: BoardCar[], section: Section): { now: BoardCar[]; coming: BoardCar[] } {
  const now = cars.filter((c) => c.current?.section === section);
  const coming = cars.filter((c) => c.current?.section !== section && c.stages.some((s) => s.section === section && s.status !== "done" && s.status !== "skipped"));
  const nextDue = (c: BoardCar) => c.stages.find((s) => s.section === section && s.status !== "done" && s.status !== "skipped")?.due_date ?? "9999";
  coming.sort((a, b) => (nextDue(a) < nextDue(b) ? -1 : 1));
  return { now, coming };
}

/** The electrical reset tasks for the mechanical side: active or waiting, with the car and the due date. */
export async function electricalTasks(): Promise<{ stage: StageRow; job: BodyshopJobRow }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("bodyshop_stages").select(STAGE_SELECT).eq("section", "electrical").eq("is_active", true).in("status", ["active", "pending"]).order("due_date");
  const stages = ((data ?? []) as Record<string, unknown>[]).map(toStage);
  if (!stages.length) return [];
  const { data: jobs } = await admin.from("jobs").select(JOB_SELECT).in("id", Array.from(new Set(stages.map((s) => s.job_id)))).eq("is_open", true);
  const byId = new Map(((jobs ?? []) as unknown as BodyshopJobRow[]).map((j) => [j.id, j]));
  return stages.filter((s) => byId.has(s.job_id)).map((s) => ({ stage: s, job: byId.get(s.job_id)! }));
}

/**
 * The hourly round: a stage past its due date pushes the later dates and the handover and tells the manager and
 * advisor (once per stage per day); the day before a car is due out, the manager and every leader involved hear it
 * with the sign-offs still needed.
 */
export async function bodyshopHourly(settings: Settings): Promise<{ late: number; dueOut: number; closed: number }> {
  const admin = createAdminClient();
  const today = dubaiDate();
  const tomorrow = addDaysIso(today, 1);
  let late = 0;
  const { data: lateRows } = await admin.from("bodyshop_stages").select(STAGE_SELECT).eq("is_active", true).in("status", ["active", "pending"]).lt("due_date", today).neq("key", "handover");
  for (const raw of (lateRows ?? []) as Record<string, unknown>[]) {
    const s = toStage(raw);
    if (s.late_notified_at && s.late_notified_at.slice(0, 10) === new Date().toISOString().slice(0, 10)) continue;
    const job = await jobRow(s.job_id);
    if (!job || !job.is_open) continue;
    const daysLate = Math.max(1, Math.round((Date.parse(today) - Date.parse(s.due_date!)) / 86400000));
    await shiftAfterLateStage(s, daysLate, settings);
    late++;
  }
  // The bodyshop clocks pause themselves at closing time: open clockings end with the minutes counted up to closing.
  let closed = 0;
  const hourNow = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(new Date()));
  if (hourNow >= (Number(settings.closing_hour) || 17)) {
    const wt = workingTimeOf(settings, "bodyshop");
    const { data: open } = await admin.from("bodyshop_clockings").select("id, started_at").is("ended_at", null).eq("is_active", true);
    for (const c of open ?? []) {
      const nowIso = new Date().toISOString();
      await admin.from("bodyshop_clockings").update({ ended_at: nowIso, minutes: countedMinutes(c.started_at, nowIso, wt), closed_reason: "end_of_shift" }).eq("id", c.id);
      closed++;
    }
  }
  let dueOut = 0;
  const { data: jobs } = await admin.from("jobs").select(JOB_SELECT).eq("is_open", true).eq("department", "bodyshop").eq("promised_at", tomorrow).is("bodyshop_due_out_notified_at", null);
  for (const j of (jobs ?? []) as unknown as BodyshopJobRow[]) {
    const state = await signoffState(j.id);
    if (!state.hasStages) continue;
    const ids = await involvedIds(j.id, (await loadStages(j.id)).map((s) => s.section), null);
    for (const k of state.waitingOn) if (k !== "manager") ids.push(...(await leaderIdsOf(k)).filter((x) => !ids.includes(x)));
    await notifyStaff(ids, { type: "bodyshop_due_out", title: `${shortCar(j.vehicle)} due out tomorrow`, body: state.waitingOn.length ? `Sign-off needed from ${state.waitingOn.map((k) => ({ manager: "the bodyshop manager", ppf: "PPF", detailing: "Detailing", paint: "Paint" })[k]).join(" and ")}.` : "Every sign-off is in.", jobId: j.id, href: `/bodyshop/${j.id}#signoff` });
    await admin.from("jobs").update({ bodyshop_due_out_notified_at: new Date().toISOString() }).eq("id", j.id);
    dueOut++;
  }
  return { late, dueOut, closed };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The owner's monthly block                                                                                       */
/* ------------------------------------------------------------------------------------------------------------ */

export type BodyshopMonth = { inProgress: number; late: number; avgDays: number | null; profit: number; materialsPercent: number | null; cars: { jobId: string; jobNumber: string; plate: string; price: number; materials: number; labour: number; commission: number; bank: number; profit: number }[]; /** Section 10: PPF hours and film by cutting method. */ byCut?: { key: string; label: string; jobs: number; hours: number; metres: number; hoursPerJob: number | null; metresPerJob: number | null }[] };

/** Cars in progress and late today, and for the cars handed over in the month: days, price, materials, clocked labour, profit. */
export async function bodyshopMonth(settings: Settings, fromIso: string, toIso: string): Promise<BodyshopMonth> {
  const admin = createAdminClient();
  const today = dubaiDate();
  const { data: open } = await admin.from("jobs").select("id, promised_at").eq("is_open", true).eq("department", "bodyshop").neq("status", "booked");
  const inProgress = (open ?? []).length;
  const late = (open ?? []).filter((j) => j.promised_at && j.promised_at < today).length;
  const { data: done } = await admin.from("jobs").select(JOB_SELECT).eq("is_open", false).eq("department", "bodyshop").gte("gated_out_at", fromIso).lt("gated_out_at", toIso).order("gated_out_at");
  const rows = (done ?? []) as unknown as BodyshopJobRow[];
  const cars: BodyshopMonth["cars"] = [];
  for (const j of rows) {
    const q = (await approvedQuotations(j.id))[0];
    if (!q) continue;
    const { data: qrow } = await admin.from("quotations").select("subtotal_aed, discount_aed, total_aed, materials_cost_aed, commission_aed, expected_payment_method").eq("id", q.id).maybeSingle();
    const net = round2((Number(qrow?.subtotal_aed) || 0) - (Number(qrow?.discount_aed) || 0));
    const materials = Number(qrow?.materials_cost_aed) || 0;
    const commission = Number(qrow?.commission_aed) || 0;
    const method = String(qrow?.expected_payment_method ?? "");
    const bank = ["card", "link", "transfer"].includes(method) ? round2((Number(qrow?.total_aed) || 0) * (bankChargePercentFor(settings, method) / 100)) : 0;
    const labour = await bodyshopLabourCost(j.id, settings);
    cars.push({ jobId: j.id, jobNumber: j.job_number, plate: j.vehicle ? formatPlate(j.vehicle) : j.job_number, price: net, materials, labour: labour.cost, commission, bank, profit: round2(net - materials - labour.cost - commission - bank) });
  }
  const days = rows.filter((j) => j.gated_out_at).map((j) => (Date.parse(j.gated_out_at!) - Date.parse(j.gated_in_at)) / 86400000);
  const price = cars.reduce((a, c) => a + c.price, 0);
  const materials = cars.reduce((a, c) => a + c.materials, 0);
  // Section 10: PPF hours and film by cutting method (hand-cut against pre-cut).
  const byCut = await ppfByCutMethod(fromIso, toIso);
  return { inProgress, late, avgDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null, profit: round2(cars.reduce((a, c) => a + c.profit, 0)), materialsPercent: price > 0 ? Math.round((materials / price) * 1000) / 10 : null, cars, byCut };
}

/** Clocked labour per SECTION on one job: "PPF: 4 people · 96 h · AED x" for the owner's summary. */
export async function bodyshopLabourBySection(jobId: string, settings: Settings): Promise<{ section: string; people: number; hours: number; cost: number }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("bodyshop_clockings").select("staff_id, started_at, ended_at, minutes, stage:bodyshop_stages(section)").eq("job_id", jobId).eq("is_active", true);
  const rate = (Number(settings.bodyshop_cost_rate_aed) || 0) || Number(settings.technician_cost_rate_aed) || 0;
  const by = new Map<string, { people: Set<string>; minutes: number }>();
  for (const c of data ?? []) {
    const section = ((c.stage as unknown as { section: string | null } | null)?.section ?? "other") || "other";
    const g = by.get(section) ?? { people: new Set<string>(), minutes: 0 };
    g.people.add(c.staff_id as string);
    g.minutes += clockedMinutes([c]);
    by.set(section, g);
  }
  return [...by.entries()].map(([section, g]) => ({ section, people: g.people.size, hours: Math.round((g.minutes / 60) * 10) / 10, cost: round2((g.minutes / 60) * rate) })).sort((a, b) => b.hours - a.hours);
}

/** Section 4.4 (21 October 2026): what installers REALLY took on this model before - the average
 *  clocked hours across closed bodyshop jobs of the same vehicle model, offered as a hint beside
 *  the installer-hour estimate. Null until there is history. */
export async function installerHistoryFor(vehicleId: string | null): Promise<{ jobs: number; avgHours: number } | null> {
  if (!vehicleId) return null;
  const admin = createAdminClient();
  const { data: v } = await admin.from("vehicles").select("model_id").eq("id", vehicleId).maybeSingle();
  if (!v?.model_id) return null;
  const { data: cars } = await admin.from("vehicles").select("id").eq("model_id", v.model_id);
  const carIds = (cars ?? []).map((c) => c.id as string);
  if (!carIds.length) return null;
  const { data: jobs } = await admin.from("jobs").select("id").in("vehicle_id", carIds).eq("is_open", false);
  const jobIds = (jobs ?? []).map((j) => j.id as string);
  if (!jobIds.length) return null;
  const { data: clk } = await admin.from("bodyshop_clockings").select("job_id, started_at, ended_at, minutes").in("job_id", jobIds).eq("is_active", true).not("ended_at", "is", null);
  if (!clk?.length) return null;
  const byJob = new Map<string, number>();
  for (const c of clk) {
    const mins = c.minutes !== null ? Number(c.minutes) : Math.max(0, (Date.parse(c.ended_at as string) - Date.parse(c.started_at as string)) / 60000);
    byJob.set(c.job_id as string, (byJob.get(c.job_id as string) ?? 0) + mins);
  }
  const totals = [...byJob.values()].filter((m) => m > 0);
  if (!totals.length) return null;
  return { jobs: totals.length, avgHours: Math.round((totals.reduce((a, b) => a + b, 0) / totals.length / 60) * 10) / 10 };
}

/**
 * Newly approved bodyshop work on a car whose stages already exist (an additional quotation, or a new approval after
 * the car was ready): the stages it needs that the car does not have yet are added before the handover, and if no
 * stage is running the first new one starts (the handover waits again).
 */
export async function extendBodyshopStages(jobId: string, actor: Actor): Promise<{ added: string[] }> {
  const admin = createAdminClient();
  const { kinds } = await approvedKinds(jobId);
  const want = stageKeysFor(kinds);
  const before = await loadStages(jobId);
  const have = new Set(before.map((s) => s.key));
  const added: string[] = [];
  for (const key of want) {
    if (key === "handover" || have.has(key)) continue;
    const r = await addStage(jobId, key, null, actor);
    if (!r.error) added.push(stageLabelFor(key, kinds));
  }
  if (!added.length) return { added };
  const stages = await loadStages(jobId);
  const now = new Date().toISOString();
  if (!stages.some((s) => s.status === "active" && s.key !== "handover")) {
    const next = stages.find((s) => s.status === "pending" && s.key !== "handover");
    if (next) await admin.from("bodyshop_stages").update({ status: "active", started_at: now, updated_by: actor.id }).eq("id", next.id);
    const handover = stages.find((s) => s.key === "handover" && s.status === "active");
    if (handover) await admin.from("bodyshop_stages").update({ status: "pending", started_at: null, updated_by: actor.id }).eq("id", handover.id);
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "bodyshop_stage", note: `New bodyshop work approved: ${added.join(", ")} added to the stages`, created_by: actor.id });
  return { added };
}
