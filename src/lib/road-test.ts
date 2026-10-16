/** The QC inspector's road test: five checks, each GOOD / AVERAGE / BAD with remarks. The workshop manager decides at assignment whether one is needed. */

import type { CheckStatus } from "./inspection";

/** Eight checks (the keys of the first five never change: saved road tests carry them). */
export const ROAD_TEST_ITEMS = [
  { key: "noises", label: "Noises" },
  { key: "vibration", label: "Vibration" },
  { key: "pulling", label: "Pulling to one side" },
  { key: "braking", label: "Brakes" },
  { key: "steering", label: "Steering" },
  { key: "gearbox", label: "Transmission" },
  { key: "engine", label: "Engine" },
  { key: "suspension", label: "Suspension" },
] as const;
export type RoadTestKey = (typeof ROAD_TEST_ITEMS)[number]["key"];

export type RoadTestItem = { status?: CheckStatus | null; remarks?: string | null };
export type RoadTestItems = Partial<Record<RoadTestKey, RoadTestItem>>;

/** What the workshop manager chose at assignment. Null on cars assigned before this choice existed. */
export type RoadTestDecision = "needed" | "not_needed" | "not_possible";

export const ROAD_TEST_DECISIONS: { value: RoadTestDecision; label: string }[] = [
  { value: "needed", label: "Road test needed" },
  { value: "not_needed", label: "No road test" },
  { value: "not_possible", label: "Road test not possible" },
];
export const ROAD_TEST_DECISION_LABELS: Record<RoadTestDecision, string> = { needed: "Road test needed", not_needed: "No road test", not_possible: "Road test not possible" };
/** The three choices as one-tap buttons, each with what it means underneath. Nothing is pre-chosen: the manager decides every time. */
export const ROAD_TEST_CHOICES: { value: RoadTestDecision; label: string; hint: string }[] = [
  { value: "needed", label: "Road test needed", hint: "QC inspector drives it first" },
  { value: "not_needed", label: "No road test", hint: "inspection starts now" },
  { value: "not_possible", label: "Not possible", hint: "write why below" },
];

export type RoadTestRow = {
  id: string;
  job_id: string;
  inspector_id: string | null;
  status: "not_started" | "done" | "not_possible";
  items: RoadTestItems;
  not_possible_reason: string | null;
  started_at: string | null;
  done_at: string | null;
  decision: RoadTestDecision | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export const ROAD_TEST_SELECT = "id, job_id, inspector_id, status, items, not_possible_reason, started_at, done_at, decision, decision_note, decided_by, decided_at, created_at, updated_at";

export const ROAD_TEST_STATUS_LABELS: Record<RoadTestRow["status"], string> = {
  not_started: "Road test not done yet",
  done: "Road test done",
  not_possible: "Road test not possible",
};

/** The technician's inspection waits while a needed road test has not been submitted. */
export function roadTestWaiting(rt: Pick<RoadTestRow, "status" | "decision"> | null | undefined) {
  return !!rt && rt.decision === "needed" && rt.status === "not_started";
}

/** One short line for cards and lists. */
export function roadTestLine(rt: Pick<RoadTestRow, "status" | "decision" | "decision_note" | "not_possible_reason"> | null | undefined) {
  if (!rt) return "";
  if (rt.status === "done") return "Road test done";
  if (rt.status === "not_possible") return `Road test not possible${rt.not_possible_reason ? `: ${rt.not_possible_reason}` : ""}`;
  if (rt.decision === "not_needed") return `No road test${rt.decision_note ? `: ${rt.decision_note}` : ""}`;
  if (rt.decision === "needed") return "Waiting for road test";
  return "Road test not done yet";
}

/** One flagged road test item (Bad or Average) as the report, the quotation strip, the PDF and the customer's link show it. */
export type RoadTestFlag = { key: RoadTestKey; label: string; status: "bad" | "average"; statusLabel: string; remarks: string | null };
export type RoadTestSummary = {
  state: "done" | "not_possible" | "not_needed" | "waiting" | "none";
  line: string;
  /** Bad first, then Average. */
  flagged: RoadTestFlag[];
  /** The labels of the items found good, for one line. */
  good: string[];
};

/** The road test folded for display: the flagged items first (Bad before Average), the good ones as one line. */
export function roadTestSummary(rt: Pick<RoadTestRow, "status" | "decision" | "decision_note" | "not_possible_reason" | "items"> | null | undefined): RoadTestSummary {
  if (!rt) return { state: "none", line: "", flagged: [], good: [] };
  const state: RoadTestSummary["state"] = rt.status === "done" ? "done" : rt.status === "not_possible" ? "not_possible" : rt.decision === "not_needed" ? "not_needed" : rt.decision === "needed" ? "waiting" : "none";
  const flagged: RoadTestFlag[] = [];
  const good: string[] = [];
  if (rt.status === "done") {
    for (const it of ROAD_TEST_ITEMS) {
      const v = (rt.items ?? {})[it.key];
      if (!v?.status) continue;
      if (v.status === "good") good.push(it.label);
      else flagged.push({ key: it.key, label: it.label, status: v.status === "bad" ? "bad" : "average", statusLabel: v.status === "bad" ? "Bad" : "Average", remarks: v.remarks?.trim() || null });
    }
    flagged.sort((a, b) => (a.status === "bad" ? 0 : 1) - (b.status === "bad" ? 0 : 1));
  }
  return { state, line: roadTestLine(rt), flagged, good };
}

/** Problems that stop the road test from being saved as done. */
export function roadTestProblems(items: RoadTestItems): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const it of ROAD_TEST_ITEMS) {
    const v = items[it.key];
    if (!v?.status) out.push({ key: it.key, label: `${it.label}: not marked` });
    else if ((v.status === "average" || v.status === "bad") && !(v.remarks ?? "").trim()) out.push({ key: it.key, label: `${it.label}: remark needed` });
  }
  return out;
}
