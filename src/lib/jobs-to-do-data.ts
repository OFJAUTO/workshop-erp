import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { approvedQuotationsMany } from "@/lib/quote-data";
import { attachTeams, servicesFor } from "@/lib/line-teams-data";
import { schemaReady } from "@/lib/schema-ready";
import { buildJobsToDo, guessJobForPart, isJobLine, progressWords, sideOfLine, type JobsToDo, type Side, type TodoLine, type TodoPart } from "@/lib/jobs-to-do";

/**
 * The server half of JOBS TO DO (11 November 2026, Section 9): the approved quotations' lines of one job (newest
 * version of each number), each part placed under its job ("For job" on the quotation, else guessed by its name), the
 * ticks, the customer's "no". Never a price, a cost or a customer detail.
 */
export const ticksReady = () => schemaReady("job_line_ticks", "quotation_line_id");

type LineRow = { id: string; quotation_id: string; title: string; position: number; line_type: string; positions: string[] | null; parent_line_id: string | null; customer_approved: boolean | null; service_id: string | null; part_item_id: string | null; revised_from_line_id: string | null; outside_work?: boolean | null; film_colour?: string | null; film_code?: string | null; tint_percent?: number | null; package_key?: string | null; is_active: boolean; left_off?: boolean | null };

async function linesOf(jobIds: string[]): Promise<Map<string, { lines: (LineRow & { team: string | null; isNew: boolean })[]; versions: Map<string, number> }>> {
  const admin = createAdminClient();
  const approved = await approvedQuotationsMany(jobIds);
  const qIds = Array.from(approved.values()).flat().map((q) => q.id);
  const versionOf = new Map(Array.from(approved.values()).flat().map((q) => [q.id, q.version]));
  const { data } = qIds.length ? await admin.from("quotation_lines").select("id, quotation_id, title, position, line_type, positions, parent_line_id, customer_approved, service_id, part_item_id, revised_from_line_id, outside_work, film_colour, film_code, tint_percent, package_key, is_active, left_off").in("quotation_id", qIds).eq("is_active", true) : { data: [] };
  const rows = await attachTeams(((data ?? []) as unknown as LineRow[]).filter((l) => !l.left_off));
  const jobOfQ = new Map<string, string>();
  for (const [jobId, qs] of approved) for (const q of qs) jobOfQ.set(q.id, jobId);
  const out = new Map<string, { lines: (LineRow & { team: string | null; isNew: boolean })[]; versions: Map<string, number> }>();
  for (const id of jobIds) out.set(id, { lines: [], versions: new Map() });
  for (const r of rows) {
    const jobId = jobOfQ.get(r.quotation_id);
    if (!jobId) continue;
    // A job a revision added: on version 2+ with no line it came from.
    out.get(jobId)!.lines.push({ ...r, isNew: (versionOf.get(r.quotation_id) ?? 1) > 1 && !r.revised_from_line_id && isJobLine(r) });
  }
  return out;
}

export async function loadJobsToDo(jobId: string, viewerSide: Side): Promise<(JobsToDo & { requests: string[]; managerNote: string | null; ready: boolean }) | null> {
  const admin = createAdminClient();
  const [{ data: job }, linesMap, ready] = await Promise.all([
    admin.from("jobs").select("id, department, assignment_note, plan_release_note").eq("id", jobId).maybeSingle(),
    linesOf([jobId]),
    ticksReady(),
  ]);
  if (!job) return null;
  const lines = linesMap.get(jobId)?.lines ?? [];
  const svc = await servicesFor(lines.map((l) => l.service_id ?? "").filter(Boolean));
  const jobLines = lines.filter(isJobLine);
  const partLineOf = new Map(lines.filter((l) => l.part_item_id).map((l) => [l.part_item_id as string, l]));
  const [{ data: parts }, { data: wl }, { data: ticks }, { data: declined }, { data: reqs }] = await Promise.all([
    admin.from("part_items").select("id, description, positions, order_status, received_qty, issue_status, delivery_date, is_active, removed_at").eq("job_id", jobId).eq("is_active", true),
    admin.from("work_lines").select("quotation_line_id, status").eq("job_id", jobId).eq("is_active", true),
    ready ? admin.from("job_line_ticks").select("quotation_line_id, done_at").eq("job_id", jobId).eq("is_active", true) : Promise.resolve({ data: [] }),
    admin.from("declined_work").select("title").eq("job_id", jobId).eq("is_active", true),
    admin.from("job_requests").select("text").eq("job_id", jobId).eq("is_active", true).order("position"),
  ]);
  const doneLines = new Set<string>([
    ...((wl ?? []) as { quotation_line_id: string | null; status: string }[]).filter((w) => w.status === "done" && w.quotation_line_id).map((w) => w.quotation_line_id as string),
    ...((ticks ?? []) as { quotation_line_id: string; done_at: string | null }[]).filter((t) => t.done_at).map((t) => t.quotation_line_id),
  ]);
  const todoParts: TodoPart[] = ((parts ?? []) as { id: string; description: string; positions: string[] | null; order_status: string | null; received_qty: number | null; issue_status: string | null; delivery_date: string | null }[]).map((p) => {
    const ql = partLineOf.get(p.id);
    const home = ql?.parent_line_id ?? guessJobForPart(p.description, jobLines.map((j) => ({ id: j.id, title: j.title })));
    const here = Number(p.received_qty) > 0 || p.order_status === "received" || p.issue_status === "confirmed";
    const state: TodoPart["state"] = here ? "here" : p.order_status && p.order_status !== "none" ? "arriving" : "not_ordered";
    return { id: p.id, name: p.description, lineId: home ?? null, positions: p.positions, state, when: state === "arriving" ? p.delivery_date : null };
  });
  const built = buildJobsToDo({
    lines: lines as unknown as TodoLine[],
    parts: todoParts,
    ticks: doneLines,
    declined: ((declined ?? []) as { title: string }[]).map((d) => d.title),
    svcOf: (l) => ((l as unknown as LineRow).service_id ? svc.get((l as unknown as LineRow).service_id!) : undefined),
    department: (job.department as string | null) ?? null,
    viewerSide,
  });
  return { ...built, requests: ((reqs ?? []) as { text: string }[]).map((r) => r.text), managerNote: [job.assignment_note, job.plan_release_note].filter(Boolean).join(" · ") || null, ready };
}

/** "Bodyshop 3/3 done · Workshop 0/4" for many cars at once (the car cards). */
export async function loadSideProgress(jobIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const [linesMap, ready, { data: jobs }] = await Promise.all([linesOf(jobIds), ticksReady(), admin.from("jobs").select("id, department").in("id", jobIds)]);
  const all = Array.from(linesMap.values()).flatMap((v) => v.lines);
  const svc = await servicesFor(all.map((l) => l.service_id ?? "").filter(Boolean));
  const [{ data: wl }, { data: ticks }] = await Promise.all([
    admin.from("work_lines").select("quotation_line_id, status").in("job_id", jobIds).eq("is_active", true).eq("status", "done"),
    ready ? admin.from("job_line_ticks").select("quotation_line_id").in("job_id", jobIds).eq("is_active", true).not("done_at", "is", null) : Promise.resolve({ data: [] }),
  ]);
  const done = new Set<string>([...((wl ?? []) as { quotation_line_id: string | null }[]).map((w) => w.quotation_line_id ?? ""), ...((ticks ?? []) as { quotation_line_id: string }[]).map((t) => t.quotation_line_id)]);
  const deptOf = new Map(((jobs ?? []) as { id: string; department: string | null }[]).map((j) => [j.id, j.department]));
  for (const [jobId, v] of linesMap) {
    const p: Record<Side, { done: number; total: number }> = { workshop: { done: 0, total: 0 }, bodyshop: { done: 0, total: 0 } };
    for (const l of v.lines.filter((x) => isJobLine(x) && x.customer_approved !== false)) {
      const s = sideOfLine(l as unknown as TodoLine, l.service_id ? svc.get(l.service_id) : undefined, deptOf.get(jobId) ?? null).side;
      p[s].total++;
      if (done.has(l.id)) p[s].done++;
    }
    // Only a car with both sides says it on the card (one side is the stage bar's job).
    if (p.workshop.total && p.bodyshop.total) out.set(jobId, progressWords(p));
  }
  return out;
}

/** The viewer's side: a bodyshop person (bodyshop, paint, PPF and tint, detailing) sees the Bodyshop first. */
export function viewerSideOf(departmentId: string | null | undefined, role: string): Side {
  if (["bodyshop", "paint", "ppf_tint", "detailing"].includes(departmentId ?? "")) return "bodyshop";
  if (role === "team_leader") return "bodyshop";
  return "workshop";
}
