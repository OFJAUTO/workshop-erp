// THE rules of the Estimates and Quotations lists (13 November 2026, evening list, Section 6). Pure: the tab a row sits
// in, its tags, how long it has waited (the tag turns red), the oldest-first order, search and Mine/All. Shared by the
// list component, the 2-day "ready to send" reminder and the owner's count, so all of them say the same thing.

export type ListTab = "preparing" | "sent" | "approved" | "closed";
export const LIST_TABS: { key: Exclude<ListTab, "closed">; label: string }[] = [
  { key: "preparing", label: "Preparing" },
  { key: "sent", label: "Sent" },
  { key: "approved", label: "Approved" },
];

export type ListFacts = {
  status: string;
  carried: boolean;
  /** The owner approved or edited it and handed it back (still a draft). */
  handback: boolean;
  /** Part lines still waiting on the parts desk for a price. */
  withDesk: number;
  /** Lines on it that count (a draft with nothing on it is not "ready to send"). */
  lineCount: number;
  /** The total; a draft at AED 0 is not ready to send (no price yet). */
  total?: number;
  moneyKey?: string | null;
  createdAt: string;
  sentAt: string | null;
  respondedAt: string | null;
  handedBackAt?: string | null;
  updatedAt?: string | null;
};

/** The tab: being prepared (draft or with the owner), sent (out with the customer), approved, or closed. */
export function tabOf(r: Pick<ListFacts, "status" | "carried">): ListTab {
  if (r.carried) return "closed";
  if (["draft", "pending_owner"].includes(r.status)) return "preparing";
  if (["sent", "opened", "urgent_requested"].includes(r.status)) return "sent";
  if (r.status === "approved") return "approved";
  return "closed";
}

/** Ready to send: a draft with something on it, no part waiting on the parts desk, not waiting for the owner. */
export function readyToSend(r: Pick<ListFacts, "status" | "carried" | "withDesk" | "lineCount" | "total">): boolean {
  return !r.carried && r.status === "draft" && r.withDesk === 0 && r.lineCount > 0 && (r.total === undefined || r.total > 0);
}

export type ListTag = { key: string; words: string; tone: "green" | "amber" | "red" | "outline" };

/** The row's tags: Ready to send · With parts desk (n) · Waiting for owner · Opened by customer (the money badge adds Deposit paid / Proforma unpaid). */
export function tagsOf(r: ListFacts): ListTag[] {
  const tags: ListTag[] = [];
  if (r.status === "pending_owner") tags.push({ key: "owner", words: "Waiting for owner", tone: "amber" });
  if (readyToSend(r)) tags.push({ key: "ready", words: "Ready to send", tone: "green" });
  if (r.withDesk > 0 && tabOf(r) === "preparing") tags.push({ key: "desk", words: r.withDesk === 1 ? "With parts desk" : `With parts desk (${r.withDesk})`, tone: "amber" });
  if (r.status === "opened" || r.status === "urgent_requested") tags.push({ key: "opened", words: "Opened by customer", tone: "outline" });
  // Deposit paid / Proforma unpaid: the money badge of the estimate (Prepaid · Part paid AED x of y · Proforma sent – unpaid) is that tag.
  return tags;
}

/** When the row started waiting in its tab: prepared since it started (or was handed back), sent since sent, approved since the answer. */
export function waitingSince(r: ListFacts): string {
  const tab = tabOf(r);
  if (tab === "sent") return r.sentAt ?? r.createdAt;
  if (tab === "approved") return r.respondedAt ?? r.sentAt ?? r.createdAt;
  if (r.handback && r.handedBackAt) return r.handedBackAt;
  return r.createdAt;
}

/** Days after which the age tag turns red, per tab (approved waits longer: the car is on its way). */
export const RED_AFTER_DAYS: Record<ListTab, number> = { preparing: 2, sent: 2, approved: 7, closed: Infinity };
export const READY_REMIND_DAYS = 2;

const DAY = 86_400_000;
/** Whole days waited (0 = today). */
export function daysWaited(since: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(since)) / DAY));
}
export function ageTag(r: ListFacts, now: number): { days: number; words: string; red: boolean } {
  const days = daysWaited(waitingSince(r), now);
  const words = days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
  return { days, words, red: days >= RED_AFTER_DAYS[tabOf(r)] };
}

/** Oldest waiting first; ties by number. */
export function oldestFirst<T extends { facts: ListFacts; number: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(waitingSince(a.facts)) - Date.parse(waitingSince(b.facts)) || a.number.localeCompare(b.number));
}

/** Search: number, plate, VIN, customer, make and model; spaces and dashes ignored for plates and numbers. */
export function listSearchHit(hay: (string | null | undefined)[], q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = hay.filter(Boolean).join(" ").toLowerCase();
  const squeezed = text.replace(/[\s\-·]+/g, "");
  const qSqueezed = q.toLowerCase().replace(/[\s\-·]+/g, "");
  return words.every((w) => text.includes(w)) || (qSqueezed.length >= 3 && squeezed.includes(qSqueezed));
}

/** Mine or All: advisors open on Mine, everyone else on All. */
export type Who = "mine" | "all";
export function whoDefault(role: string): Who {
  return role === "service_advisor" ? "mine" : "all";
}
export function readWho(v: string | undefined, role: string): Who {
  return v === "mine" || v === "all" ? v : whoDefault(role);
}
export function readTab(v: string | undefined): ListTab {
  return v === "sent" || v === "approved" || v === "closed" ? v : "preparing";
}

/** An owner-approved estimate or quotation that has not gone to the customer for more than 2 days. */
export function ownerApprovedUnsent(r: { status: string; carried: boolean; ownerApprovedAt: string | null; sentAt: string | null }, now: number): boolean {
  if (r.carried || r.status !== "draft" || !r.ownerApprovedAt) return false;
  if (r.sentAt && Date.parse(r.sentAt) > Date.parse(r.ownerApprovedAt)) return false;
  return now - Date.parse(r.ownerApprovedAt) > READY_REMIND_DAYS * DAY;
}

/** The 2-day reminder: ready to send and untouched for 2 days, reminded at most every 2 days. */
export function readyReminderDue(r: ListFacts, lastReminder: string | null, now: number): boolean {
  if (!readyToSend(r)) return false;
  const since = r.updatedAt ?? waitingSince(r);
  if (now - Date.parse(since) < READY_REMIND_DAYS * DAY) return false;
  return !lastReminder || now - Date.parse(lastReminder) >= READY_REMIND_DAYS * DAY;
}
