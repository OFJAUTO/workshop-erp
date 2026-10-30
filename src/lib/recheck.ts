import "server-only";
import { jobFilmCost } from "./film";
import { formatDate } from "./format";
import { jobAdvisorIds, notifyStaff } from "./notifications";
import { lineIsPpf } from "./ppf-cut";
import { costRateFor } from "./profit";
import { recheckPoints, recheckRedo, type RecheckPoint, type RecheckPointKey, type RecheckStatus } from "./recheck-points";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate, type PlateFields } from "./types";
import { dubaiDate } from "./jobs";

/**
 * The PPF recheck (30 October 2026): the FREE 10-day final check after a PPF job is its own visit - a job of kind
 * 'recheck' linked to the original PPF job (jobs.recheck_of). No inspection fee, no quotation, no approval, no
 * invoice: the PPF team does the checklist, fixes what needs fixing without a price, and the time and any film go to
 * the ORIGINAL job's cost. The original's after-care row (aftercare_checks) holds the checklist and the done date,
 * which the warranty shows as "Final check done on <date> ✓".
 */

type Actor = { id: string; display_name: string };

/** A delivered job of this car with PPF fitted: the originals a recheck can be for, newest first. */
export async function ppfJobsOfCar(vehicleId: string): Promise<{ id: string; number: string; date: string; what: string; checkDone: string | null }[]> {
  const admin = createAdminClient();
  const { data: jobs } = await admin.from("jobs").select("id, job_number, gated_out_at, gated_in_at").eq("vehicle_id", vehicleId).neq("job_kind", "recheck").not("gated_out_at", "is", null).order("gated_out_at", { ascending: false }).limit(20);
  if (!jobs?.length) return [];
  const ids = jobs.map((j) => j.id as string);
  const { data: qs } = await admin.from("quotations").select("id, job_id").in("job_id", ids).eq("kind", "quotation").eq("status", "approved").eq("is_active", true);
  const qIds = (qs ?? []).map((q) => q.id as string);
  const { data: lines } = qIds.length ? await admin.from("quotation_lines").select("quotation_id, title, package_items, service_id").in("quotation_id", qIds).eq("is_active", true) : { data: [] };
  const svcIds = Array.from(new Set((lines ?? []).map((l) => l.service_id as string | null).filter((x): x is string => !!x)));
  const { data: svcs } = svcIds.length ? await admin.from("services").select("id, bodyshop_kind").in("id", svcIds) : { data: [] };
  const kindOf = new Map((svcs ?? []).map((s) => [s.id as string, (s.bodyshop_kind as string | null) ?? null]));
  const jobOfQuote = new Map((qs ?? []).map((q) => [q.id as string, q.job_id as string]));
  const { data: checks } = await admin.from("aftercare_checks").select("job_id, done_at").in("job_id", ids).eq("is_active", true);
  const doneOf = new Map((checks ?? []).map((c) => [c.job_id as string, (c.done_at as string | null) ?? null]));
  const out: { id: string; number: string; date: string; what: string; checkDone: string | null }[] = [];
  for (const j of jobs) {
    const ppf = (lines ?? []).filter((l) => jobOfQuote.get(l.quotation_id as string) === j.id && lineIsPpf({ title: l.title as string, package_items: l.package_items }, kindOf.get((l.service_id as string | null) ?? "") ?? null));
    if (!ppf.length) continue;
    out.push({ id: j.id as string, number: j.job_number as string, date: j.gated_out_at as string, what: ppf.map((l) => l.title as string).slice(0, 2).join(" + "), checkDone: doneOf.get(j.id as string) ?? null });
  }
  return out;
}

/** The recheck visit's original job and its after-care row: made when it is missing, linked to this visit. */
export async function linkRecheck(originalJobId: string, recheckJobId: string, by: Actor): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("aftercare_checks").select("id").eq("job_id", originalJobId).eq("is_active", true).maybeSingle();
  if (row) await admin.from("aftercare_checks").update({ recheck_job_id: recheckJobId, updated_by: by.id }).eq("id", row.id);
  else await admin.from("aftercare_checks").insert({ job_id: originalJobId, due_date: dubaiDate(), recheck_job_id: recheckJobId, created_by: by.id, updated_by: by.id });
  const [{ data: orig }, { data: visit }] = await Promise.all([admin.from("jobs").select("job_number").eq("id", originalJobId).maybeSingle(), admin.from("jobs").select("job_number").eq("id", recheckJobId).maybeSingle()]);
  await admin.from("job_events").insert([
    { job_id: originalJobId, event_type: "aftercare_booked", note: `The car is back for its free PPF final check: ${visit?.job_number ?? "recheck"} (gate-in by ${by.display_name})`, created_by: by.id },
    { job_id: recheckJobId, event_type: "recheck", note: `PPF RECHECK (FREE) of ${orig?.job_number ?? "the original job"}: no fee, no quotation, no invoice`, created_by: by.id },
  ]);
}

export type RecheckState = { originalId: string; originalNumber: string; aftercareId: string; points: RecheckPoint[]; doneAt: string | null };

/** The checklist of a recheck visit, read from the original job's after-care row. */
export async function recheckStateOf(recheckJobId: string): Promise<RecheckState | null> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("job_kind, recheck_of").eq("id", recheckJobId).maybeSingle();
  if (!job || job.job_kind !== "recheck" || !job.recheck_of) return null;
  const [{ data: row }, { data: orig }] = await Promise.all([
    admin.from("aftercare_checks").select("id, findings, done_at").eq("job_id", job.recheck_of).eq("is_active", true).maybeSingle(),
    admin.from("jobs").select("job_number").eq("id", job.recheck_of).maybeSingle(),
  ]);
  if (!row) return null;
  return { originalId: job.recheck_of as string, originalNumber: (orig?.job_number as string) ?? "", aftercareId: row.id as string, points: recheckPoints(row.findings), doneAt: (row.done_at as string | null) ?? null };
}

/** One point answered (OK / Needs fixing / Not on this car), its note, or its fix ticked. */
export async function saveRecheckPoint(recheckJobId: string, key: RecheckPointKey, patch: { status?: RecheckStatus; note?: string | null; fixed?: boolean }, actor: Actor): Promise<{ error?: string; points?: RecheckPoint[] }> {
  const admin = createAdminClient();
  const st = await recheckStateOf(recheckJobId);
  if (!st) return { error: "This recheck is not linked to its original PPF job." };
  if (st.doneAt) return { error: "The final check is already signed off." };
  const p = st.points.find((x) => x.key === key);
  if (!p) return { error: "Unknown point." };
  if (patch.status === "na" && !p.optional) return { error: `${p.label} is on every PPF car: OK or Needs fixing.` };
  const { data: row } = await admin.from("aftercare_checks").select("findings").eq("id", st.aftercareId).maybeSingle();
  const findings = (row?.findings && typeof row.findings === "object" ? row.findings : {}) as { points?: Record<string, Record<string, unknown>> };
  const points = { ...(findings.points ?? {}) };
  const cur = { ...(points[key] ?? {}) };
  if (patch.status) {
    cur.status = patch.status;
    if (patch.status !== "fix") cur.fixed_at = null;
  }
  if (patch.note !== undefined) cur.note = patch.note ? String(patch.note).trim().slice(0, 500) : null;
  if (patch.fixed !== undefined) {
    if (cur.status !== "fix") return { error: "Only a point that needed fixing is ticked Fixed." };
    cur.fixed_at = patch.fixed ? new Date().toISOString() : null;
    cur.fixed_by = patch.fixed ? actor.id : null;
  }
  cur.by = actor.id;
  points[key] = cur;
  await admin.from("aftercare_checks").update({ findings: { ...findings, points }, updated_by: actor.id }).eq("id", st.aftercareId);
  return { points: recheckPoints({ points }) };
}

/** The recheck stage is done: the original's 10-day check is signed off; a redo makes the visit a comeback too. */
export async function signOffFromRecheck(recheckJobId: string, actor: Actor): Promise<void> {
  const admin = createAdminClient();
  const st = await recheckStateOf(recheckJobId);
  if (!st || st.doneAt) return;
  const redo = recheckRedo(st.points);
  const now = new Date().toISOString();
  const fixed = st.points.filter((p) => p.status === "fix").map((p) => p.label);
  await admin.from("aftercare_checks").update({ done_at: now, done_by: actor.id, recheck_job_id: recheckJobId, redo, notes: fixed.length ? `Fixed at the final check: ${fixed.join(", ")}` : "All points OK", updated_by: actor.id }).eq("id", st.aftercareId);
  await admin.from("job_events").insert({ job_id: st.originalId, event_type: "aftercare_done", note: `PPF final check done by ${actor.display_name}${fixed.length ? `; fixed: ${fixed.join(", ")}` : ": all points OK"}`, created_by: actor.id });
  if (redo) {
    // Something had to be redone: our workmanship, free. It shows on Comebacks; the cost stays on the original job.
    await admin.from("jobs").update({ comeback_of: st.originalId, comeback_cause: "workmanship", comeback_free: true, updated_by: actor.id }).eq("id", recheckJobId);
  }
  await notifyStaff(await jobAdvisorIds(st.originalId), { type: "aftercare_due", title: `PPF final check done · ${st.originalNumber}`, body: `${actor.display_name} signed it off${fixed.length ? `; fixed: ${fixed.join(", ")}` : ": all points OK"}. The warranty shows "Final check done".`, jobId: st.originalId, href: `/jobs/${recheckJobId}` });
}

export type RecheckCost = { minutes: number; labour: number; film: number; cost: number; visits: { id: string; number: string }[] };

/** The recheck visits of these original jobs: their clocked time (bodyshop rate) and the film they used. */
export async function recheckCostsFor(originalIds: string[], settings: Settings): Promise<Map<string, RecheckCost>> {
  const out = new Map<string, RecheckCost>();
  if (!originalIds.length) return out;
  const admin = createAdminClient();
  const { data: visits } = await admin.from("jobs").select("id, job_number, recheck_of").in("recheck_of", originalIds).eq("job_kind", "recheck");
  if (!visits?.length) return out;
  const { data: clocks } = await admin.from("bodyshop_clockings").select("job_id, minutes").in("job_id", visits.map((v) => v.id as string)).eq("is_active", true);
  const rate = costRateFor(settings, "bodyshop");
  for (const v of visits) {
    const minutes = (clocks ?? []).filter((c) => c.job_id === v.id).reduce((a, c) => a + (Number(c.minutes) || 0), 0);
    const f = await jobFilmCost(v.id as string);
    const film = Math.round((f.film + f.tint + f.ceramic) * 100) / 100;
    const labour = Math.round((minutes / 60) * rate * 100) / 100;
    const cur = out.get(v.recheck_of as string) ?? { minutes: 0, labour: 0, film: 0, cost: 0, visits: [] };
    cur.minutes += minutes;
    cur.labour = Math.round((cur.labour + labour) * 100) / 100;
    cur.film = Math.round((cur.film + film) * 100) / 100;
    cur.cost = Math.round((cur.labour + cur.film) * 100) / 100;
    cur.visits.push({ id: v.id as string, number: v.job_number as string });
    out.set(v.recheck_of as string, cur);
  }
  return out;
}

/** "Recheck: 1.2 h · AED 60.00". */
export function recheckCostWords(c: RecheckCost): string {
  return `Recheck: ${(c.minutes / 60).toFixed(1)} h · AED ${c.cost.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The advisor's Waiting on you (30 October 2026): a PPF job delivered at least the set days ago (Settings, default 10)
 * whose final check is not done and whose car is not back for it yet - "Book the PPF final check", until it is.
 */
export async function finalChecksToBook(settings: Settings, advisorId: string | null): Promise<{ jobId: string; number: string; plate: string; car: string; deliveredOn: string; due: string }[]> {
  const admin = createAdminClient();
  const days = Number(settings.bodyshop_final_check_days) || 10;
  const { data: rows } = await admin.from("aftercare_checks").select("job_id, due_date, done_at, recheck_job_id, activated_at").eq("is_active", true).is("done_at", null).is("recheck_job_id", null).is("activated_at", null);
  if (!rows?.length) return [];
  const { data: jobs } = await admin.from("jobs").select(`id, job_number, gated_out_at, advisor_id, gated_in_by, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))`).in("id", rows.map((r) => r.job_id as string)).not("gated_out_at", "is", null);
  const cutoff = Date.now() - days * 86400000;
  const out: { jobId: string; number: string; plate: string; car: string; deliveredOn: string; due: string }[] = [];
  for (const j of (jobs ?? []) as unknown as { id: string; job_number: string; gated_out_at: string; advisor_id: string | null; gated_in_by: string | null; vehicle: (PlateFields & { make: { name: string } | null; model: { name: string } | null }) | null }[]) {
    if (Date.parse(j.gated_out_at) > cutoff) continue;
    if (advisorId && j.advisor_id !== advisorId && j.gated_in_by !== advisorId) continue;
    const row = rows.find((r) => r.job_id === j.id);
    out.push({ jobId: j.id, number: j.job_number, plate: j.vehicle ? formatPlate(j.vehicle) : "", car: [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" "), deliveredOn: formatDate(j.gated_out_at), due: formatDate(String(row?.due_date ?? "")) });
  }
  return out;
}
