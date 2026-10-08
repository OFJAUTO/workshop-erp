/** The QC inspector's road test: five checks, each GOOD / AVERAGE / BAD with remarks. */

export const ROAD_TEST_ITEMS = [
  { key: "noises", label: "Noises" },
  { key: "vibration", label: "Vibration" },
  { key: "pulling", label: "Pulling to one side" },
  { key: "gearbox", label: "Gearbox behaviour" },
  { key: "braking", label: "Braking" },
] as const;
export type RoadTestKey = (typeof ROAD_TEST_ITEMS)[number]["key"];

export type RoadTestItem = { status?: "good" | "average" | "bad" | null; remarks?: string | null };
export type RoadTestItems = Partial<Record<RoadTestKey, RoadTestItem>>;

export type RoadTestRow = {
  id: string;
  job_id: string;
  inspector_id: string | null;
  status: "not_started" | "done" | "not_possible";
  items: RoadTestItems;
  not_possible_reason: string | null;
  started_at: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
};

export const ROAD_TEST_STATUS_LABELS: Record<RoadTestRow["status"], string> = {
  not_started: "Road test not done yet",
  done: "Road test done",
  not_possible: "Road test not possible",
};

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
