/**
 * BACK ORDER - FIT ON A LATER VISIT (13 November 2026, J-00317). Pure rules: who may choose it, the labour split,
 * the money that moves to the follow-up job, and the customer's one line. The server side is src/lib/back-orders.ts.
 */

export type BackOrderStatus = "pending" | "active" | "refused" | "arrived" | "fitted" | "cancelled";
export type PayMode = "now" | "when_fitted";

/** The owner, a workshop manager (mechanical) or the bodyshop manager (a workshop manager of the bodyshop) choose it. */
export const mayDecideBackOrder = (role: string) => role === "owner" || role === "workshop_manager";
/** An advisor asks for it: it then needs the owner (the ONE approval box; auto-approve applies when the type is ticked). */
export const mayRequestBackOrder = (role: string) => mayDecideBackOrder(role) || role === "service_advisor";
/** "Pays when fitted" always needs the owner's yes (the customer drives away owing nothing for the part). */
export const needsOwner = (role: string, payMode: PayMode) => role !== "owner" && (role === "service_advisor" || payMode === "when_fitted");

export const BACK_ORDER_AUTO_TYPE = "back_order";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The hours that go to the later visit: 0 up to the line's hours, in tenths. */
export function splitProblem(lineHours: number, moved: number): string | null {
  if (!Number.isFinite(moved) || moved < 0) return "Type the hours for later (0 or more).";
  if (round1(moved) !== round2(moved)) return "Hours in tenths only (for example 1.5).";
  if (moved > lineHours + 0.0001) return `The line has ${lineHours.toFixed(1)} h: no more than that can move.`;
  return null;
}

/** A labour line's own amount for a share of its hours (its rate, its line discount). */
export function labourShare(line: { hours: number; labour_rate: number; discount_percent: number }, hours: number): number {
  return round2(round2(hours * line.labour_rate) * (1 - (line.discount_percent || 0) / 100));
}

/** The money that moves, before VAT and with VAT: exactly what the follow-up job will charge. */
export function movedMoney(partAmount: number, labourAmount: number, vatPercent: number): { net: number; vat: number; total: number } {
  const net = round2(partAmount + labourAmount);
  const vat = round2(net * (vatPercent / 100));
  return { net, vat, total: round2(net + vat) };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** "08 JAN 2027" from "2027-01-08". */
export function docDate(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** THE one line on this visit's customer documents: no part numbers, costs or supplier names. */
export function onOrderWords(partName: string, expected: string | null): string {
  const when = docDate(expected);
  return `${partName.trim().toUpperCase()} ON ORDER - TO BE FITTED ON ARRIVAL${when ? ` (EXPECTED ${when})` : ""}`;
}

/** Days past the expected date (0 when not late or no date). */
export function daysOverdue(expected: string | null, today: string): number {
  if (!expected) return 0;
  const a = Date.parse(`${expected.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T12:00:00Z`);
  return b > a ? Math.round((b - a) / 86400000) : 0;
}

/** The customer's message when the part arrived (a draft the advisor sends). */
export function arrivedMessage(greeting: string, partName: string, car: string): string {
  return `Dear ${greeting},\n\nGood news: the ${partName.trim().toUpperCase()} for your ${car} has arrived at OFJ Automotive.\n\nPlease let us know when you can bring the car in to have it fitted. It takes about one visit, and the work is already approved.\n\nOFJ Automotive`;
}

/** The words of a back order's state for the lists and the job cards. */
export const STATUS_WORDS: Record<BackOrderStatus, string> = {
  pending: "Waiting for the owner",
  active: "Waiting for part - car not here",
  refused: "Refused",
  arrived: "Part arrived - book the customer",
  fitted: "Fitted",
  cancelled: "Cancelled",
};

/** Is a line's title about this part? (the shared labour line: "ENGINE MOUNT AND TRANSMISSION MOUNT REMOVAL ...") */
export function lineMentionsPart(title: string, partName: string): boolean {
  const words = partName.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return false;
  const t = title.toUpperCase();
  return words.every((w) => t.includes(w));
}
