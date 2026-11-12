/**
 * AUTO-APPROVE WHILE THE OWNER IS AWAY (12 November 2026). The owner ticks approval types; while the master switch is ON
 * (and until its end date), a request of a ticked type within its cost limit is approved at once, logged as
 * "AUTO-APPROVED (OWNER AWAY)", with no bell to him. Pure: the settings page, the server and the tests read these rules.
 */

export const AUTO_WORDS = "AUTO-APPROVED (OWNER AWAY)";
export const AUTO_SETTING_KEY = "auto_approve";
export const AUTO_EVENT = "auto_approved";

export type AutoType = { key: string; group: string; label: string; preTicked: boolean; /** What the cost limit is compared with. */ figure: string };

/** The types that can be approved by themselves (each at the point where it is asked). */
export const AUTO_TYPES: AutoType[] = [
  { key: "comp_goodwill", group: "Complimentary (quotations and estimates)", label: "Goodwill gesture", preTicked: true, figure: "cost to us" },
  { key: "comp_our_mistake", group: "Complimentary (quotations and estimates)", label: "Our mistake / rework", preTicked: true, figure: "cost to us" },
  { key: "comp_warranty", group: "Complimentary (quotations and estimates)", label: "Warranty claim (our 6-month warranty)", preTicked: true, figure: "cost to us" },
  { key: "comp_recovery", group: "Complimentary (quotations and estimates)", label: "Complimentary recovery, pick-up and drop-off", preTicked: true, figure: "cost to us" },
  { key: "free_charge_recovery", group: "Free charges on the job card", label: "Free recovery, pick-up or drop-off", preTicked: true, figure: "cost to us" },
  { key: "free_charge_other", group: "Free charges on the job card", label: "Free fuel or other charge", preTicked: false, figure: "cost to us" },
  { key: "quote_discount", group: "Quotations and estimates", label: "Discount above the advisor's limit", preTicked: false, figure: "the discount (AED)" },
  { key: "quote_roundoff", group: "Quotations and estimates", label: "Round-off down above the limit", preTicked: false, figure: "the round-off (AED)" },
  { key: "quote_total", group: "Quotations and estimates", label: "Total above the approval amount", preTicked: false, figure: "the quotation total (AED)" },
];

/** The other approval types in the ERP: they always come to the owner (each decides through its own owner-only step). */
export const NOT_AUTO: { label: string; why: string }[] = [
  { label: "Revision of an approved quotation", why: "changes work the customer already approved" },
  { label: "Commission", why: "it already counts from the moment it is set; the owner's decision only confirms it" },
  { label: "LPO", why: "accounts can approve LPOs up to a limit you set (Settings > Money, \"Accounts approve LPOs up to AED …\")" },
  { label: "Supplier discount above the limit", why: "supplier money" },
  { label: "Inspection fee below the minimum", why: "customer money" },
  { label: "Supplier price went up", why: "supplier money" },
  { label: "Change to an approved report", why: "the customer may already have it" },
  { label: "Stock reversal", why: "stock and money" },
  { label: "Comeback at our cost", why: "who pays for the whole job" },
  { label: "Payment above the balance", why: "customer money" },
  { label: "Void a receipt", why: "money already recorded" },
  { label: "Void a lathe bill", why: "money already recorded" },
  { label: "Inspection type made smaller", why: "what the customer pays for" },
];

export type AutoTypeSetting = { on: boolean; limit: number | null };
export type AutoConfig = { on: boolean; until: string | null; types: Record<string, AutoTypeSetting>; setBy: string | null; setAt: string | null };

export function defaultConfig(): AutoConfig {
  return { on: false, until: null, types: Object.fromEntries(AUTO_TYPES.map((t) => [t.key, { on: t.preTicked, limit: null }])), setBy: null, setAt: null };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The stored value, read safely: unknown keys dropped, missing types at their defaults, bad numbers as no limit. */
export function readConfig(raw: unknown): AutoConfig {
  const d = defaultConfig();
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const types = v.types && typeof v.types === "object" ? (v.types as Record<string, unknown>) : {};
  for (const t of AUTO_TYPES) {
    const s = types[t.key] && typeof types[t.key] === "object" ? (types[t.key] as Record<string, unknown>) : null;
    if (!s) continue;
    const lim = s.limit === null || s.limit === undefined || s.limit === "" ? null : Number(s.limit);
    d.types[t.key] = { on: s.on === true, limit: lim !== null && Number.isFinite(lim) && lim >= 0 ? lim : null };
  }
  d.on = v.on === true;
  d.until = typeof v.until === "string" && DAY.test(v.until) ? v.until : null;
  d.setBy = typeof v.setBy === "string" ? v.setBy : null;
  d.setAt = typeof v.setAt === "string" ? v.setAt : null;
  return d;
}

/** Switched on, and the end date (Dubai, inclusive) not passed. */
export function isActive(cfg: AutoConfig, today: string): boolean {
  return cfg.on && (!cfg.until || today <= cfg.until);
}

/** Ticked, and within its limit (blank = no limit). */
export function typeAllows(cfg: AutoConfig, key: string, figure: number): boolean {
  const t = cfg.types[key];
  if (!t?.on) return false;
  return t.limit === null || figure <= t.limit + 0.004;
}

/** Which type a quotation's owner reason is (the words of ownerApprovalReasons / compApprovalReason), or null. */
export function quoteReasonType(reason: string): "comp" | "quote_discount" | "quote_roundoff" | "quote_total" | null {
  if (reason.startsWith("complimentary (")) return "comp";
  if (reason.startsWith("discount ") || /: part discount of /.test(reason) || /: discount of [\d.]+% is above /.test(reason)) return "quote_discount";
  if (reason.startsWith("round-off AED ")) return "quote_roundoff";
  if (/^Total of .+ is above /.test(reason)) return "quote_total";
  return null;
}

export type QuoteFigures = { discount: number; roundDown: number; total: number; compCost: number; compReason: string | null; compAllRecovery: boolean };

/**
 * Can every reason this quotation waits for be approved by itself? A complimentary reason goes by its own reason
 * (goodwill, our mistake, warranty) - or as complimentary recovery when the free lines are only recovery. One reason
 * not covered = it goes to the owner as usual (nothing is half-approved). `types` lists what was used.
 */
export function quoteAutoDecision(cfg: AutoConfig, reasons: string[], f: QuoteFigures): { ok: boolean; types: string[]; blocking: string[] } {
  const types: string[] = [];
  const blocking: string[] = [];
  for (const r of reasons) {
    const t = quoteReasonType(r);
    let used: string | null = null;
    if (t === "comp") {
      const own = f.compReason ? `comp_${f.compReason}` : null;
      if (own && typeAllows(cfg, own, f.compCost)) used = own;
      else if (f.compAllRecovery && typeAllows(cfg, "comp_recovery", f.compCost)) used = "comp_recovery";
    } else if (t === "quote_discount" && typeAllows(cfg, t, f.discount)) used = t;
    else if (t === "quote_roundoff" && typeAllows(cfg, t, f.roundDown)) used = t;
    else if (t === "quote_total" && typeAllows(cfg, t, f.total)) used = t;
    if (used) types.push(used);
    else blocking.push(r);
  }
  return { ok: reasons.length > 0 && blocking.length === 0, types: Array.from(new Set(types)), blocking };
}

/** A free job-card charge's type. */
export const freeChargeType = (kind: string) => (kind === "recovery" ? "free_charge_recovery" : "free_charge_other");

export const aed = (n: number) => `AED ${(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The one log line: "AUTO-APPROVED (OWNER AWAY): Q-00012 v1 – complimentary (…) · asked by Peter · cost to us AED 150.00". */
export function autoLogNote(what: string, askedBy: string, cost: number): string {
  return `${AUTO_WORDS}: ${what} · asked by ${askedBy} · cost to us ${aed(cost)}`;
}

/** The cost back out of a log line (the list and the daily summary). */
export function costFromNote(note: string | null | undefined): number {
  const m = /cost to us AED ([\d,]+(?:\.\d+)?)/.exec(note ?? "");
  return m ? Number(m[1].replace(/,/g, "")) || 0 : 0;
}

/** "Auto-approved today: 3 items, total cost AED 900.00". */
export function summaryWords(count: number, cost: number): string {
  return `Auto-approved today: ${count} item${count === 1 ? "" : "s"}, total cost ${aed(cost)}`;
}

/** The dashboard's line while it is on: "AUTO-APPROVE IS ON until 20 Nov · Goodwill, Our mistake …". */
export function activeWords(cfg: AutoConfig): string {
  const ticked = AUTO_TYPES.filter((t) => cfg.types[t.key]?.on).map((t) => t.label);
  const until = cfg.until ? ` until ${new Date(`${cfg.until}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : " (no end date)";
  return `AUTO-APPROVE IS ON${until} · ${ticked.length} type${ticked.length === 1 ? "" : "s"}: ${ticked.join(", ") || "none ticked"}`;
}
