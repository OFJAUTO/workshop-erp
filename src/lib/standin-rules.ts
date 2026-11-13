/**
 * APPROVALS STAND-IN (13 November 2026, Section 15). The owner sends his approvals to one person between two dates; he
 * picks which approval types go to them, each with a cost limit (above it, the request still waits for him). The
 * stand-in decides through THE same Approvals page and decision door, "on behalf of the owner"; nobody approves their
 * own request. It ends by itself after the end date, or with one tap. Works beside auto-approve (12 November).
 * Pure: the settings page, the server and the tests read these rules.
 */

export const STANDIN_KEY = "approval_standin";
export const STANDIN_LOG_KEY = "approval_standin_log";

export type StandInType = { on: boolean; limit: number | null };
export type StandIn = {
  staffId: string | null;
  staffName: string | null;
  from: string | null;
  until: string | null;
  types: Record<string, StandInType>;
  setBy: string | null;
  setAt: string | null;
  endedAt: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyStandIn(kinds: readonly string[]): StandIn {
  return { staffId: null, staffName: null, from: null, until: null, types: Object.fromEntries(kinds.map((k) => [k, { on: false, limit: null }])), setBy: null, setAt: null, endedAt: null };
}

/** The stored value, read safely (unknown kinds dropped, bad numbers = no limit). */
export function readStandIn(raw: unknown, kinds: readonly string[]): StandIn {
  const d = emptyStandIn(kinds);
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const types = v.types && typeof v.types === "object" ? (v.types as Record<string, unknown>) : {};
  for (const k of kinds) {
    const s = types[k] && typeof types[k] === "object" ? (types[k] as Record<string, unknown>) : null;
    if (!s) continue;
    const lim = s.limit === null || s.limit === undefined || s.limit === "" ? null : Number(s.limit);
    d.types[k] = { on: s.on === true, limit: lim !== null && Number.isFinite(lim) && lim >= 0 ? lim : null };
  }
  const str = (x: unknown) => (typeof x === "string" && x ? x : null);
  d.staffId = str(v.staffId);
  d.staffName = str(v.staffName);
  d.from = typeof v.from === "string" && DAY.test(v.from) ? v.from : null;
  d.until = typeof v.until === "string" && DAY.test(v.until) ? v.until : null;
  d.setBy = str(v.setBy);
  d.setAt = str(v.setAt);
  d.endedAt = str(v.endedAt);
  return d;
}

/** Set, not ended, and today (Dubai) between the two dates (both inclusive). */
export function standInActive(s: StandIn, today: string): boolean {
  if (!s.staffId || s.endedAt || !s.from || !s.until) return false;
  return s.from <= today && today <= s.until;
}

/** "AED 1,234.50" (the item's money words) → 1234.5; no money = 0. */
export function moneyOf(words: string | null | undefined): number {
  const m = /(-?[\d,]+(?:\.\d+)?)/.exec(String(words ?? "").replace(/AED\s*/i, ""));
  return m ? Number(m[1].replace(/,/g, "")) || 0 : 0;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** May this stand-in decide this request? The type ticked, within its limit, and never their own request. */
export function standInMay(s: StandIn, item: { kind: string; money: string | null; askedBy: string | null }, person: { id: string; display_name: string; full_name?: string | null }, today: string): { ok: true } | { ok: false; why: string } {
  if (!standInActive(s, today) || s.staffId !== person.id) return { ok: false, why: "Only the owner decides this." };
  if (same(item.askedBy, person.display_name) || same(item.askedBy, person.full_name ?? null)) return { ok: false, why: "You asked for this one yourself: it waits for the owner." };
  const t = s.types[item.kind];
  if (!t?.on) return { ok: false, why: "This type is not sent to you: it waits for the owner." };
  if (t.limit !== null && moneyOf(item.money) > t.limit + 0.004) return { ok: false, why: `Above your limit (AED ${t.limit.toLocaleString("en-GB")}): it waits for the owner.` };
  return { ok: true };
}

/** The name carried into every log and history line: "Peter on behalf of the owner". */
export const onBehalfName = (name: string) => `${name} on behalf of the owner`;

/** "Approvals go to Peter until 20 Nov". */
export function standInNotice(name: string, until: string): string {
  const d = new Date(`${until}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `Approvals go to ${name} until ${d}`;
}

export type StandInLogRow = { at: string; by: string; kind: string; title: string; decision: "approved" | "refused"; money: string | null };
/** "Peter today: 3 approved, 1 refused". */
export function summaryWords(name: string, rows: StandInLogRow[]): string {
  const a = rows.filter((r) => r.decision === "approved").length;
  const r = rows.length - a;
  return `${name} today: ${a} approved${r ? `, ${r} refused` : ""} on your behalf`;
}
