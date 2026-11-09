import "server-only";
import { ARCHIVE_DAYS, ACTION_RULES, hrefId, isActionType, taskStillOpen, type TaskFacts } from "./bell-rules";
import { PROMISE_NEEDED } from "./promise-dates";
import { depositsWaiting } from "./deposits";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";
import { logAppError } from "./app-errors";
import { chunks } from "./page-all";

/** notifications.cleared_at / archived_at exist (migration 20261210100000_bell_open_only.sql). */
export const bellColumnsReady = () => schemaReady("notifications", "cleared_at, archived_at");

type Notice = { id: number; staff_id: string; type: string; job_id: string | null; href: string | null };

/**
 * Clears every unread ACTION notice whose task is done, for everyone who got it (9 November 2026). Reads the facts
 * once per run; marks the notices read (and cleared_at once the column exists). dryRun counts without writing.
 * Returns how many were cleared.
 */
export async function clearDoneNotices(opts: { dryRun?: boolean; sinceDays?: number } = {}): Promise<{ cleared: number; checked: number }> {
  const admin = createAdminClient();
  const types = Object.keys(ACTION_RULES).filter((t) => ACTION_RULES[t].open !== "manual");
  const since = new Date(Date.now() - (opts.sinceDays ?? 120) * 86400000).toISOString();
  const notices: Notice[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("notifications").select("id, staff_id, type, job_id, href").is("read_at", null).in("type", types).gte("created_at", since).order("id").range(from, from + 999);
    if (error) { logAppError("bell-clear", error); return { cleared: 0, checked: 0 }; }
    notices.push(...((data ?? []) as Notice[]));
    if (!data || data.length < 1000) break;
  }
  if (!notices.length) return { cleared: 0, checked: 0 };

  const jobIds = [...new Set(notices.map((n) => n.job_id).filter(Boolean) as string[])];
  const poIds = [...new Set(notices.map((n) => hrefId(n.href, "po")).filter(Boolean) as string[])];
  const reportIds = [...new Set(notices.map((n) => hrefId(n.href, "report")).filter(Boolean) as string[])];
  const quoteIds = [...new Set(notices.map((n) => hrefId(n.href, "quote")).filter(Boolean) as string[])];

  const jobs = new Map<string, NonNullable<TaskFacts["job"]> & { vehicle_id: string | null; advisor_id: string | null }>();
  for (const ids of chunks(jobIds)) {
    const { data } = await admin.from("jobs").select("id, status, is_open, assigned_to, promised_at, plan_date_confirmed_at, ready_sent_at, inspection_fee_request_aed, followup_due_at, followup_done_at, vehicle_id, advisor_id").in("id", ids);
    for (const j of (data ?? []) as (NonNullable<TaskFacts["job"]> & { id: string; vehicle_id: string | null; advisor_id: string | null })[]) jobs.set(j.id, j);
  }
  const quotes = new Map<string, NonNullable<TaskFacts["quote"]>>();
  for (const ids of chunks(quoteIds)) {
    const { data } = await admin.from("quotations").select("id, status, revision_requested_at, revision_allowed_at, revision_declined_at, commission_status").in("id", ids);
    for (const q of (data ?? []) as (NonNullable<TaskFacts["quote"]> & { id: string })[]) quotes.set(q.id, q);
  }
  const pos = new Map<string, NonNullable<TaskFacts["po"]>>();
  for (const ids of chunks(poIds)) {
    const [{ data }, { data: lines }] = await Promise.all([
      admin.from("purchase_orders").select("id, status, supplier_invoice_status").in("id", ids),
      admin.from("purchase_order_lines").select("po_id").in("po_id", ids).eq("invoice_check", "mismatch"),
    ]);
    const mismatch = new Set(((lines ?? []) as { po_id: string }[]).map((l) => l.po_id));
    for (const p of (data ?? []) as { id: string; status: string; supplier_invoice_status: string | null }[]) pos.set(p.id, { status: p.status, supplier_invoice_status: p.supplier_invoice_status, invoice_check: mismatch.has(p.id) ? "mismatch" : null });
  }
  const reports = new Map<string, { status: string }>();
  for (const ids of chunks(reportIds)) {
    const { data } = await admin.from("payment_reports").select("id, status").in("id", ids);
    for (const r of (data ?? []) as { id: string; status: string }[]) reports.set(r.id, r);
  }
  const needsDeposit = notices.some((n) => ACTION_RULES[n.type]?.open === "deposit_short");
  const short = needsDeposit ? new Set((await depositsWaiting()).map((d) => d.jobId)) : new Set<string>();
  const vehicleIds = [...new Set([...jobs.values()].map((j) => j.vehicle_id).filter(Boolean) as string[])];
  const noPlate = new Set<string>();
  if (notices.some((n) => n.type === "plate_missing")) {
    for (const ids of chunks(vehicleIds)) {
      const { data } = await admin.from("vehicles").select("id").in("id", ids).eq("has_plate", false);
      for (const v of (data ?? []) as { id: string }[]) noPlate.add(v.id);
    }
  }
  // Promised dates: the advisors (and, for jobs with none, the owner) who still have an approved car with no date.
  const promiseOwed = new Set<string>();
  if (notices.some((n) => n.type === "promised_missing")) {
    const { data } = await admin.from("jobs").select("advisor_id").eq("is_open", true).is("promised_at", null).in("status", [...PROMISE_NEEDED]);
    const rows = (data ?? []) as { advisor_id: string | null }[];
    for (const r of rows) if (r.advisor_id) promiseOwed.add(r.advisor_id);
    if (rows.some((r) => !r.advisor_id)) promiseOwed.add("owner");
  }
  const { data: owners } = await admin.from("staff").select("id").eq("role_id", "owner");
  const ownerIds = new Set(((owners ?? []) as { id: string }[]).map((o) => o.id));

  const done: number[] = [];
  for (const n of notices) {
    if (!isActionType(n.type)) continue;
    const job = n.job_id ? jobs.get(n.job_id) ?? null : null;
    const qid = hrefId(n.href, "quote");
    const poid = hrefId(n.href, "po");
    const rid = hrefId(n.href, "report");
    const facts: TaskFacts = {
      job,
      quote: qid ? quotes.get(qid) ?? null : null,
      po: poid ? pos.get(poid) ?? null : null,
      report: rid ? reports.get(rid) ?? null : null,
      depositShort: n.job_id ? short.has(n.job_id) : undefined,
      plateMissing: job?.vehicle_id ? noPlate.has(job.vehicle_id) : undefined,
      promiseMissingForStaff: n.type === "promised_missing" ? promiseOwed.has(n.staff_id) || (ownerIds.has(n.staff_id) && promiseOwed.has("owner")) : undefined,
    };
    if (!taskStillOpen(n.type, facts)) done.push(n.id);
  }
  if (!opts.dryRun && done.length) {
    const cols = await bellColumnsReady();
    const at = new Date().toISOString();
    for (const ids of chunks(done.map(String))) {
      const { error } = await admin.from("notifications").update({ read_at: at, ...(cols ? { cleared_at: at } : {}) }).in("id", ids.map(Number)).is("read_at", null);
      if (error) logAppError("bell-clear/update", error);
    }
  }
  return { cleared: done.length, checked: notices.length };
}

/** Archives read and cleared notices older than 30 days (they leave the panel; nothing is deleted). */
export async function archiveOldNotices(): Promise<number> {
  if (!(await bellColumnsReady())) return 0;
  const admin = createAdminClient();
  const before = new Date(Date.now() - ARCHIVE_DAYS * 86400000).toISOString();
  const { data, error } = await admin.from("notifications").update({ archived_at: new Date().toISOString() }).is("archived_at", null).not("read_at", "is", null).lt("read_at", before).select("id");
  if (error) { logAppError("bell-archive", error); return 0; }
  return (data ?? []).length;
}

let lastRun = 0;
/** At most once a minute per server: the bell's own GET calls this after answering. */
export async function clearDoneNoticesSoon(): Promise<void> {
  if (Date.now() - lastRun < 60000) return;
  lastRun = Date.now();
  await clearDoneNotices().catch((e) => logAppError("bell-clear", e));
}
