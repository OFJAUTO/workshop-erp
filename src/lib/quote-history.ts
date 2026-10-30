/**
 * A job's quotations and their versions (29 October 2026, batch section 1). Pure: the job card's Quotations list,
 * the "2 quotations" picker on car cards, the old-version banner, the customer's "Additional quotation" title and
 * the "Additional quotation not approved" chip all read these rules.
 *
 *  - Every quotation NUMBER on a job is one family; "New quotation" on a job that has one is an ADDITIONAL
 *    quotation and never touches the earlier ones. "Revise" adds a version to the SAME number; old versions stay
 *    saved and read-only.
 *  - The first number on the job is the ORIGINAL; every later number is ADDITIONAL.
 *  - Money: approved = what the customer approved on each number's current approved version; waiting = numbers
 *    out with the customer or the owner; declined = numbers the customer declined.
 */

const TZ = "Asia/Dubai";
const day = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ }).format(new Date(iso)) : "");

export type QuoteVersionRow = {
  id: string;
  job_id: string | null;
  number: string;
  version: number;
  kind: string;
  status: string;
  total_aed: number;
  approved_total_aed: number | null;
  rounded_total_aed: number | null;
  sent_at: string | null;
  opened_at: string | null;
  responded_at: string | null;
  approver_name: string | null;
  created_at: string;
  created_by: string | null;
  token: string | null;
  /** Estimates (30 October 2026): the car, the estimate it adds to, the job it was carried over to, why it was cancelled. */
  vehicle_id?: string | null;
  additional_to_id?: string | null;
  carried_job_id?: string | null;
  cancel_reason?: string | null;
};

export type QuoteFamily = {
  number: string;
  /** A job: the first number is the ORIGINAL, later ones ADDITIONAL. Estimates: ADDITIONAL when made as one, ORIGINAL when one adds to it, else single (no chip). */
  role: "original" | "additional" | "single";
  /** Versions oldest first; `current` is the newest. */
  versions: QuoteVersionRow[];
  current: QuoteVersionRow;
  /** The amount shown on the row: the approved total once approved, else the rounded (or plain) total. */
  amount: number;
  /** Estimates: the number this one adds to, and the job it was carried over to at gate-in. */
  addsTo?: string | null;
  carriedTo?: { id: string; number: string } | null;
};

/** What a version is worth on a row. */
export function amountOf(v: Pick<QuoteVersionRow, "status" | "approved_total_aed" | "rounded_total_aed" | "total_aed">): number {
  if (v.status === "approved" && v.approved_total_aed !== null) return Number(v.approved_total_aed);
  return Number(v.rounded_total_aed ?? v.total_aed) || 0;
}

/** The job's quotations grouped by number, the original first, each with its versions. Cancelled and deleted rows are left out by the loader. */
export function quoteFamilies(rows: QuoteVersionRow[]): QuoteFamily[] {
  const byNumber = new Map<string, QuoteVersionRow[]>();
  for (const r of rows) {
    if (r.kind !== "quotation") continue;
    const list = byNumber.get(r.number) ?? [];
    list.push(r);
    byNumber.set(r.number, list);
  }
  const families = Array.from(byNumber.entries()).map(([number, list]) => {
    const versions = [...list].sort((a, b) => a.version - b.version);
    const current = versions[versions.length - 1];
    return { number, versions, current, amount: amountOf(current), first: versions[0].created_at };
  });
  families.sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : a.number.localeCompare(b.number)));
  return families.map((f, i) => ({ number: f.number, role: i === 0 ? "original" : "additional", versions: f.versions, current: f.current, amount: f.amount }));
}

const WAITING = ["pending_owner", "sent", "opened", "urgent_requested"];

/**
 * An estimate still waiting for its car (30 October 2026): accepted by the customer, or still being prepared or with
 * the customer, and not carried to a job. The ONE list for the "already has an open estimate" question and the gate-in
 * carry-over.
 */
export const OPEN_ESTIMATE_STATUSES = ["approved", "draft", "pending_owner", "sent", "opened", "urgent_requested"];

/** "Approved so far AED X · Waiting for approval AED Y · Declined AED Z". */
export function quoteMoney(families: QuoteFamily[]): { approved: number; waiting: number; declined: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  let approved = 0;
  let waiting = 0;
  let declined = 0;
  for (const f of families) {
    const s = f.current.status;
    if (s === "approved") approved += f.amount;
    else {
      // A revision on its way: the customer's earlier approval still stands until the new version is approved.
      const lastApproved = [...f.versions].reverse().find((v) => v.status === "approved");
      if (lastApproved) approved += amountOf(lastApproved);
      if (WAITING.includes(s)) waiting += f.amount;
      else if (s === "declined") declined += f.amount;
    }
  }
  return { approved: round2(approved), waiting: round2(waiting), declined: round2(declined) };
}

/** The status words on a row: "APPROVED 29 Oct by ZIGA OMERSEL", "SENT 29 Oct", "OPENED 29 Oct", "BEING PREPARED". */
export function statusWords(v: QuoteVersionRow): string {
  switch (v.status) {
    case "approved":
      return `Approved ${day(v.responded_at)}${v.approver_name ? ` by ${v.approver_name}` : ""}`;
    case "sent":
      return `Sent ${day(v.sent_at)}`;
    case "opened":
      return `Opened by the customer ${day(v.opened_at ?? v.sent_at)}`;
    case "declined":
      return `Declined ${day(v.responded_at)}`;
    case "expired":
      return "Expired";
    case "urgent_requested":
      return `Customer asked for urgent work only ${day(v.responded_at)}`;
    case "pending_owner":
      return "Waiting for the owner's approval";
    case "superseded":
      return "Replaced by a newer version";
    case "cancelled":
      return `Cancelled${v.cancel_reason ? `: ${v.cancel_reason}` : ""}`;
    case "draft":
      return v.token ? "Link made, not sent yet" : "Being prepared";
    default:
      return v.status;
  }
}

/** "OLD VERSION – replaced by v2 on 29 Oct by Mathew", or null for the newest version. */
export function oldVersionBanner(versions: Pick<QuoteVersionRow, "id" | "version" | "created_at" | "created_by">[], id: string, nameOf: (staffId: string | null) => string | null): string | null {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const at = sorted.findIndex((v) => v.id === id);
  if (at < 0 || at === sorted.length - 1) return null;
  const next = sorted[at + 1];
  const newest = sorted[sorted.length - 1];
  const who = nameOf(next.created_by);
  return `OLD VERSION – replaced by v${next.version} on ${day(next.created_at)}${who ? ` by ${who}` : ""}${newest.version !== next.version ? ` (newest is v${newest.version})` : ""}`;
}

/**
 * The earlier quotations an additional quotation adds to, for the customer's copy: the earlier numbers on the job
 * whose customer approved them. Empty when there is none (the quotation is then simply a quotation).
 */
export function additionalTo(families: QuoteFamily[], number: string): { number: string; approvedOn: string }[] {
  const at = families.findIndex((f) => f.number === number);
  if (at <= 0) return [];
  return families
    .slice(0, at)
    .map((f) => ({ f, approved: [...f.versions].reverse().find((v) => v.status === "approved") ?? null }))
    .filter((x) => !!x.approved)
    .map((x) => ({ number: x.f.number, approvedOn: day(x.approved!.responded_at) }));
}

/** "In addition to quotation Q-00002 (approved 24 Oct)" / "…quotations Q-00002 (approved 24 Oct) and Q-00031 (approved 28 Oct)". */
export function additionalLine(earlier: { number: string; approvedOn: string }[]): string | null {
  if (!earlier.length) return null;
  const parts = earlier.map((e) => `${e.number}${e.approvedOn ? ` (approved ${e.approvedOn})` : ""}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `In addition to quotation${parts.length === 1 ? "" : "s"} ${list}`;
}

/**
 * The car card's chip while an additional quotation waits for the customer and earlier work is approved:
 * "Additional quotation not approved · 5 h". The job's stage stays where the approved work is.
 */
export function additionalWaitingChip(families: QuoteFamily[], now: number): { text: string; number: string; hours: number } | null {
  const anyApproved = families.some((f) => f.versions.some((v) => v.status === "approved"));
  if (!anyApproved) return null;
  const waiting = families.find((f) => f.role === "additional" && ["sent", "opened", "pending_owner", "urgent_requested", "draft"].includes(f.current.status));
  if (!waiting) return null;
  const since = waiting.current.sent_at ?? waiting.current.created_at;
  const hours = Math.max(0, Math.floor((now - Date.parse(since)) / 3600000));
  const words = waiting.current.status === "draft" || waiting.current.status === "pending_owner" ? "Additional quotation not sent" : "Additional quotation not approved";
  return { text: `${words} · ${hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`}`, number: waiting.number, hours };
}

/** True when any quotation of the job is approved: the job's Approval step stays done while an additional one waits. */
export function anyApproved(families: QuoteFamily[]): boolean {
  return families.some((f) => f.versions.some((v) => v.status === "approved"));
}

/** One row of the "2 quotations" picker on a car card or a visit row. */
export type QuotePickItem = { number: string; role: QuoteFamily["role"]; words: string; amount: string; href: string; versions: number };

/** The picker rows of a job: each quotation number opening its newest version. */
export function pickItems(jobId: string, families: QuoteFamily[]): QuotePickItem[] {
  const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return families.map((f) => ({ number: f.number, role: f.role, words: statusWords(f.current), amount: money(f.amount), href: `/jobs/${jobId}/quote/${f.current.id}`, versions: f.versions.length }));
}

/**
 * The estimates of one car (30 October 2026), oldest first, every number with its versions, the way a job's
 * quotations are listed. An estimate made with "Make an additional estimate" is ADDITIONAL (it names the one it adds
 * to); the estimate it adds to is the ORIGINAL; a lone estimate has no chip. Nothing is left out but deleted drafts.
 */
export function estimateFamilies(rows: QuoteVersionRow[], jobNumbers: Map<string, string>): QuoteFamily[] {
  const byNumber = new Map<string, QuoteVersionRow[]>();
  for (const r of rows) {
    if (r.kind !== "estimate") continue;
    const list = byNumber.get(r.number) ?? [];
    list.push(r);
    byNumber.set(r.number, list);
  }
  const numberOfId = new Map(rows.map((r) => [r.id, r.number]));
  const addsToOf = (list: QuoteVersionRow[]) => {
    const id = list.find((v) => v.additional_to_id)?.additional_to_id ?? null;
    return id ? (numberOfId.get(id) ?? null) : null;
  };
  const targets = new Set(Array.from(byNumber.values()).map(addsToOf).filter((n): n is string => !!n));
  const families = Array.from(byNumber.entries()).map(([number, list]) => {
    const versions = [...list].sort((a, b) => a.version - b.version);
    const current = versions[versions.length - 1];
    const addsTo = addsToOf(versions);
    const carriedId = versions.map((v) => v.carried_job_id).find((x) => !!x) ?? null;
    const role: QuoteFamily["role"] = addsTo ? "additional" : targets.has(number) ? "original" : "single";
    return { number, role, versions, current, amount: amountOf(current), addsTo, carriedTo: carriedId ? { id: carriedId, number: jobNumbers.get(carriedId) ?? "the job" } : null, first: versions[0].created_at };
  });
  families.sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : a.number.localeCompare(b.number)));
  return families.map((f) => ({ number: f.number, role: f.role, versions: f.versions, current: f.current, amount: f.amount, addsTo: f.addsTo, carriedTo: f.carriedTo }));
}

/** The customer's copy of an additional estimate: "In addition to estimate E-00035" ("(accepted 30 Oct)" once accepted). */
export function additionalEstimateLine(base: { number: string; acceptedOn: string | null } | null): string | null {
  if (!base) return null;
  return `In addition to estimate ${base.number}${base.acceptedOn ? ` (accepted ${base.acceptedOn})` : ""}`;
}

/** "30 Oct" in Dubai. */
export const dubaiDay = day;
