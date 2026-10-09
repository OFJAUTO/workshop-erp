import "server-only";
import { LINE_SELECT, toLine } from "./quote-data";
import { hasCostFloor, isHidden } from "./quotes";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";

export const JOB_FILES_BUCKET = "job-files";

export type WorkLineRow = {
  id: string;
  job_id: string;
  quotation_line_id: string | null;
  source: "quotation" | "additional";
  position: number;
  title: string;
  details: string | null;
  hours_quoted: number | null;
  assigned_to: string | null;
  status: "todo" | "in_progress" | "done";
  done_at: string | null;
  done_by: string | null;
  notes: string | null;
  created_at: string;
};
export type WorkSessionRow = { id: string; job_id: string; technician_id: string; started_at: string; ended_at: string | null; end_reason: "stop" | "pause" | "complete" | "auto" | null; pause_reason: string | null; minutes: number | null };
export type AdditionalWorkRow = { id: string; job_id: string; technician_id: string | null; work_line_id: string | null; remark: string; parts_needed: string | null; status: "pending" | "approved" | "rejected"; decided_by: string | null; decided_at: string | null; decision_note: string | null; quotation_id: string | null; created_at: string; quotation_status?: string | null };

/** What an approved finding is waiting for, from the state of its quotation. */
export function additionalWorkLabel(a: AdditionalWorkRow): { text: string; tone: "neutral" | "amber" | "green" | "red" | "ink" } {
  if (a.status === "rejected") return { text: "Not approved by the manager", tone: "red" };
  if (a.status === "pending") return { text: "With the manager", tone: "amber" };
  if (a.quotation_status === "approved") return { text: "Approved by the customer: on the work order", tone: "green" };
  if (a.quotation_status === "declined" || a.quotation_status === "expired") return { text: "Declined by the customer", tone: "red" };
  if (a.quotation_status === "sent" || a.quotation_status === "opened" || a.quotation_status === "urgent_requested") return { text: "Quoted, waiting for the customer", tone: "amber" };
  return { text: "Approved, being quoted", tone: "ink" };
}
import { type QcItem } from "./qc-items";

export { QC_KIND_LABELS, type QcItem } from "./qc-items";
export type QcCheckRow = { id: string; job_id: string; round: number; status: "open" | "passed" | "failed"; inspector_id: string | null; started_at: string; finished_at: string | null; mileage: number | null; mileage_unit: string | null; postscan_path: string | null; postscan_waived_reason: string | null; items: QcItem[]; notes: string | null; created_at: string };
export type WashRow = { id: string; job_id: string; done_by: string | null; done_at: string | null; photo_path: string | null; skipped: boolean; skip_reason: string | null; skipped_by: string | null; created_at: string };
export type JobFileRow = { id: string; job_id: string; kind: string; ref_id: string | null; storage_path: string; content_type: string | null; caption: string | null; taken_at: string; uploaded_by: string | null };
export type ShiftRow = { id: string; staff_id: string; shift_date: string; clock_in: string; clock_out: string | null; late_minutes: number };

export const WORK_LINE_SELECT = "id, job_id, quotation_line_id, source, position, title, details, hours_quoted, assigned_to, status, done_at, done_by, notes, created_at";
export const WORK_SESSION_SELECT = "id, job_id, technician_id, started_at, ended_at, end_reason, pause_reason, minutes";
export const ADDITIONAL_SELECT = "id, job_id, technician_id, work_line_id, remark, parts_needed, status, decided_by, decided_at, decision_note, quotation_id, created_at";
export const QC_SELECT = "id, job_id, round, status, inspector_id, started_at, finished_at, mileage, mileage_unit, postscan_path, postscan_waived_reason, items, notes, created_at";
export const WASH_SELECT = "id, job_id, done_by, done_at, photo_path, skipped, skip_reason, skipped_by, created_at";
export const JOB_FILE_SELECT = "id, job_id, kind, ref_id, storage_path, content_type, caption, taken_at, uploaded_by";
export const SHIFT_SELECT = "id, staff_id, shift_date, clock_in, clock_out, late_minutes";

export const PAUSE_REASONS = ["Waiting for parts", "Waiting for the manager", "Another job", "Break", "Tools or lift busy", "Other"] as const;

/** Minutes of a session, running or finished. */
export function sessionMinutes(s: Pick<WorkSessionRow, "started_at" | "ended_at" | "minutes">, now = Date.now()) {
  if (s.minutes !== null && s.minutes !== undefined && s.ended_at) return s.minutes;
  return Math.max(0, Math.round(((s.ended_at ? Date.parse(s.ended_at) : now) - Date.parse(s.started_at)) / 60000));
}

export type WorkBundle = {
  lines: WorkLineRow[];
  sessions: WorkSessionRow[];
  additional: AdditionalWorkRow[];
  files: JobFileRow[];
  fileUrls: Record<string, string>;
  names: Map<string, string>;
  minutesTotal: number;
  minutesByTechnician: Map<string, number>;
  hoursQuoted: number;
};

export async function loadWork(jobId: string): Promise<WorkBundle> {
  const admin = createAdminClient();
  const [{ data: lines }, { data: sessions }, { data: additional }, { data: files }] = await Promise.all([
    admin.from("work_lines").select(WORK_LINE_SELECT).eq("job_id", jobId).eq("is_active", true).order("position"),
    admin.from("work_sessions").select(WORK_SESSION_SELECT).eq("job_id", jobId).eq("is_active", true).order("started_at"),
    admin.from("additional_work").select(ADDITIONAL_SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("job_files").select(JOB_FILE_SELECT).eq("job_id", jobId).in("kind", ["work_photo", "additional_work"]).order("taken_at"),
  ]);
  const ls = ((lines ?? []) as Record<string, unknown>[]).map((l) => ({ ...(l as unknown as WorkLineRow), position: Number(l.position), hours_quoted: l.hours_quoted === null ? null : Number(l.hours_quoted) }));
  const ss = (sessions ?? []) as WorkSessionRow[];
  const ids = new Set<string>();
  for (const l of ls) for (const x of [l.assigned_to, l.done_by]) if (x) ids.add(x);
  for (const s of ss) ids.add(s.technician_id);
  for (const a of (additional ?? []) as AdditionalWorkRow[]) for (const x of [a.technician_id, a.decided_by]) if (x) ids.add(x);
  const adds = (additional ?? []) as AdditionalWorkRow[];
  const qids = adds.map((a) => a.quotation_id).filter((x): x is string => !!x);
  const [{ data: people }, { data: quotes }] = await Promise.all([
    ids.size ? admin.from("staff").select("id, display_name").in("id", Array.from(ids)) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    qids.length ? admin.from("quotations").select("id, status").in("id", qids) : Promise.resolve({ data: [] as { id: string; status: string }[] }),
  ]);
  const quoteStatus = new Map((quotes ?? []).map((q) => [q.id, q.status]));
  for (const a of adds) a.quotation_status = a.quotation_id ? (quoteStatus.get(a.quotation_id) ?? null) : null;
  const fileRows = (files ?? []) as JobFileRow[];
  const fileUrls = await signJobFiles(fileRows.map((f) => f.storage_path));
  const byTech = new Map<string, number>();
  for (const s of ss) byTech.set(s.technician_id, (byTech.get(s.technician_id) ?? 0) + sessionMinutes(s));
  return {
    lines: ls,
    sessions: ss,
    additional: adds,
    files: fileRows,
    fileUrls,
    names: new Map((people ?? []).map((p) => [p.id, p.display_name])),
    minutesTotal: Array.from(byTech.values()).reduce((a, b) => a + b, 0),
    minutesByTechnician: byTech,
    hoursQuoted: Math.round(ls.reduce((a, l) => a + (l.hours_quoted ?? 0), 0) * 10) / 10,
  };
}

export async function signJobFiles(paths: string[], seconds = 3600): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!paths.length) return out;
  const { data } = await createAdminClient().storage.from(JOB_FILES_BUCKET).createSignedUrls(paths, seconds);
  for (const s of data ?? []) if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
  return out;
}

/**
 * The work order: one line per approved quotation line that is work (labour, fixed-price services,
 * Other without a cost). Parts, fees and sublet lines are not work. Safe to call again.
 */
export async function ensureWorkLines(jobId: string, by: string | null): Promise<number> {
  const admin = createAdminClient();
  const { data: quotes } = await admin.from("quotations").select("id").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).eq("status", "approved");
  const qids = (quotes ?? []).map((q) => q.id);
  if (!qids.length) return 0;
  const [{ data: lines }, { data: existing }] = await Promise.all([
    admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", qids).eq("is_active", true).order("position"),
    admin.from("work_lines").select("id, quotation_line_id, position").eq("job_id", jobId),
  ]);
  const have = new Set((existing ?? []).map((e) => e.quotation_line_id).filter(Boolean));
  let position = (existing ?? []).reduce((m, e) => Math.max(m, Number(e.position) || 0), 0);
  const rows = ((lines ?? []) as Record<string, unknown>[])
    .map(toLine)
    .filter((l) => !isHidden(l) && (l.line_type === "labour" || l.line_type === "package" || (l.line_type === "other" && !hasCostFloor(l))) && !have.has(l.id))
    .map((l) => ({ job_id: jobId, quotation_line_id: l.id, source: "quotation", position: ++position, title: l.title, details: l.details, hours_quoted: l.line_type === "labour" ? l.hours : null, created_by: by, updated_by: by }));
  if (!rows.length) return 0;
  await admin.from("work_lines").insert(rows);
  // Two calls at the same moment could both insert: keep the first line per quotation line, retire the rest.
  const { data: after } = await admin.from("work_lines").select("id, quotation_line_id, created_at").eq("job_id", jobId).eq("is_active", true).not("quotation_line_id", "is", null).order("created_at");
  const seen = new Set<string>();
  const extras: string[] = [];
  for (const w of after ?? []) {
    if (seen.has(w.quotation_line_id)) extras.push(w.id);
    else seen.add(w.quotation_line_id);
  }
  if (extras.length) await admin.from("work_lines").update({ is_active: false, updated_by: by }).in("id", extras);
  return rows.length;
}

/** The QC checklist built from the job: complaints, work done, parts fitted, then the general checks from Settings. */
export async function buildQcItems(jobId: string, settings: Settings, previous: QcCheckRow | null): Promise<QcItem[]> {
  if (previous && previous.status === "failed") return previous.items.filter((i) => i.result === "fail").map((i) => ({ ...i, result: null, remark: null }));
  const admin = createAdminClient();
  const [{ data: requests }, { data: lines }, { data: parts }] = await Promise.all([
    admin.from("job_requests").select("id, text").eq("job_id", jobId).eq("is_active", true).order("position"),
    admin.from("work_lines").select("id, title").eq("job_id", jobId).eq("is_active", true).order("position"),
    admin.from("part_items").select("id, description, part_number, issue_status, return_status").eq("job_id", jobId).eq("is_active", true).neq("issue_status", "none").neq("return_status", "returned"),
  ]);
  const items: QcItem[] = [];
  for (const r of requests ?? []) items.push({ key: `complaint:${r.id}`, kind: "complaint", label: `${r.text}: resolved?`, result: null, remark: null });
  for (const l of lines ?? []) items.push({ key: `work:${l.id}`, kind: "work", label: l.title, result: null, remark: null });
  for (const p of parts ?? []) items.push({ key: `part:${p.id}`, kind: "part", label: `${p.description}${p.part_number ? ` (${p.part_number})` : ""}: fitted?`, result: null, remark: null });
  const general = Array.isArray(settings.qc_general_checks) ? (settings.qc_general_checks as string[]) : [];
  general.forEach((g, i) => items.push({ key: `general:${i}`, kind: "general", label: g, result: null, remark: null }));
  return items;
}


export async function latestQc(jobId: string): Promise<QcCheckRow | null> {
  const { data } = await createAdminClient().from("qc_checks").select(QC_SELECT).eq("job_id", jobId).eq("is_active", true).order("round", { ascending: false }).limit(1).maybeSingle();
  return (data as QcCheckRow | null) ?? null;
}

export async function loadWash(jobId: string): Promise<WashRow | null> {
  const { data } = await createAdminClient().from("washes").select(WASH_SELECT).eq("job_id", jobId).maybeSingle();
  return (data as WashRow | null) ?? null;
}
