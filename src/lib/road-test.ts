/** The QC inspector's road test: five checks, each GOOD / AVERAGE / BAD with remarks. The workshop manager decides at assignment whether one is needed. */

import type { CheckStatus } from "./inspection";

export const ROAD_TEST_ITEMS = [
  { key: "noises", label: "Noises" },
  { key: "vibration", label: "Vibration" },
  { key: "pulling", label: "Pulling to one side" },
  { key: "gearbox", label: "Gearbox behaviour" },
  { key: "braking", label: "Braking" },
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
