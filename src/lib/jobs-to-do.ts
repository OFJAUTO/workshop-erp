/**
 * JOBS TO DO (11 November 2026, Section 9). Pure. One list for the workshop tablet, the bodyshop page and the printed
 * job card: the approved quotation's jobs, numbered, in capitals, each job's parts under it (Here / Arriving / Not
 * ordered), the viewer's department first and the other folded, NEW on jobs a revision added, the customer's "no" in
 * its own folded list. No prices, costs or customer details ever.
 */
import { lineTeamDef, teamOfLine, type TeamLine, type TeamService } from "@/lib/line-teams";

export type Side = "workshop" | "bodyshop";
export const SIDE_WORDS: Record<Side, string> = { workshop: "Workshop", bodyshop: "Bodyshop" };

export type TodoLine = TeamLine & { id: string; title: string; position: number; positions?: string[] | null; parent_line_id?: string | null; team?: string | null; customer_approved?: boolean | null; isNew?: boolean };
export type TodoPart = { id: string; name: string; lineId: string | null; positions?: string[] | null; state: "here" | "arriving" | "not_ordered"; when?: string | null };
export type TodoJob = { lineId: string; n: number; title: string; positions: string[] | null; side: Side; guessed: boolean; done: boolean; isNew: boolean; parts: TodoPart[]; /** 13 November 2026: the manager allowed dismantling and preparation before the parts are here. */ startAnyway?: { by: string; at: string } | null };

/**
 * READY TO START or WAITING FOR PART (13 November 2026, Section 1): parts and work run side by side, so each job line
 * says whether it can start now. A line with no parts, or with every part here, is ready; otherwise the first missing
 * part and its expected day. "Start anyway" (the manager) lets dismantling and preparation begin.
 */
export function readinessOf(j: Pick<TodoJob, "parts" | "startAnyway" | "done">): { kind: "ready" | "waiting" | "anyway" | "done"; words: string } {
  if (j.done) return { kind: "done", words: "DONE" };
  const missing = j.parts.filter((p) => p.state !== "here");
  if (!missing.length) return { kind: "ready", words: "READY TO START" };
  const first = missing[0];
  const more = missing.length > 1 ? ` (+${missing.length - 1} more)` : "";
  const waiting = `WAITING FOR PART: ${first.name.toUpperCase()}${first.when ? `, ${first.when}` : first.state === "not_ordered" ? ", not ordered yet" : ""}${more}`;
  if (j.startAnyway) return { kind: "anyway", words: `START ANYWAY (dismantle and prepare) · ${waiting}` };
  return { kind: "waiting", words: waiting };
}
export type JobsToDo = {
  mine: TodoJob[];
  others: TodoJob[];
  otherParts: TodoPart[];
  declined: string[];
  progress: Record<Side, { done: number; total: number }>;
  viewerSide: Side;
  /** "Bodyshop 3/3 done · Workshop 0/4" (only the sides with jobs). */
  words: string;
};

/** The work lines of a quotation (the jobs): labour, services, packages, outside work - never parts, fees, recovery. */
export const isJobLine = (l: { line_type: string }) => ["labour", "service", "package", "outside"].includes(l.line_type);

/** THE department of a job line: its team's side (chosen, else guessed from the work type); never empty. */
export function sideOfLine(l: TodoLine, svc: TeamService, department: string | null): { side: Side; guessed: boolean } {
  const team = teamOfLine(l, svc, department);
  const def = lineTeamDef(team);
  const side: Side = def?.side === "bodyshop" ? "bodyshop" : def?.side === "mechanical" ? "workshop" : department === "bodyshop" ? "bodyshop" : "workshop";
  return { side, guessed: !l.team };
}

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["and", "the", "for", "with", "replace", "front", "rear", "left", "right"].includes(w)));

/** "For job: …" guessed for a part: the job sharing the most words with its name, else the first job. */
export function guessJobForPart(partName: string, jobs: { id: string; title: string }[]): string | null {
  if (!jobs.length) return null;
  const pw = words(partName);
  let best: { id: string; score: number } | null = null;
  for (const j of jobs) {
    let score = 0;
    for (const w of words(j.title)) if (pw.has(w)) score++;
    if (!best || score > best.score) best = { id: j.id, score };
  }
  return best && best.score > 0 ? best.id : null;
}

/** Build the list. `viewerSide` = the technician's own department (the owner and managers see Workshop first). */
export function buildJobsToDo(input: {
  lines: TodoLine[];
  parts: TodoPart[];
  ticks: Set<string>;
  declined: string[];
  svcOf: (l: TodoLine) => TeamService;
  department: string | null;
  viewerSide: Side;
}): JobsToDo {
  const jobLines = input.lines.filter((l) => isJobLine(l) && l.customer_approved !== false).sort((a, b) => a.position - b.position);
  const jobs: TodoJob[] = jobLines.map((l, i) => {
    const s = sideOfLine(l, input.svcOf(l), input.department);
    return { lineId: l.id, n: i + 1, title: l.title.toUpperCase(), positions: l.positions ?? null, side: s.side, guessed: s.guessed, done: input.ticks.has(l.id), isNew: !!l.isNew, parts: [] };
  });
  const byId = new Map(jobs.map((j) => [j.lineId, j]));
  const otherParts: TodoPart[] = [];
  for (const p of input.parts) {
    const home = p.lineId ? byId.get(p.lineId) : null;
    if (home) home.parts.push(p);
    else otherParts.push(p);
  }
  const progress: Record<Side, { done: number; total: number }> = { workshop: { done: 0, total: 0 }, bodyshop: { done: 0, total: 0 } };
  for (const j of jobs) {
    progress[j.side].total++;
    if (j.done) progress[j.side].done++;
  }
  const declined = Array.from(new Set([...input.declined, ...input.lines.filter((l) => isJobLine(l) && l.customer_approved === false).map((l) => l.title)])).map((t) => t.toUpperCase());
  return {
    mine: jobs.filter((j) => j.side === input.viewerSide),
    others: jobs.filter((j) => j.side !== input.viewerSide),
    otherParts,
    declined,
    progress,
    viewerSide: input.viewerSide,
    words: progressWords(progress, input.viewerSide === "bodyshop" ? ["bodyshop", "workshop"] : ["bodyshop", "workshop"]),
  };
}

/** "Bodyshop 3/3 done · Workshop 0/4" - the sides that have jobs. */
export function progressWords(p: Record<Side, { done: number; total: number }>, order: Side[] = ["bodyshop", "workshop"]): string {
  return order.filter((s) => p[s].total > 0).map((s) => `${SIDE_WORDS[s]} ${p[s].done}/${p[s].total}${p[s].done === p[s].total ? " done" : ""}`).join(" · ");
}

/** A side handing the car over: what is still open on the other side ("2 jobs still open in the Bodyshop: …"). */
export function handoverWords(t: JobsToDo): string | null {
  const mineOpen = t.mine.filter((j) => !j.done).length;
  const otherOpen = t.others.filter((j) => !j.done);
  if (mineOpen || !otherOpen.length || !t.mine.length) return null;
  const other: Side = t.viewerSide === "workshop" ? "bodyshop" : "workshop";
  return `${otherOpen.length} job${otherOpen.length === 1 ? "" : "s"} still open in the ${SIDE_WORDS[other]}: ${otherOpen.map((j) => j.title).join(", ")}`;
}
