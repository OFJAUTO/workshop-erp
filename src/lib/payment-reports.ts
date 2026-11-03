import "server-only";
import type { ExtraWaiting } from "@/components/WaitingPanel";
import type { JobFile } from "@/components/JobFileUpload";
import { customerName } from "./customer-view";
import { realAuthCode } from "./auth-code";
import { jobMoneyOf } from "./customer-money";
import { workingTimeOf } from "./jobs";
import { thumbsFor } from "./media-urls";
import { notifyStaff } from "./notifications";
import { checkReportInput, firstName, methodWord, pickReportForReceipt, reminderHoursOf, reportClosedWords, reportLate, reportLine, reportMethodWords, REPORT_QUERY_MIN, slipKind, type ReportStatus } from "./payment-report-rules";
import { paymentReportsReady } from "./schema-ready";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { isUuid } from "./uuid";
import { JOB_FILES_BUCKET, signJobFiles } from "./work-data";

/**
 * PAYMENT HAND-OVER (2 November 2026, section 3; J-00969). The server side of "Payment received – send to accounts":
 * an advisor's report (amount, method, auth code or reference, the slip photo, a note), the lines accounts and the owner
 * act on (Waiting on you, the job card, the Invoices page), recording it through the one Record payment window (one
 * report, one receipt: the receipt's client key is the report's id), the query back to the advisor, the undo that puts
 * it back, and the working-hours reminder. Dormant until migration 20261203110000_payment_reports (paymentReportsReady).
 */

type Actor = { id: string; display_name: string; role_id: string };

export type PaymentReport = {
  id: string;
  jobId: string;
  jobNumber: string;
  jobOpen: boolean;
  invoiceId: string | null;
  customerId: string;
  customer: string;
  vehicleId: string | null;
  plate: string;
  car: string;
  amount: number;
  method: string;
  authCode: string | null;
  reference: string | null;
  note: string | null;
  status: ReportStatus;
  reporterId: string;
  reporter: string;
  reportedAt: string;
  paymentId: string | null;
  paymentNumber: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
  queryNote: string | null;
  queriedBy: string | null;
  queriedAt: string | null;
  replacesId: string | null;
  replacedBy: string | null;
  remindedAt: string | null;
  /** The slip, receipt or transfer photos the advisor sent (a resend carries the first report's photos). */
  photos: JobFile[];
  /** Small pictures for the lists (by path). */
  thumbs: Record<string, string>;
  /** "J-00969 · DUBAI GG 13706 · MERCEDES-BENZ S 580 · <CUSTOMER> · AED 37,930.00 · Card · from Anas". */
  line: string;
  /** "Card · auth 123456". */
  methodWords: string;
  /** Not recorded or queried within the set working hours. */
  late: boolean;
};

const VEH = "kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)";
const SELECT = `id, job_id, invoice_id, customer_id, vehicle_id, amount_aed, method, auth_code, reference, note, proof_path, status, reported_by, reported_at, payment_id, recorded_by, recorded_at, query_note, queried_by, queried_at, replaces_id, reminded_at, job:jobs(job_number, is_open), vehicle:vehicles(${VEH}), customer:customers(full_name, company_name), payment:payments(number)`;
type V = Parameters<typeof formatPlate>[0] & { model_year: number | null; make: { name: string } | null; model: { name: string } | null };
const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The car as the owner's line names it: make and model in capitals, no year ("MERCEDES-BENZ S 580"). */
const carWords = (v: V | null) => (v ? [v.make?.name, v.model?.name].filter(Boolean).join(" ").toUpperCase() : "");

/** The reports, newest first, with their photos, names and the owner's one-line wording. Empty before the migration. */
export async function loadReports(opts: { jobId?: string; ids?: string[]; status?: ReportStatus[]; reportedBy?: string; limit?: number; settings?: Settings } = {}): Promise<PaymentReport[]> {
  if (!(await paymentReportsReady())) return [];
  const admin = createAdminClient();
  let q = admin.from("payment_reports").select(SELECT).eq("is_active", true);
  if (opts.jobId) q = q.eq("job_id", opts.jobId);
  if (opts.ids) q = q.in("id", opts.ids.length ? opts.ids : ["00000000-0000-0000-0000-000000000000"]);
  if (opts.status) q = q.in("status", opts.status);
  if (opts.reportedBy) q = q.eq("reported_by", opts.reportedBy);
  const { data } = await q.order("reported_at", { ascending: false }).limit(opts.limit ?? 100);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const parents = rows.map((r) => r.replaces_id as string | null).filter((x): x is string => !!x);
  const people = Array.from(new Set(rows.flatMap((r) => [r.reported_by, r.recorded_by, r.queried_by]).filter((x): x is string => typeof x === "string")));
  const [{ data: staff }, { data: files }, { data: later }] = await Promise.all([
    people.length ? admin.from("staff").select("id, display_name").in("id", people) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    admin.from("job_files").select("id, storage_path, ref_id, content_type, caption").eq("kind", "payment_report").in("ref_id", [...ids, ...parents]).is("removed_at", null).order("created_at"),
    admin.from("payment_reports").select("id, replaces_id").in("replaces_id", ids).eq("is_active", true),
  ]);
  const nameOf = new Map((staff ?? []).map((s) => [String(s.id), String(s.display_name)]));
  const filesOf = new Map<string, { id: string; storage_path: string; content_type: string | null; caption: string | null }[]>();
  for (const f of (files ?? []) as { id: string; storage_path: string; ref_id: string; content_type: string | null; caption: string | null }[]) filesOf.set(f.ref_id, [...(filesOf.get(f.ref_id) ?? []), f]);
  const replacedBy = new Map(((later ?? []) as { id: string; replaces_id: string }[]).map((l) => [l.replaces_id, l.id]));
  // Each report's photos: its own, else (a resend with no new photo) the first report's, else the stored path.
  const photoRows = new Map<string, { id: string; path: string; contentType: string | null; caption: string | null }[]>();
  for (const r of rows) {
    const own = filesOf.get(String(r.id)) ?? (r.replaces_id ? filesOf.get(String(r.replaces_id)) : undefined) ?? [];
    photoRows.set(String(r.id), own.length ? own.map((f) => ({ id: f.id, path: f.storage_path, contentType: f.content_type, caption: f.caption })) : r.proof_path ? [{ id: `report:${r.id}`, path: String(r.proof_path), contentType: null, caption: null }] : []);
  }
  const allSlips = Array.from(photoRows.values()).flat();
  const paths = Array.from(new Set(allSlips.map((p) => p.path)));
  // Small pictures only for photos: the image transform cannot draw a PDF or a video (they get their own tile).
  const imagePaths = Array.from(new Set(allSlips.filter((p) => slipKind(p.contentType, p.path) === "image").map((p) => p.path)));
  const [urls, thumbs] = await Promise.all([signJobFiles(paths), thumbsFor(JOB_FILES_BUCKET, imagePaths, 160)]);
  const settings: Settings = opts.settings ?? (await (await import("./settings")).getSettings());
  const wt = workingTimeOf(settings);
  const hours = reminderHoursOf(settings as unknown as Record<string, unknown>);
  const now = Date.now();
  return rows.map((r) => {
    const job = r.job as { job_number: string; is_open: boolean } | null;
    const v = (r.vehicle as V | null) ?? null;
    const c = (r.customer as { full_name: string | null; company_name: string | null } | null) ?? { full_name: null, company_name: null };
    const status = String(r.status) as ReportStatus;
    const reporter = nameOf.get(String(r.reported_by)) ?? "";
    const id = String(r.id);
    const base = {
      id,
      jobId: String(r.job_id),
      jobNumber: job?.job_number ?? "",
      jobOpen: !!job?.is_open,
      invoiceId: (r.invoice_id as string | null) ?? null,
      customerId: String(r.customer_id),
      customer: customerName(c),
      vehicleId: (r.vehicle_id as string | null) ?? null,
      plate: v ? formatPlate(v) : "",
      car: carWords(v),
      amount: Number(r.amount_aed) || 0,
      method: String(r.method),
      // A made-up code (111111) reads as no code: it never pre-fills accounts' box (3 November 2026).
      authCode: realAuthCode(r.auth_code),
      reference: (r.reference as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      status,
      reporterId: String(r.reported_by),
      reporter,
      reportedAt: String(r.reported_at),
      paymentId: (r.payment_id as string | null) ?? null,
      paymentNumber: ((r.payment as { number: string } | null)?.number as string | undefined) ?? null,
      recordedBy: r.recorded_by ? (nameOf.get(String(r.recorded_by)) ?? null) : null,
      recordedAt: (r.recorded_at as string | null) ?? null,
      queryNote: (r.query_note as string | null) ?? null,
      queriedBy: r.queried_by ? (nameOf.get(String(r.queried_by)) ?? null) : null,
      queriedAt: (r.queried_at as string | null) ?? null,
      replacesId: (r.replaces_id as string | null) ?? null,
      replacedBy: replacedBy.get(id) ?? null,
      remindedAt: (r.reminded_at as string | null) ?? null,
    };
    const photos = (photoRows.get(id) ?? []).map((p): JobFile => ({ id: p.id, path: p.path, url: urls[p.path] ?? null, caption: p.caption, contentType: p.contentType, refId: id }));
    return {
      ...base,
      photos,
      thumbs: Object.fromEntries(photos.map((p) => [p.path, thumbs.get(p.path) ?? (slipKind(p.contentType, p.path) === "image" ? (p.url ?? "") : "")])),
      line: reportLine({ jobNumber: base.jobNumber, plate: base.plate, car: base.car, customer: base.customer, amount: base.amount, method: base.method, reporter }),
      methodWords: reportMethodWords(base),
      late: status === "waiting" && reportLate(base.reportedAt, now, wt, hours),
    };
  });
}

/** One report for the Record payment window: what to pre-fill, its photos, and why it can't be recorded any more. */
export type WindowReport = { id: string; jobId: string; status: ReportStatus; amount: number; method: string; authCode: string | null; reference: string | null; note: string | null; reporter: string; reportedAt: string; photos: JobFile[]; thumbs: Record<string, string>; line: string; methodWords: string; closed: string | null };

export async function reportForWindow(reportId: string, settings: Settings): Promise<WindowReport | null> {
  if (!isUuid(reportId)) return null;
  const [r] = await loadReports({ ids: [reportId], settings });
  if (!r) return null;
  return { id: r.id, jobId: r.jobId, status: r.status, amount: r.amount, method: r.method, authCode: r.authCode, reference: r.reference, note: r.note, reporter: r.reporter, reportedAt: r.reportedAt, photos: r.photos, thumbs: r.thumbs, line: r.line, methodWords: r.methodWords, closed: reportClosedWords({ status: r.status, paymentNumber: r.paymentNumber, queriedBy: r.queriedBy, queryNote: r.queryNote, reporter: r.reporter }) };
}

/** Who records money and so hears about a report: every active accounts person and the owner, never the reporter himself. */
async function moneyPeople(except: string | null): Promise<{ id: string; display_name: string; role_id: string }[]> {
  const { data } = await createAdminClient().from("staff").select("id, display_name, role_id").in("role_id", ["accounts", "owner"]).eq("is_active", true);
  return ((data ?? []) as { id: string; display_name: string; role_id: string }[]).filter((s) => s.id !== except);
}

export type ReportResult = { error?: string; ok?: boolean; repeat?: boolean; ask?: "second"; askWords?: string; told?: string[]; /** The form's key was already used for another payment: the window starts a new key. */ renewKey?: boolean };

/**
 * The same key twice: the same report (its answer was lost) only when it is the same advisor, car, amount and method.
 * A different payment under a used key (a copied tab) is refused - nothing is sent for it - and the slip it attached
 * under that key after the first report was made is taken off the first report.
 */
async function sameKeyAnswer(existing: { id: string; reported_by: string; job_id: string; amount_aed: number; method: string; reported_at: string }, actor: Actor, jobId: string, c: { amount: number; method: string }): Promise<ReportResult> {
  const same = existing.reported_by === actor.id && existing.job_id === jobId && Math.abs((Number(existing.amount_aed) || 0) - c.amount) < 0.005 && existing.method === c.method;
  if (same) return { ok: true, repeat: true };
  if (existing.reported_by === actor.id && existing.job_id === jobId) {
    const now = new Date().toISOString();
    await createAdminClient().from("job_files").update({ removed_at: now, removed_by: actor.id, updated_by: actor.id }).eq("kind", "payment_report").eq("ref_id", existing.id).eq("job_id", jobId).is("removed_at", null).gt("created_at", existing.reported_at);
  }
  return { error: `This window was already used to send ${aed(Number(existing.amount_aed) || 0)} · ${methodWord(existing.method)}. Nothing new was sent – attach the photo again and send this payment.`, renewKey: true };
}

/**
 * An advisor's "Payment received – send to accounts". The photo of the slip, receipt or transfer must already be on the
 * server under the report's own id (the form's browser-made key); the same key twice is the same report. A report sent
 * again after a query replaces the queried one (and may carry its photo). A second report on a car that already has one
 * waiting asks once.
 */
export async function createPaymentReport(actor: Actor, input: { id: string; jobId: string; amount: unknown; method: unknown; authCode?: unknown; reference?: unknown; note?: unknown; replacesId?: string | null; confirmSecond?: boolean }, settings: Settings): Promise<ReportResult> {
  if (!(await paymentReportsReady())) return { error: "This needs the database update of 2 November (payment hand-over). Ask the owner to apply it." };
  if (!(actor.role_id === "service_advisor" || actor.role_id === "owner")) return { error: actor.role_id === "accounts" ? "Accounts record the payment directly: use Record payment." : "Payments are sent to accounts by the advisors." };
  if (!isUuid(input.id) || !isUuid(input.jobId)) return { error: "Reload the page and try again." };
  const checked = checkReportInput(input);
  if ("error" in checked) return { error: checked.error };
  const c = checked.ok;
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, customer_id, vehicle_id").eq("id", input.jobId).maybeSingle();
  if (!job) return { error: "This car's record was not found." };
  // The same tap twice (its answer was lost): the report already made - if it is the same payment.
  const SAME_KEY = "id, reported_by, job_id, amount_aed, method, reported_at";
  const { data: same } = await admin.from("payment_reports").select(SAME_KEY).eq("id", input.id).maybeSingle();
  if (same) return sameKeyAnswer(same as { id: string; reported_by: string; job_id: string; amount_aed: number; method: string; reported_at: string }, actor, input.jobId, c);
  // Sent again after a query: the queried report on the same car, by the same advisor (or the owner).
  let replaced: { id: string; proof_path: string } | null = null;
  if (input.replacesId) {
    if (!isUuid(input.replacesId)) return { error: "The report to send again was not found." };
    const { data: old } = await admin.from("payment_reports").select("id, job_id, status, reported_by, proof_path, reported_at, queried_at, payment:payments(number)").eq("id", input.replacesId).eq("is_active", true).maybeSingle();
    if (!old || old.job_id !== input.jobId) return { error: "The report to send again was not found on this car." };
    if (old.status !== "queried") return { error: old.status === "recorded" ? `That payment is already recorded${(old.payment as unknown as { number: string } | null)?.number ? ` as ${(old.payment as unknown as { number: string }).number}` : ""} – nothing to send again.` : "Only a queried report is sent again." };
    if (old.reported_by !== actor.id && actor.role_id !== "owner") return { error: "Only the advisor who sent it (or the owner) sends it again." };
    replaced = { id: String(old.id), proof_path: String(old.proof_path) };
    // Money recorded on this car after the query may be this very payment (accounts found it in the bank): asked once.
    if (!input.confirmSecond) {
      const since = String(old.queried_at ?? old.reported_at);
      const { data: after } = await admin.from("payments").select("number, amount_aed, method, received_by").eq("job_id", input.jobId).eq("is_active", true).in("status", ["recorded", "pending_owner"]).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
      const p = (after ?? [])[0] as { number: string; amount_aed: number; method: string; received_by: string | null } | undefined;
      if (p) {
        const { data: who } = p.received_by ? await admin.from("staff").select("display_name").eq("id", p.received_by).maybeSingle() : { data: null };
        return { ask: "second", askWords: `${p.number} · ${aed(Number(p.amount_aed) || 0)} · ${methodWord(p.method)} was recorded on this car after the query${who?.display_name ? ` by ${firstName(String(who.display_name))}` : ""}. If that is this payment, close the window. Is this a different payment? Send it as well?` };
      }
    }
  }
  // The photo is required: on the server already, under this report's id (a resend may keep the first one).
  const { data: files } = await admin.from("job_files").select("id, storage_path").eq("job_id", input.jobId).eq("kind", "payment_report").eq("ref_id", input.id).is("removed_at", null).order("created_at");
  const proofPath = ((files ?? [])[0]?.storage_path as string | undefined) ?? replaced?.proof_path ?? null;
  if (!proofPath) return { error: "Attach the photo of the slip, receipt or transfer first." };
  // Someone already reported a payment on this car that waits: asked once, never blocked.
  if (!input.confirmSecond) {
    const { data: open } = await admin.from("payment_reports").select("id, amount_aed, method, reported_by, reported_at").eq("job_id", input.jobId).eq("status", "waiting").eq("is_active", true).order("reported_at", { ascending: false }).limit(1);
    const o = (open ?? [])[0] as { amount_aed: number; method: string; reported_by: string; reported_at: string } | undefined;
    if (o) {
      const { data: who } = await admin.from("staff").select("display_name").eq("id", o.reported_by).maybeSingle();
      const at = new Date(o.reported_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
      return { ask: "second", askWords: `${firstName((who?.display_name as string | undefined) ?? "Someone")} already reported ${aed(Number(o.amount_aed) || 0)} · ${methodWord(o.method)} at ${at}, still waiting for accounts. Send this one as well?` };
    }
  }
  const money = await jobMoneyOf(input.jobId, settings);
  const { error } = await admin.from("payment_reports").insert({
    id: input.id,
    job_id: input.jobId,
    invoice_id: money?.live?.id ?? null,
    customer_id: job.customer_id,
    vehicle_id: job.vehicle_id,
    amount_aed: c.amount,
    method: c.method,
    auth_code: c.authCode,
    reference: c.reference,
    note: c.note,
    proof_path: proofPath,
    status: "waiting",
    reported_by: actor.id,
    replaces_id: replaced?.id ?? null,
    created_by: actor.id,
    updated_by: actor.id,
  });
  if (error) {
    const { data: again } = await admin.from("payment_reports").select(SAME_KEY).eq("id", input.id).maybeSingle();
    if (again) return sameKeyAnswer(again as { id: string; reported_by: string; job_id: string; amount_aed: number; method: string; reported_at: string }, actor, input.jobId, c);
    const { logAppError, SAVE_FAILED } = await import("./app-errors");
    await logAppError("payment report: insert", error, { staffId: actor.id, jobId: input.jobId });
    return { error: SAVE_FAILED };
  }
  if (replaced) await admin.from("payment_reports").update({ status: "withdrawn", withdrawn_reason: "Sent again after the query", withdrawn_by: actor.id, withdrawn_at: new Date().toISOString(), updated_by: actor.id }).eq("id", replaced.id).eq("status", "queried");
  const plate = await plateOf(String(job.vehicle_id));
  const words = `${aed(c.amount)} by ${methodWord(c.method).toLowerCase()}${c.authCode ? ` (auth ${c.authCode})` : c.reference ? ` (ref ${c.reference})` : ""}`;
  await admin.from("job_events").insert({ job_id: input.jobId, event_type: "payment", note: `Payment reported by ${actor.display_name}: ${words}, slip attached${c.note ? ` – ${c.note}` : ""}. Waiting for accounts.${replaced ? " (Sent again after the query.)" : ""}`, created_by: actor.id });
  const people = await moneyPeople(actor.id);
  const [r] = await loadReports({ ids: [input.id], settings });
  await notifyStaff(people.map((p) => p.id), {
    type: "payment_reported",
    title: `Payment reported · ${job.job_number} · ${plate.toUpperCase()} · ${aed(c.amount)} · ${methodWord(c.method)} · from ${firstName(actor.display_name)}`,
    body: `${[r?.car, r?.customer].filter(Boolean).join(" · ")} · slip attached · tap to record it${c.note ? ` · "${c.note}"` : ""}`,
    jobId: input.jobId,
    href: reportHref(input.jobId, input.id),
  });
  return { ok: true, told: people.filter((p) => p.role_id === "accounts").map((p) => firstName(p.display_name)) };
}

/** Where a report opens: the job card with the Record payment window on it, pre-filled. */
export const reportHref = (jobId: string, reportId: string) => `/jobs/${jobId}?pay-report=${reportId}#invoice`;

async function plateOf(vehicleId: string): Promise<string> {
  const { data } = await createAdminClient().from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, vin").eq("id", vehicleId).maybeSingle();
  return data ? formatPlate(data as Parameters<typeof formatPlate>[0]) : "";
}

/**
 * Before a reported payment is recorded (paymentFromForm): the report must still wait, be for the same car, and the
 * receipt's key must be the report's own id - so one report makes one receipt, never two.
 */
export async function reportToRecord(reportId: string, clientKey: string | null): Promise<{ error?: string; report?: { id: string; jobId: string; proofPath: string; amount: number; method: string } }> {
  if (!(await paymentReportsReady())) return { error: "This needs the database update of 2 November (payment hand-over)." };
  if (!isUuid(reportId)) return { error: "The reported payment was not found." };
  const { data: r } = await createAdminClient().from("payment_reports").select("id, job_id, status, proof_path, amount_aed, method, payment:payments(number)").eq("id", reportId).eq("is_active", true).maybeSingle();
  if (!r) return { error: "The reported payment was not found." };
  if (r.status !== "waiting") return { error: reportClosedWords({ status: r.status as ReportStatus, paymentNumber: ((r.payment as unknown as { number: string } | null)?.number) ?? null }) ?? "This report can't be recorded." };
  if (clientKey !== reportId) return { error: "Reload the page and open the reported payment again." };
  return { report: { id: String(r.id), jobId: String(r.job_id), proofPath: String(r.proof_path), amount: Number(r.amount_aed) || 0, method: String(r.method) } };
}

/**
 * The receipt is written: the report is recorded, logged on the car, and its advisor hears "Recorded ✓ RCT-…". A report
 * that was queried back is closed the same way when the money is recorded after all (the query is settled).
 */
export async function closeReportWithPayment(reportId: string, payment: { id: string; number: string; amount: number; method: string }, actor: { id: string | null; display_name: string }): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: before } = await admin.from("payment_reports").select("status").eq("id", reportId).maybeSingle();
  const wasQueried = before?.status === "queried";
  const { data: done } = await admin.from("payment_reports").update({ status: "recorded", payment_id: payment.id, recorded_by: actor.id, recorded_at: now, updated_by: actor.id }).eq("id", reportId).in("status", ["waiting", "queried"]).select("id, job_id, reported_by, amount_aed, method");
  const r = (done ?? [])[0] as { id: string; job_id: string; reported_by: string; amount_aed: number; method: string } | undefined;
  if (!r) return;
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", r.job_id).maybeSingle();
  const differs = Math.abs((Number(r.amount_aed) || 0) - payment.amount) > 0.005 || r.method !== payment.method;
  await admin.from("job_events").insert({ job_id: r.job_id, event_type: "payment", note: `${payment.number} recorded by ${actor.display_name} from the payment the advisor sent${wasQueried ? " (after the query)" : ""}${differs ? ` (reported ${aed(Number(r.amount_aed) || 0)} by ${methodWord(r.method).toLowerCase()}, recorded ${aed(payment.amount)} by ${methodWord(payment.method).toLowerCase()})` : ""}.`, created_by: actor.id });
  await notifyStaff([r.reported_by], {
    type: "payment_report_recorded",
    title: `Recorded ✓ ${payment.number} · ${job?.job_number ?? ""} · ${aed(payment.amount)}`,
    body: `${actor.id ? `by ${firstName(actor.display_name)}` : "paid online through the payment page"}${wasQueried ? " · the query is settled, nothing to send again" : ""}${differs ? ` · you sent ${aed(Number(r.amount_aed) || 0)} by ${methodWord(r.method).toLowerCase()}` : ""}`,
    jobId: r.job_id,
    href: `/jobs/${r.job_id}#invoice`,
  });
}

/**
 * Every receipt on a job (recordPaymentCore): the report it was recorded from is closed by it; a receipt recorded
 * another way (the money page, the deposit panel, Pay now) answers the report on that job for the same amount and method
 * - waiting, or queried back and now in the bank - unless its auth code or reference says it is a DIFFERENT payment
 * (pickReportForReceipt). The advisor's report is answered, never left waiting for money already in.
 */
export async function afterReceiptForReports(payment: { id: string; number: string; amount: number; method: string; jobId: string; authCode?: string | null; reference?: string | null }, reportId: string | null, actor: { id: string | null; display_name: string }): Promise<void> {
  if (!(await paymentReportsReady())) return;
  if (reportId) return closeReportWithPayment(reportId, payment, actor);
  const { data } = await createAdminClient().from("payment_reports").select("id, amount_aed, status, auth_code, reference, reported_at").eq("job_id", payment.jobId).in("status", ["waiting", "queried"]).eq("is_active", true).eq("method", payment.method).order("reported_at").limit(20);
  const rows = (data ?? []) as { id: string; amount_aed: number; status: ReportStatus; auth_code: string | null; reference: string | null; reported_at: string }[];
  const pick = pickReportForReceipt(rows.map((r) => ({ id: r.id, amount: Number(r.amount_aed) || 0, status: r.status, authCode: r.auth_code, reference: r.reference, reportedAt: r.reported_at })), { amount: payment.amount, authCode: payment.authCode ?? null, reference: payment.reference ?? null });
  if (pick) await closeReportWithPayment(pick, payment, actor);
}

/** Accounts (or the owner) send a report back with a comment: the advisor is told and sends it again or withdraws it. */
export async function queryReport(reportId: string, note: string, actor: Actor): Promise<{ error?: string; ok?: boolean }> {
  if (!(await paymentReportsReady())) return { error: "This needs the database update of 2 November (payment hand-over)." };
  if (!(actor.role_id === "accounts" || actor.role_id === "owner")) return { error: "Accounts or the owner query a reported payment." };
  if (!isUuid(reportId)) return { error: "The reported payment was not found." };
  const clean = note.trim().slice(0, 500);
  if (clean.length < REPORT_QUERY_MIN) return { error: "Write what is wrong (a few words) – the advisor reads it." };
  const admin = createAdminClient();
  const { data: done } = await admin.from("payment_reports").update({ status: "queried", query_note: clean, queried_by: actor.id, queried_at: new Date().toISOString(), updated_by: actor.id }).eq("id", reportId).eq("status", "waiting").eq("is_active", true).select("id, job_id, reported_by, amount_aed, method");
  const r = (done ?? [])[0] as { id: string; job_id: string; reported_by: string; amount_aed: number; method: string } | undefined;
  if (!r) {
    const { data: now } = await admin.from("payment_reports").select("status, query_note, payment:payments(number)").eq("id", reportId).maybeSingle();
    return { error: now ? (reportClosedWords({ status: now.status as ReportStatus, paymentNumber: ((now.payment as unknown as { number: string } | null)?.number) ?? null, queryNote: now.query_note as string | null, queriedBy: null }) ?? "Not waiting any more.") : "The reported payment was not found." };
  }
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", r.job_id).maybeSingle();
  await admin.from("job_events").insert({ job_id: r.job_id, event_type: "payment", note: `Reported payment of ${aed(Number(r.amount_aed) || 0)} queried by ${actor.display_name}: ${clean}`, created_by: actor.id });
  await notifyStaff([r.reported_by], {
    type: "payment_report_queried",
    title: `Query on your payment · ${job?.job_number ?? ""} · ${aed(Number(r.amount_aed) || 0)} · ${methodWord(r.method)}`,
    body: `${clean} – ${firstName(actor.display_name)}`,
    jobId: r.job_id,
    href: `/jobs/${r.job_id}#invoice`,
  });
  return { ok: true };
}

/** The advisor who sent it (or the owner) takes a report back: sent by mistake, or the query is settled another way. */
export async function withdrawReport(reportId: string, reason: string, actor: Actor): Promise<{ error?: string; ok?: boolean }> {
  if (!(await paymentReportsReady())) return { error: "This needs the database update of 2 November (payment hand-over)." };
  if (!isUuid(reportId)) return { error: "The reported payment was not found." };
  const admin = createAdminClient();
  const { data: r } = await admin.from("payment_reports").select("id, job_id, status, reported_by, amount_aed").eq("id", reportId).eq("is_active", true).maybeSingle();
  if (!r) return { error: "The reported payment was not found." };
  if (r.reported_by !== actor.id && actor.role_id !== "owner") return { error: "Only the advisor who sent it (or the owner) withdraws it." };
  if (!(r.status === "waiting" || r.status === "queried")) return { error: r.status === "recorded" ? "It is already recorded: accounts or the owner undo the receipt instead." : "Already withdrawn." };
  const clean = reason.trim().slice(0, 300) || "Withdrawn by the advisor";
  const { data: done } = await admin.from("payment_reports").update({ status: "withdrawn", withdrawn_reason: clean, withdrawn_by: actor.id, withdrawn_at: new Date().toISOString(), updated_by: actor.id }).eq("id", reportId).in("status", ["waiting", "queried"]).select("id");
  if (!(done ?? []).length) return { error: "It changed a moment ago – reload the page." };
  await admin.from("job_events").insert({ job_id: r.job_id, event_type: "payment", note: `Reported payment of ${aed(Number(r.amount_aed) || 0)} withdrawn by ${actor.display_name}: ${clean}`, created_by: actor.id });
  return { ok: true };
}

/**
 * A receipt made from (or answering) a report was undone inside the undo window, or voided later by the owner or the
 * head accountant: the report waits for accounts again and its advisor is told - never a green "Recorded ✓" on a voided
 * receipt. The voided receipt gives up the report's key, so the report can be recorded again (one live receipt each).
 */
export async function reopenReportsOfPayment(paymentId: string, actor: { id: string | null; display_name: string }, how: { word: "undone" | "voided"; reason?: string | null } = { word: "undone" }): Promise<void> {
  if (!(await paymentReportsReady())) return;
  const admin = createAdminClient();
  const { data: back } = await admin.from("payment_reports").update({ status: "waiting", payment_id: null, recorded_by: null, recorded_at: null, reminded_at: null, updated_by: actor.id }).eq("payment_id", paymentId).eq("status", "recorded").select("id, job_id, reported_by, amount_aed");
  const why = how.reason ? ` (${how.reason})` : "";
  for (const r of (back ?? []) as { id: string; job_id: string; reported_by: string; amount_aed: number }[]) {
    await admin.from("payments").update({ client_key: `${how.word}:${paymentId}`, updated_by: actor.id }).eq("id", paymentId).eq("client_key", r.id);
    const { data: p } = await admin.from("payments").select("number").eq("id", paymentId).maybeSingle();
    await admin.from("job_events").insert({ job_id: r.job_id, event_type: "payment", note: `${p?.number ?? "The receipt"} was ${how.word} by ${actor.display_name}${why}: the reported payment of ${aed(Number(r.amount_aed) || 0)} waits for accounts again.`, created_by: actor.id });
    await notifyStaff([r.reported_by], { type: "payment_report_undone", title: `Receipt ${how.word} · your payment of ${aed(Number(r.amount_aed) || 0)} waits for accounts again`, body: `${p?.number ?? "The receipt"} was ${how.word} by ${firstName(actor.display_name)}${why}.`, jobId: r.job_id, href: `/jobs/${r.job_id}#invoice` });
  }
}

/**
 * The hourly reminder (cron step 27): a report not recorded or queried within the set WORKING hours tells accounts and
 * the owner once (its Waiting line is red already). Returns how many reminders went.
 */
export async function paymentReportsHourly(settings: Settings): Promise<number> {
  if (!(await paymentReportsReady())) return 0;
  const hours = reminderHoursOf(settings as unknown as Record<string, unknown>);
  const due = (await loadReports({ status: ["waiting"], settings, limit: 200 })).filter((r) => r.late && !r.remindedAt);
  if (!due.length) return 0;
  const admin = createAdminClient();
  let told = 0;
  for (const r of due) {
    // Claimed first, so two runs never ring twice.
    const { data: claimed } = await admin.from("payment_reports").update({ reminded_at: new Date().toISOString() }).eq("id", r.id).eq("status", "waiting").is("reminded_at", null).select("id");
    if (!(claimed ?? []).length) continue;
    const people = await moneyPeople(null);
    await notifyStaff(people.map((p) => p.id), {
      type: "payment_report_late",
      title: `Not recorded after ${hours} working hour${hours === 1 ? "" : "s"} · ${r.jobNumber} · ${aed(r.amount)} · from ${firstName(r.reporter)}`,
      body: `${r.line} · reported ${new Date(r.reportedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })}`,
      jobId: r.jobId,
      href: reportHref(r.jobId, r.id),
    });
    told++;
  }
  return told;
}

/**
 * The Waiting on you lines of reports (one rule for every page that shows the panel): accounts and the owner see each
 * report still waiting - in the owner's words, with the slip, Record and Query right on the row, red once it is late;
 * an advisor sees his own reports that came back with a query.
 */
export async function reportWaitingItems(staff: { id: string; role_id: string }, settings: Settings): Promise<ExtraWaiting[]> {
  if (!(await paymentReportsReady())) return [];
  if (staff.role_id === "accounts" || staff.role_id === "owner") {
    return (await loadReports({ status: ["waiting"], settings })).map((r) => ({
      jobId: `payrep:${r.id}`,
      plate: "Payment reported",
      car: null,
      what: r.line,
      amount: null,
      actionLabel: "Record",
      href: reportHref(r.jobId, r.id),
      always: true,
      urgency: r.late ? "red" : "amber",
      since: r.reportedAt,
      hint: `${r.methodWords}${r.note ? ` · "${r.note}"` : ""}. Tap Record: the window opens pre-filled with the slip attached; check it and confirm, or Query it back to ${firstName(r.reporter)}.`,
      inline: { kind: "payment_report", reportId: r.id, jobId: r.jobId, thumb: r.photos[0] ? (r.thumbs[r.photos[0].path] || null) : null, url: r.photos[0]?.url ?? null, contentType: r.photos[0]?.contentType ?? null, path: r.photos[0]?.path ?? null, label: `${r.jobNumber} · ${methodWord(r.method)} slip` },
    }));
  }
  if (staff.role_id === "service_advisor") {
    return (await loadReports({ status: ["queried"], reportedBy: staff.id, settings }))
      .filter((r) => !r.replacedBy)
      .map((r) => ({
        jobId: `payrep:${r.id}`,
        plate: "Query on your payment",
        car: null,
        what: `${r.jobNumber} · ${r.plate.toUpperCase()} · ${aed(r.amount)} · ${methodWord(r.method)} – "${r.queryNote ?? ""}" – ${firstName(r.queriedBy)}`,
        amount: null,
        actionLabel: "Open",
        href: `/jobs/${r.jobId}#invoice`,
        always: true,
        urgency: "amber" as const,
        since: r.queriedAt ?? r.reportedAt,
        hint: "Open the job card: Send again with the right details, or Withdraw it.",
      }));
  }
  return [];
}

/** The jobs with a report waiting and who sent the newest (the money chip "Payment reported by Anas, checking"). */
export async function waitingReportByJob(jobIds?: string[]): Promise<Map<string, { by: string; amount: number }>> {
  const out = new Map<string, { by: string; amount: number }>();
  if (!(await paymentReportsReady())) return out;
  const admin = createAdminClient();
  let q = admin.from("payment_reports").select("job_id, reported_by, amount_aed, reported_at").eq("status", "waiting").eq("is_active", true);
  if (jobIds) q = q.in("job_id", jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q.order("reported_at", { ascending: false });
  const rows = (data ?? []) as { job_id: string; reported_by: string; amount_aed: number }[];
  if (!rows.length) return out;
  const { data: names } = await admin.from("staff").select("id, display_name").in("id", Array.from(new Set(rows.map((r) => r.reported_by))));
  const nameOf = new Map((names ?? []).map((n) => [String(n.id), String(n.display_name)]));
  for (const r of rows) if (!out.has(r.job_id)) out.set(r.job_id, { by: firstName(nameOf.get(r.reported_by)), amount: Number(r.amount_aed) || 0 });
  return out;
}
