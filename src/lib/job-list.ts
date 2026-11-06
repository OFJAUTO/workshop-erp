/**
 * THE jobs list (6 November 2026, Section 6). Pure: the sorts, the filters, the search and the "12 of 37" words.
 * Newest opened first by default (the gate-in time, else the job's creation). Each person's choice is remembered
 * (`jobListCookie`), and every filter lives in the address so a link or a refresh keeps it.
 */

export const JOB_SORTS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "urgent", label: "Most urgent" },
  { key: "stage", label: "Stage" },
  { key: "promised", label: "Promised date" },
] as const;
export type JobSort = (typeof JOB_SORTS)[number]["key"];

export const JOB_WHEN = [
  { key: "any", label: "Any time" },
  { key: "today", label: "Opened today" },
  { key: "7d", label: "Last 7 days" },
] as const;
export type JobWhen = (typeof JOB_WHEN)[number]["key"];

export const JOB_DEPARTMENTS = [
  { key: "mechanical", label: "Mechanical" },
  { key: "bodyshop", label: "Bodyshop" },
  { key: "both", label: "Both" },
] as const;

export type JobFilters = {
  sort: JobSort;
  when: JobWhen;
  stage: string | null;
  dept: string | null;
  advisor: string | null;
  tech: string | null;
  high: boolean;
  overdue: boolean;
  ready: boolean;
  q: string;
};

export const DEFAULT_JOB_FILTERS: JobFilters = { sort: "newest", when: "any", stage: null, dept: null, advisor: null, tech: null, high: false, overdue: false, ready: false, q: "" };

/** The keys a jobs-list address may carry (anything else, like `show`, is the page's own). */
export const JOB_LIST_KEYS = ["sort", "when", "stage", "dept", "advisor", "tech", "high", "overdue", "ready", "q"] as const;

const UUID = /^[0-9a-f-]{36}$/i;

/** The filters from an address (unknown or broken values fall back to the defaults). */
export function readJobFilters(p: Record<string, string | string[] | undefined>): JobFilters {
  const one = (k: string) => {
    const v = p[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const sort = JOB_SORTS.some((s) => s.key === one("sort")) ? (one("sort") as JobSort) : "newest";
  const when = JOB_WHEN.some((w) => w.key === one("when")) ? (one("when") as JobWhen) : "any";
  const stage = /^[a-z_]{2,30}$/.test(one("stage")) ? one("stage") : null;
  const dept = JOB_DEPARTMENTS.some((d) => d.key === one("dept")) ? one("dept") : null;
  return {
    sort,
    when,
    stage,
    dept,
    advisor: UUID.test(one("advisor")) ? one("advisor") : null,
    tech: UUID.test(one("tech")) ? one("tech") : null,
    high: one("high") === "1",
    overdue: one("overdue") === "1",
    ready: one("ready") === "1",
    q: one("q").trim().slice(0, 60),
  };
}

/** True when the address carries any list choice at all (else the person's remembered choice applies). */
export function hasListParams(p: Record<string, string | string[] | undefined>): boolean {
  return JOB_LIST_KEYS.some((k) => p[k] !== undefined && p[k] !== "");
}

/** The address part for these filters: only what differs from the defaults. */
export function jobFilterQuery(f: JobFilters): string {
  const out = new URLSearchParams();
  if (f.sort !== "newest") out.set("sort", f.sort);
  if (f.when !== "any") out.set("when", f.when);
  if (f.stage) out.set("stage", f.stage);
  if (f.dept) out.set("dept", f.dept);
  if (f.advisor) out.set("advisor", f.advisor);
  if (f.tech) out.set("tech", f.tech);
  if (f.high) out.set("high", "1");
  if (f.overdue) out.set("overdue", "1");
  if (f.ready) out.set("ready", "1");
  if (f.q) out.set("q", f.q);
  return out.toString();
}

/** Any filter narrowing the list (the sort alone does not). */
export function filtersNarrow(f: JobFilters): boolean {
  return f.when !== "any" || !!f.stage || !!f.dept || !!f.advisor || !!f.tech || f.high || f.overdue || f.ready || !!f.q;
}

/** The cookie that remembers one person's choice (per person, so a shared tablet keeps each person's own). */
export function jobListCookie(staffId: string): string {
  return `erp_jobs_${staffId.replace(/[^0-9a-f]/gi, "").slice(0, 12)}`;
}

export type JobListItem = {
  id: string;
  /** The gate-in time, else the job's creation. */
  openedAt: string;
  promisedAt: string | null;
  stage: string;
  status: string;
  priority: string;
  department: string | null;
  advisorId: string | null;
  techIds: string[];
  /** Red on the timing badge: past the promised time, or twice the stage target. */
  overdue: boolean;
  hoursInStage: number;
  /** Job number, plate (as printed and without spaces), VIN, make and model. */
  search: string;
};

export const READY_STATUSES = ["ready", "pending_payment"];

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The search: plate, VIN, job number, make and model, with or without spaces and dashes ("dd23864" finds "DD 23864"). */
export function jobSearchHit(item: Pick<JobListItem, "search">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const words = needle.split(/\s+/).filter(Boolean);
  const hay = item.search.toLowerCase();
  const hayCompact = compact(item.search);
  // Every word must be there (so "audi a8" finds an Audi A8), or the whole search squeezed (a plate typed as one word).
  return words.every((w) => hay.includes(w) || hayCompact.includes(compact(w))) || (compact(needle).length >= 3 && hayCompact.includes(compact(needle)));
}

/** The Dubai calendar day of a moment (yyyy-mm-dd). */
export function dubaiDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(iso));
}

/** The list after the filters and the sort. `stageOrder` is the stage keys in workshop order. */
export function applyJobList(items: JobListItem[], f: JobFilters, now: Date, stageOrder: readonly string[]): JobListItem[] {
  const today = dubaiDayOf(now.toISOString());
  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  const kept = items.filter((j) => {
    if (f.when === "today" && dubaiDayOf(j.openedAt) !== today) return false;
    if (f.when === "7d" && Date.parse(j.openedAt) < weekAgo) return false;
    if (f.stage && j.stage !== f.stage) return false;
    if (f.dept && (j.department ?? "mechanical") !== f.dept) return false;
    if (f.advisor && j.advisorId !== f.advisor) return false;
    if (f.tech && !j.techIds.includes(f.tech)) return false;
    if (f.high && j.priority !== "high") return false;
    if (f.overdue && !j.overdue) return false;
    if (f.ready && !READY_STATUSES.includes(j.status)) return false;
    return jobSearchHit(j, f.q);
  });
  const opened = (j: JobListItem) => Date.parse(j.openedAt) || 0;
  const rank = (s: string) => {
    const i = stageOrder.indexOf(s);
    return i < 0 ? 99 : i;
  };
  const by: Record<JobSort, (a: JobListItem, b: JobListItem) => number> = {
    newest: (a, b) => opened(b) - opened(a),
    oldest: (a, b) => opened(a) - opened(b),
    // Overdue first, then the longest in its current stage.
    urgent: (a, b) => Number(b.overdue) - Number(a.overdue) || b.hoursInStage - a.hoursInStage || opened(a) - opened(b),
    stage: (a, b) => rank(a.stage) - rank(b.stage) || opened(b) - opened(a),
    // The nearest promise first; no promise at the end.
    promised: (a, b) => (a.promisedAt ? Date.parse(a.promisedAt) : Infinity) - (b.promisedAt ? Date.parse(b.promisedAt) : Infinity) || opened(b) - opened(a),
  };
  return [...kept].sort(by[f.sort]);
}

/** "12 of 37" while a filter narrows the list, else "37 jobs". */
export function shownWords(shown: number, total: number, narrowed: boolean): string {
  if (narrowed) return `${shown} of ${total}`;
  return `${total} job${total === 1 ? "" : "s"}`;
}

/** The recently viewed jobs one person keeps on this device (newest first, five at most). */
export type RecentJob = { id: string; n: string; p: string; t: string };
export const RECENT_JOBS_MAX = 5;
export function recentJobsKey(staffId: string): string {
  return `erp-recent-jobs:${staffId}`;
}
export function addRecentJob(list: RecentJob[], job: RecentJob): RecentJob[] {
  return [job, ...list.filter((j) => j.id !== job.id)].slice(0, RECENT_JOBS_MAX);
}
export function readRecentJobs(raw: string | null): RecentJob[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((j) => j && typeof j.id === "string" && typeof j.n === "string").slice(0, RECENT_JOBS_MAX) : [];
  } catch {
    return [];
  }
}
