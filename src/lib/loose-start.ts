import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError, SAVE_FAILED, dbWords } from "./app-errors";
import { lineSideOf } from "./job-sides";
import { departmentOfSides, LOOSE_TAG, partsLateForHandover, type BookedPart } from "./booked-job-rules";

/*
 * START THE JOB – LOOSE ITEMS (20 November 2026, Section 2). An approved estimate whose car is not coming (a parts sale,
 * or items brought in without the car) becomes a job card at once, with no gate-in: the held job "Order parts now"
 * made is opened (one J-number keeps its parts, LPOs and money), else a new job. The estimate is carried (nothing is
 * typed twice), its money follows, and the department comes from its lines. The quotation then starts from the estimate
 * exactly as at a gate-in (an exact copy of an approved estimate is approved by itself).
 */

type Actor = { id: string; display_name: string; role_id: string };
export const LOOSE_START_ROLES = ["owner", "service_advisor", "gate_in"];

export async function startLooseJob(estimateId: string, by: Actor): Promise<{ error?: string; jobId?: string; jobNumber?: string }> {
  if (!LOOSE_START_ROLES.includes(by.role_id)) return { error: "Only an advisor, the gate or the owner starts a job." };
  const admin = createAdminClient();
  const { data: est } = await admin.from("quotations").select("id, number, kind, status, vehicle_id, customer_id, carried_job_id, deleted_at, is_active").eq("id", estimateId).maybeSingle();
  if (!est || est.kind !== "estimate" || est.deleted_at || est.is_active === false) return { error: "That estimate is not there any more." };
  if (est.carried_job_id) {
    const { data: j } = await admin.from("jobs").select("job_number").eq("id", est.carried_job_id).maybeSingle();
    return { error: `${est.number} is already on job ${j?.job_number ?? "card"}.`, jobId: String(est.carried_job_id) };
  }
  if (est.status !== "approved") return { error: `${est.number} is not approved by the customer yet: send it first.` };
  if (!est.vehicle_id || !est.customer_id) return { error: `${est.number} has no customer or car on it.` };
  // The family: every version of this estimate number.
  const { data: family } = await admin.from("quotations").select("id").eq("number", est.number).eq("kind", "estimate");
  const familyIds = ((family ?? []) as { id: string }[]).map((f) => f.id);
  // The department from the lines (J-01034 is parts only: mechanical, never the bodyshop).
  const { data: lines } = await admin.from("quotation_lines").select("line_type, team, side, outside_work, package_key, package_items, service_id").eq("quotation_id", estimateId).eq("is_active", true);
  const svcIds = Array.from(new Set(((lines ?? []) as { service_id: string | null }[]).map((l) => l.service_id).filter((x): x is string => !!x)));
  const { data: svcs } = svcIds.length ? await admin.from("services").select("id, bodyshop_kind, department").in("id", svcIds) : { data: [] };
  const svcOf = new Map(((svcs ?? []) as { id: string; bodyshop_kind: string | null; department: string | null }[]).map((s) => [s.id, s]));
  const department = departmentOfSides(((lines ?? []) as Record<string, unknown>[]).map((l) => lineSideOf(l as never, (l.service_id ? svcOf.get(String(l.service_id)) : undefined) as never)));
  const now = new Date().toISOString();
  const fields = { job_kind: "loose", status: "pending_quote", stage: "quote", is_open: true, department, estimate_id: estimateId, gated_in_by: by.id, gated_in_at: now, first_approval_at: now, stage_entered_at: now, updated_by: by.id };
  const { data: held } = familyIds.length ? await admin.from("jobs").select("id, job_number").in("estimate_id", familyIds).eq("status", "booked").eq("is_open", false).limit(1).maybeSingle() : { data: null };
  let job: { id: string; job_number: string } | null = null;
  if (held) {
    const { data, error } = await admin.from("jobs").update(fields).eq("id", held.id).eq("status", "booked").select("id, job_number").maybeSingle();
    if (error) {
      await logAppError("loose-start: open held job", error, { staffId: by.id, jobId: held.id });
      return { error: dbWords(error, "loose-start") };
    }
    job = (data as { id: string; job_number: string } | null) ?? null;
  } else {
    const { data, error } = await admin.from("jobs").insert({ ...fields, vehicle_id: est.vehicle_id, customer_id: est.customer_id, priority: "normal", created_by: by.id }).select("id, job_number").single();
    if (error) {
      await logAppError("loose-start: new job", error, { staffId: by.id });
      return { error: dbWords(error, "loose-start") };
    }
    job = data as { id: string; job_number: string };
  }
  if (!job) return { error: SAVE_FAILED };
  const { error: carryError } = await admin.from("quotations").update({ carried_job_id: job.id, updated_by: by.id }).in("id", familyIds.length ? familyIds : [estimateId]);
  if (carryError) await logAppError("loose-start: carry", carryError, { staffId: by.id, jobId: job.id });
  let moneyWords = "";
  try {
    const { moveEstimateMoneyToJob } = await import("./estimate-money");
    const moved = await moveEstimateMoneyToJob([estimateId], job.id, by.id);
    if (moved.words) moneyWords = ` ${moved.words}`;
  } catch (e) {
    await logAppError("loose-start: money", e, { staffId: by.id, jobId: job.id });
  }
  await admin.from("job_events").insert({ job_id: job.id, event_type: "gate_in", to_status: "pending_quote", to_stage: "quote", to_staff: by.id, note: `${LOOSE_TAG}: started from ${est.number} by ${by.display_name}, no gate-in.${held ? " The held job with the ordered parts is opened." : ""}${moneyWords}`, created_by: by.id });
  return { jobId: job.id, jobNumber: job.job_number };
}

/** The approved estimates of a customer not on a job yet (the gate-in "Loose items, no car" offers them). */
export async function approvedEstimatesOf(customerId: string): Promise<{ id: string; number: string; total: number; car: string | null }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("quotations").select("id, number, total_aed, vehicle_id, version").eq("customer_id", customerId).eq("kind", "estimate").eq("status", "approved").is("carried_job_id", null).is("deleted_at", null).eq("is_active", true).order("created_at", { ascending: false }).limit(20);
  const list = (data ?? []) as { id: string; number: string; total_aed: number | string | null; vehicle_id: string | null }[];
  const vIds = Array.from(new Set(list.map((q) => q.vehicle_id).filter((x): x is string => !!x)));
  const { data: vs } = vIds.length ? await admin.from("vehicles").select("id, model_year, vin, make:vehicle_makes(name), model:vehicle_models(name)").in("id", vIds) : { data: [] };
  const carOf = new Map(((vs ?? []) as unknown as { id: string; model_year: number | null; make: { name: string } | null; model: { name: string } | null }[]).map((v) => [v.id, [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ")]));
  const seen = new Set<string>();
  return list.filter((q) => (seen.has(q.number) ? false : (seen.add(q.number), true))).map((q) => ({ id: q.id, number: q.number, total: Number(q.total_aed) || 0, car: q.vehicle_id ? (carOf.get(q.vehicle_id) ?? null) : null }));
}

export type BookedView = { estimateId: string | null; arrivalAt: string | null; promisedAt: string | null; estimateNumber: string | null; estimateStatus: string | null; lines: { title: string; type: string }[]; parts: BookedPart[]; partsLate: BookedPart[] };

/** A booked car before it arrives: its work, its parts and their status, the booking and the promised handover. */
export async function bookedView(jobId: string): Promise<BookedView | null> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, status, booked_arrival_at, promised_at, estimate_id").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "booked") return null;
  const { data: est } = job.estimate_id ? await admin.from("quotations").select("id, number, status").eq("id", job.estimate_id).maybeSingle() : { data: null };
  const { data: quote } = await admin.from("quotations").select("id").eq("job_id", jobId).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lineSrc = quote?.id ?? est?.id ?? null;
  const { data: lines } = lineSrc ? await admin.from("quotation_lines").select("title, line_type").eq("quotation_id", lineSrc).eq("is_active", true).order("position") : { data: [] };
  const { data: parts } = await admin.from("part_items").select("description, order_status, received_qty, quantity, delivery_date, is_active").eq("job_id", jobId).eq("is_active", true);
  const ps: BookedPart[] = ((parts ?? []) as { description: string; order_status: string | null; received_qty: number | string | null; quantity: number | string | null; delivery_date: string | null }[]).map((p) => ({ name: p.description, orderStatus: p.order_status, received: Number(p.received_qty) >= (Number(p.quantity) || 1), expected: p.delivery_date }));
  return {
    estimateId: (est?.id as string | null) ?? null,
    arrivalAt: (job.booked_arrival_at as string | null) ?? null,
    promisedAt: (job.promised_at as string | null) ?? null,
    estimateNumber: (est?.number as string | null) ?? null,
    estimateStatus: (est?.status as string | null) ?? null,
    lines: ((lines ?? []) as { title: string; line_type: string }[]).filter((l) => l.line_type !== "fee").map((l) => ({ title: l.title, type: l.line_type })),
    parts: ps,
    partsLate: partsLateForHandover(ps, (job.promised_at as string | null) ?? null),
  };
}

/** The hourly reminder: a booked car past its arrival time tells its advisor once ("ARRIVAL WAS DUE …"). */
export async function overdueArrivalsHourly(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select("id, job_number, booked_arrival_at, advisor_id").eq("status", "booked").eq("is_open", false).lt("booked_arrival_at", new Date().toISOString()).limit(200);
  const list = (data ?? []) as { id: string; job_number: string; booked_arrival_at: string; advisor_id: string | null }[];
  if (!list.length) return 0;
  const { data: told } = await admin.from("job_events").select("job_id, note").in("job_id", list.map((j) => j.id)).eq("event_type", "arrival_overdue");
  const toldFor = new Set(((told ?? []) as { job_id: string; note: string }[]).map((t) => `${t.job_id}|${t.note}`));
  const { arrivalDueWords } = await import("./booked-job-rules");
  const { notifyJobAdvisors } = await import("./notifications");
  let n = 0;
  for (const j of list) {
    const words = arrivalDueWords(j.booked_arrival_at, Date.now());
    if (!words || toldFor.has(`${j.id}|${words}`)) continue;
    await admin.from("job_events").insert({ job_id: j.id, event_type: "arrival_overdue", note: words });
    await notifyJobAdvisors(j.id, { type: "arrival_overdue", title: `${words} · ${j.job_number}`, body: "The booked car has not arrived. Call the customer and move the booking, or start the job as loose items if no car is coming.", jobId: j.id, href: `/jobs/${j.id}` });
    n++;
  }
  return n;
}
