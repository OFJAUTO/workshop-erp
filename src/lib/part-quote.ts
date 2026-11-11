/**
 * WHICH QUOTATION A PART BELONGS TO (11 November 2026, Section 2, Q-00078 on J-00317). Pure: no server imports.
 *
 * Every parts request and every part belongs to ONE quotation number of its job (versions keep the number). The stored
 * `for_quote` says which (filled by the database when the request or part is made: the quotation it was asked from, or
 * the one being prepared at the time). A part on a line of an APPROVED quotation stays there (only a revision moves
 * it). The counter "n of m priced" and the Parts list of a quotation count only its own parts, so they never disagree.
 */

export type JobQuote = {
  number: string;
  /** The first number on the job is the original, the others are additional. */
  role: "original" | "additional";
  /** The newest version's id and status. */
  newestId: string;
  status: string;
  createdAt: string;
};

/** Still being prepared: a priced part can be added to it straight away. */
export const PREPARING_STATUSES = ["draft", "pending_owner"];
/** Approved by the customer: its parts never move (a revision does that). */
export const LOCKED_STATUSES = ["approved", "urgent_requested"];
/** Gone for good: nothing belongs to it any more. */
export const CLOSED_STATUSES = ["declined", "expired", "cancelled", "superseded"];

/** One row per quotation number, the newest version's state, oldest number first (the original first). */
export function jobQuotesFrom(rows: { id: string; number: string; version: number; status: string; created_at: string }[]): JobQuote[] {
  const first = new Map<string, string>();
  const newest = new Map<string, { id: string; version: number; status: string }>();
  for (const r of rows) {
    if (!first.has(r.number) || r.created_at < first.get(r.number)!) first.set(r.number, r.created_at);
    const cur = newest.get(r.number);
    if (!cur || r.version > cur.version) newest.set(r.number, { id: r.id, version: r.version, status: r.status });
  }
  const numbers = Array.from(first.keys()).sort((a, b) => (first.get(a)! < first.get(b)! ? -1 : first.get(a)! > first.get(b)! ? 1 : a.localeCompare(b)));
  return numbers.map((n, i) => ({ number: n, role: i === 0 ? "original" : "additional", newestId: newest.get(n)!.id, status: newest.get(n)!.status, createdAt: first.get(n)! }));
}

/** The quotation being prepared now: the oldest number whose newest version is a draft or waits for the owner. */
export function preparingQuote(quotes: JobQuote[]): JobQuote | null {
  return quotes.find((q) => PREPARING_STATUSES.includes(q.status)) ?? null;
}

/**
 * THE rule of where a part belongs: on a line of an approved quotation = that one (it never moves); else its stored
 * quotation when that number is on the job; else the quotation whose live line carries it; else none yet.
 */
export function partQuoteOf(part: { tag: string | null; lineNumbers: string[] }, quotes: JobQuote[]): string | null {
  const byNumber = new Map(quotes.map((q) => [q.number, q]));
  const locked = part.lineNumbers.find((n) => LOCKED_STATUSES.includes(byNumber.get(n)?.status ?? ""));
  if (locked) return locked;
  if (part.tag && byNumber.has(part.tag)) return part.tag;
  return part.lineNumbers.find((n) => byNumber.has(n)) ?? null;
}

/** A request with no part yet: its stored quotation, else the one being prepared (where its part will land). */
export function requestQuoteOf(tag: string | null, quotes: JobQuote[]): string | null {
  if (tag && quotes.some((q) => q.number === tag)) return tag;
  return preparingQuote(quotes)?.number ?? null;
}

/** The tag on the parts desk: "for Q-00078 · additional", or "not on a quotation yet". */
export function quoteTagWords(number: string | null, quotes: JobQuote[]): string {
  if (!number) return "Not on a quotation yet";
  const q = quotes.find((x) => x.number === number);
  return `for ${number}${q?.role === "additional" ? " · additional" : ""}${q && LOCKED_STATUSES.includes(q.status) ? " · approved" : ""}`;
}

/** Where a part can be moved: the job's other quotations still being prepared (never an approved one). */
export function moveTargets(current: string | null, quotes: JobQuote[], opts: { onLockedLine: boolean }): JobQuote[] {
  if (opts.onLockedLine) return [];
  return quotes.filter((q) => q.number !== current && PREPARING_STATUSES.includes(q.status));
}

/**
 * "Parts priced for this job on another quote (n) – Add here": priced live parts that are not this quotation's, not
 * on an approved quotation and not already with the customer on another one (a part on a sent quotation stays there).
 */
export function partsToAddHere<P extends { id: string; priced: boolean; live: boolean; tag: string | null; lineNumbers: string[] }>(parts: P[], here: string, quotes: JobQuote[]): P[] {
  const byNumber = new Map(quotes.map((q) => [q.number, q]));
  return parts.filter((p) => {
    if (!p.priced || !p.live) return false;
    const home = partQuoteOf(p, quotes);
    if (home === here) return false;
    if (p.lineNumbers.some((n) => !PREPARING_STATUSES.includes(byNumber.get(n)?.status ?? "draft") && !CLOSED_STATUSES.includes(byNumber.get(n)?.status ?? ""))) return false;
    return true;
  });
}
