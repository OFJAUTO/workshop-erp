/**
 * BOOKED CARS AND LOOSE-ITEMS JOBS (20 November 2026, Section 2; J-01034, a BMW X6 2012 with no plate: an approved
 * parts-only estimate held as a booked job, shown on the bodyshop booking page with a PPF pre-work panel, "Quotation not
 * started", and no way to open the job card). Pure: the words and the rules the screens and the hourly job share.
 */

export const LOOSE_TAG = "LOOSE ITEMS – NO CAR";

/** The short flow of a job with no car: what the job card shows instead of the car stages. */
export const LOOSE_STEPS = [
  { key: "received", label: "Items received" },
  { key: "work", label: "Parts and work" },
  { key: "money", label: "Invoice and payment" },
  { key: "out", label: "Handed over" },
] as const;
export type LooseStepKey = (typeof LOOSE_STEPS)[number]["key"];
export type LooseStepState = "done" | "current" | "later";

const BEFORE_MONEY = ["gate_in_pending", "pending_approval", "approved", "pending_quote", "quote_sent", "waiting_parts", "pending_assignment", "pending_inspection", "in_work", "pending_qc", "in_qc", "pending_wash", "pending_road_test", "in_inspection"];

/** Where a loose-items job is on its four steps, from the facts. */
export function looseStepsOf(job: { status: string; is_open: boolean; gated_out_at?: string | null }, received: boolean): Record<LooseStepKey, LooseStepState> {
  const out = !job.is_open || !!job.gated_out_at || job.status === "closed" || job.status === "completed";
  const money = !out && ["ready", "pending_payment", "in_delivery"].includes(job.status);
  const work = !out && !money && (BEFORE_MONEY.includes(job.status) || job.status === "booked");
  if (out) return { received: "done", work: "done", money: "done", out: "done" };
  if (money) return { received: "done", work: "done", money: "current", out: "later" };
  if (!received) return { received: "current", work: work ? "later" : "later", money: "later", out: "later" };
  return { received: "done", work: "current", money: "later", out: "later" };
}

const day = (d: string) => new Date(d.slice(0, 10) + "T08:00:00Z").toLocaleDateString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short" });
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "ARRIVAL WAS DUE Wed 19 Nov, 08:46" for a booked car past its arrival time, else null. */
export function arrivalDueWords(arrivalAt: string | null | undefined, nowMs: number): string | null {
  const t = arrivalAt ? Date.parse(arrivalAt) : NaN;
  if (!Number.isFinite(t) || t > nowMs) return null;
  return `ARRIVAL WAS DUE ${fmt(arrivalAt as string).toUpperCase()}`;
}

export type BookedPart = { name: string; orderStatus: string | null; received: boolean; expected: string | null };

/** The parts that cannot be here before the promised handover (expected after it, or not ordered yet). */
export function partsLateForHandover(parts: BookedPart[], promisedAt: string | null | undefined): BookedPart[] {
  if (!promisedAt) return [];
  const promised = String(promisedAt).slice(0, 10);
  return parts.filter((p) => !p.received && (p.expected ? p.expected.slice(0, 10) > promised : p.orderStatus === "none" || p.orderStatus === "to_order"));
}

/** The warning words when the promised handover cannot be met. */
export function handoverRiskWords(late: BookedPart[], promisedAt: string | null | undefined): string | null {
  if (!late.length || !promisedAt) return null;
  return `The promised handover (${fmt(promisedAt)}) cannot be met: ${late.map((p) => `${p.name.toUpperCase()}${p.expected ? ` expected ${day(p.expected)}` : " not ordered yet"}`).join(", ")}. Agree a new time with the customer.`;
}

/** One line for each part's status before arrival. */
export function bookedPartWords(p: BookedPart): string {
  if (p.received) return "Here";
  if (p.orderStatus === "ordered" || p.orderStatus === "partly_received") return p.expected ? `Ordered · expected ${day(p.expected)}` : "Ordered";
  if (p.orderStatus === "to_order") return "To order";
  return "Not ordered yet";
}

/** The department a job's work belongs to, from its lines: any bodyshop work = bodyshop, else mechanical. */
export function departmentOfSides(sides: (string | null)[]): "bodyshop" | "mechanical" {
  return sides.includes("bodyshop") ? "bodyshop" : "mechanical";
}

/** The PPF pre-work check belongs only to a job with PPF or paint work. */
export const showsPreworkCheck = (kinds: string[]) => kinds.some((k) => k === "ppf" || k === "paint" || k === "ppf_tint" || /ppf|paint/i.test(k));

/** "Quotation not started" is wrong once the estimate is approved or its parts are ordered: the step words. */
export function bookedQuoteWords(input: { quoteNumber: string | null; quoteStatus: string | null; estimateNumber: string | null; estimateStatus: string | null; partsOrdered: number }): { words: string; done: boolean } {
  if (input.quoteNumber) return { words: `Quotation ${input.quoteNumber}: ${input.quoteStatus ?? ""}`.trim(), done: input.quoteStatus === "approved" };
  if (input.estimateNumber && input.estimateStatus === "approved") return { words: `Estimate ${input.estimateNumber} approved by the customer${input.partsOrdered ? ` · ${input.partsOrdered} part${input.partsOrdered === 1 ? "" : "s"} ordered` : ""}`, done: true };
  if (input.estimateNumber) return { words: `Estimate ${input.estimateNumber}: ${input.estimateStatus ?? ""}`.trim(), done: false };
  if (input.partsOrdered) return { words: `${input.partsOrdered} part${input.partsOrdered === 1 ? "" : "s"} ordered`, done: true };
  return { words: "Quotation not started", done: false };
}
