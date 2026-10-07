/** Shared vocabulary for job cards: the nine-step track, statuses in plain words, timing colours. */

export const STAGES = ["gate_in", "inspection", "quote", "approval", "parts", "work", "qc", "wash", "ready"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  gate_in: "Gate-in",
  inspection: "Inspection",
  quote: "Quote",
  approval: "Approval",
  parts: "Parts",
  work: "Work",
  qc: "QC",
  wash: "Wash",
  ready: "Ready",
};

export const STATUSES = [
  "gate_in_pending",
  "pending_approval",
  "pending_inspection",
  "in_inspection",
  "pending_quote",
  "pending_customer_approval",
  "approved",
  "waiting_parts",
  "in_work",
  "pending_qc",
  "pending_wash",
  "ready",
  "pending_payment",
  "closed",
] as const;
export type JobStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<JobStatus, string> = {
  gate_in_pending: "Gate-in incomplete, video pending",
  pending_approval: "Waiting for customer to approve the job card",
  pending_inspection: "Pending inspection",
  in_inspection: "In inspection",
  pending_quote: "Pending quote",
  pending_customer_approval: "Waiting for customer approval",
  approved: "Approved, waiting to start",
  waiting_parts: "Waiting for parts",
  in_work: "In work",
  pending_qc: "Pending QC",
  pending_wash: "Pending car wash",
  ready: "Job done, ready to collect",
  pending_payment: "Job done, pending payment",
  closed: "Gated out",
};

/** Which step of the track each status sits on. */
export const STATUS_STAGE: Record<JobStatus, Stage> = {
  gate_in_pending: "gate_in",
  pending_approval: "gate_in",
  pending_inspection: "inspection",
  in_inspection: "inspection",
  pending_quote: "quote",
  pending_customer_approval: "approval",
  approved: "parts",
  waiting_parts: "parts",
  in_work: "work",
  pending_qc: "qc",
  pending_wash: "wash",
  ready: "ready",
  pending_payment: "ready",
  closed: "ready",
};

/** The Pending row on the dashboard: which statuses count under each heading. */
export const PENDING_GROUPS: { key: string; label: string; statuses: JobStatus[] }[] = [
  { key: "video", label: "Video pending", statuses: ["gate_in_pending"] },
  { key: "inspection", label: "Inspection", statuses: ["pending_inspection", "in_inspection"] },
  { key: "quote", label: "Quote", statuses: ["pending_quote"] },
  { key: "approval", label: "Customer approval", statuses: ["pending_approval", "pending_customer_approval"] },
  { key: "parts", label: "Parts", statuses: ["approved", "waiting_parts"] },
  { key: "qc", label: "QC", statuses: ["pending_qc"] },
  { key: "wash", label: "Car wash", statuses: ["pending_wash"] },
  { key: "payment", label: "Payment", statuses: ["pending_payment"] },
];

/** Manual moves the workshop manager can make until later phases automate them. */
export const MANUAL_STATUS_OPTIONS: JobStatus[] = [
  "pending_inspection",
  "in_inspection",
  "pending_quote",
  "pending_customer_approval",
  "approved",
  "waiting_parts",
  "in_work",
  "pending_qc",
  "pending_wash",
  "ready",
  "pending_payment",
];

export const PRIORITY_LABELS = { high: "High priority", normal: "Normal", low: "Low priority" } as const;
export type Priority = keyof typeof PRIORITY_LABELS;

export const ARRIVED_BY = [
  { value: "our_recovery", label: "Collected by our recovery" },
  { value: "customer_drove", label: "Customer drove it in" },
  { value: "customer_driver", label: "Delivered by customer's driver" },
  { value: "outside_recovery", label: "Delivered by outside recovery" },
] as const;

export const CONDITIONS = [
  { value: "runs_drives", label: "Runs and drives" },
  { value: "needs_assistance", label: "Needs assistance to run and drive" },
  { value: "does_not_run", label: "Does not run, does not drive" },
] as const;

export const FUEL_LEVELS = [
  { value: "empty", label: "Empty" },
  { value: "quarter", label: "¼" },
  { value: "half", label: "½" },
  { value: "three_quarters", label: "¾" },
  { value: "full", label: "Full" },
] as const;

export const CLEANLINESS = [
  { value: "clean", label: "Clean" },
  { value: "average", label: "Average" },
  { value: "dirty", label: "Dirty" },
  { value: "very_dirty", label: "Very dirty or muddy" },
] as const;

export function labelOf(list: readonly { value: string; label: string }[], value: string | null | undefined) {
  return list.find((o) => o.value === value)?.label ?? "";
}

export type Timing = { tone: "green" | "amber" | "red" | "neutral"; label: string; daysOver: number };

/** Green on time, amber due today, red overdue; based on the promised date in Dubai time. */
export function jobTiming(promisedAt: string | null, isOpen: boolean, now = new Date()): Timing {
  if (!isOpen) return { tone: "neutral", label: "Closed", daysOver: 0 };
  if (!promisedAt) return { tone: "neutral", label: "No promised date", daysOver: 0 };
  const today = dubaiDate(now);
  const promised = promisedAt.slice(0, 10);
  if (promised < today) {
    const days = Math.round((Date.parse(today) - Date.parse(promised)) / 86400000);
    return { tone: "red", label: `Overdue ${days} day${days === 1 ? "" : "s"}`, daysOver: days };
  }
  if (promised === today) return { tone: "amber", label: "Due today", daysOver: 0 };
  return { tone: "green", label: "On time", daysOver: 0 };
}

/** Today's date (YYYY-MM-DD) in Dubai. */
export function dubaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
}

export function formatPromised(promisedAt: string | null) {
  if (!promisedAt) return "";
  const today = dubaiDate();
  if (promisedAt === today) return "Today";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Dubai" }).format(
    new Date(promisedAt + "T12:00:00+04:00"),
  );
}

/** Sort key: overdue first, then due today, then by priority, then by promised date. */
export function urgencyRank(job: { promised_at: string | null; priority: Priority; is_open: boolean }) {
  const t = jobTiming(job.promised_at, job.is_open);
  const toneRank = { red: 0, amber: 1, green: 2, neutral: 3 }[t.tone];
  const prioRank = { high: 0, normal: 1, low: 2 }[job.priority];
  return [toneRank, prioRank, -t.daysOver, job.promised_at ?? "9999"] as const;
}
