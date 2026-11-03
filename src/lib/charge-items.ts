/**
 * THE CHARGES OF A CAR (3 November 2026, section 8; J-00969). Pure: no database.
 *
 * A recovery, fuel or other charge lives in one of two places: typed on the job card (charge_lines: early charges,
 * before or after the check-in approval) or typed on a quotation (the editor's "Other charges" block: a recovery line,
 * an Other charge, an Internal cost). J-00969's Charges section read only the first, so the approved Q-00039's
 * "RECOVERY, FULL DOWN, TWO WAYS · AED 400.00" was missing and the section said "No recovery, fuel or other charges".
 *
 *  - `chargeItems` is THE list: every charge of the car exactly ONCE. A job-card charge that went into a quotation is
 *    one item (the job-card row, shown "on Q-00039 · approved"); a quotation line appears from the version that
 *    counts (the newest approved one, plus lines new on a revision being prepared), never twice across versions.
 *  - `chargeCostsOnce` is THE cost rule: every charge's cost counts once in the profit. A job-card charge counts its
 *    own cost; a quotation charge counts the cost typed from the supplier's bill, else its quoted estimate, and only
 *    once the quotation is approved. Recovery: a trip on the Recovery page replaces the charge it IS - matched by who
 *    did it (our trucks, or the same company), trip for trip; the charges' figures stand in for their trips not priced
 *    yet while the car is with us. A charge no trip belongs to (an outside tow-in with its own bill) keeps its own cost.
 *  - `recoveryAlready` is the 8.2 rule: adding a recovery while one is already on the car asks once.
 *
 * Not charges: the Consumables line (internal materials) and the Inspection fee line (revenue, not a pass-through
 * cost), the automatic bank charge, a recovery the customer arranges himself, and option lines not chosen.
 *
 * Review fixes (3 November 2026): trips are matched to charges by who did them (an own-truck delivery no longer
 * replaces an outside company's tow-in); a closed job counts only the trips recorded on it (never "1 of 2 trips priced"
 * for good); a charge taken off its quotation, or on one not approved yet, is not counted as charged; the below-cost
 * words say only what really happened; the recovery cost line names what is priced and what is an estimate.
 */
import { chargeNet, type ChargeKind, type ChargeLineRow } from "./charge-rules";
import { sameName } from "./messages";
import { isComplimentary, isHidden, isUnchosen, lineCost, lineTotal, type QuoteLine } from "./quotes";

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => r2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** One version of a quotation of the job (any status but cancelled/deleted). */
export type ChargeQuoteVersion = { id: string; number: string; version: number; status: string };
/** A quotation line as the charge list needs it (a QuoteLine from LINE_SELECT fits). */
export type ChargeQuoteLine = Pick<QuoteLine, "id" | "quotation_id" | "line_type" | "title" | "quantity" | "unit_cost" | "markup_percent" | "unit_price" | "hours" | "labour_rate" | "discount_percent" | "visible_to_customer" | "is_active" | "fee_kind" | "option_group" | "chosen" | "recovery_trips" | "recovery_provider" | "recovery_provider_kind"> &
  Partial<Pick<QuoteLine, "position" | "markup_mode" | "markup_aed" | "price_display" | "left_off" | "revised_from_line_id" | "recovery_paid_by" | "below_cost_reason" | "below_cost_at" | "below_cost_sell_aed" | "below_cost_cost_aed">>;
/** The cost and supplier of a quotation charge, typed from the bill (charge_lines with origin 'quotation', keyed to the line's FIRST version). */
export type ChargeCostRow = { id: string; quotation_line_id: string; cost_aed: number; provider: string | null; supplier_trn: string | null; /** The owner typed (or last changed) it himself. */ by_owner?: boolean };
/** A recovery trip of the car (Recovery page): the driver's or company's price, null until it is known; the company, null for our own trucks. */
export type ChargeTrip = { id: string; price_aed: number | null; company?: string | null };

/** Who did a recovery: our own trucks, a named (or unnamed) outside company, or nothing known. */
export type ChargeWho = "ours" | "company" | "any";
/** What the owner knows of a charge that costs more than it is charged. */
export type OwnerKnows = "approved" | "told" | "owner" | null;

export type ChargeItem = {
  /** "charge:<id>" for a job-card charge, "line:<first line id>" for a quotation charge. */
  key: string;
  source: "charge" | "quotation";
  /** The charge row's id, or the id of the quotation line shown. */
  id: string;
  /** The quotation line shown (on the version that counts), for a quotation charge or a job-card charge that went into one. */
  lineId: string | null;
  /** The quotation line's FIRST version (the bill and the cost row are kept on it, so they follow every revision). */
  rootLineId: string | null;
  kind: ChargeKind;
  description: string;
  provider: string | null;
  supplierTrn: string | null;
  /** Recovery only: who did it (matches it to its trips on the Recovery page). */
  who: ChargeWho;
  /** The quotation holding it, and "on Q-00039 · approved". Null for a job-card charge on no quotation. */
  where: ChargeQuoteVersion | null;
  whereWords: string | null;
  /** What the customer pays before VAT (0 when free, internal or no longer charged). */
  charge: number;
  /** Its charge counts in "charged" now: a job-card charge on no quotation; a quotation charge (or a job-card charge
   *  that went into a quotation) once that quotation is approved. */
  billed: boolean;
  /** A job-card charge whose quotation line was taken off, or whose quotation ended without approval: not charged. */
  notCharged: boolean;
  free: boolean;
  /** Internal: we pay it, the customer never sees it ("Internal – not charged"). */
  hidden: boolean;
  /** The quotation's own estimate of the cost (quotation charges). */
  quotedCost: number | null;
  /** The cost typed from the bill (a quotation charge's cost row) or a job-card charge's own cost. */
  actualCost: number | null;
  /** What counts: the actual cost, else the estimate. */
  cost: number;
  /** Its cost counts in the job's profit now: every job-card charge; a quotation charge once its quotation is approved. */
  counted: boolean;
  /** Recovery trips it stands for (0 for fuel and other). */
  trips: number;
  /** The supplier's bill is tied to this id (job_files.ref_id): the charge row, or the quotation line's first version. */
  billRefId: string;
  /** The cost row of a quotation charge, once a cost was typed. */
  costRowId: string | null;
  /** When it costs more than it is charged: the owner approved it, was told (the notice went out), or entered it himself. */
  ownerKnows: OwnerKnows;
  /** The job-card row itself (status, free approval). */
  row: ChargeLineRow | null;
};

/** Lines that are not charges, by their title: internal materials and the inspection fee. */
export const NOT_A_CHARGE_TITLE = /^\s*(consumables|inspection fee)\b/i;

/** A quotation line that is a charge of the car: a recovery or an Other charge (shown or internal). */
export function isQuoteCharge(l: Pick<ChargeQuoteLine, "line_type" | "title" | "is_active" | "fee_kind" | "option_group" | "chosen" | "recovery_provider_kind"> & { left_off?: boolean }): boolean {
  if (!l.is_active || l.fee_kind) return false;
  if (l.line_type !== "recovery" && l.line_type !== "other") return false;
  if (isUnchosen(l)) return false;
  if (l.line_type === "recovery" && l.recovery_provider_kind === "customer") return false;
  if (l.line_type === "other" && NOT_A_CHARGE_TITLE.test(String(l.title ?? ""))) return false;
  return true;
}

/** Recovery, Fuel (by its words) or Other. */
export function quoteChargeKind(l: Pick<ChargeQuoteLine, "line_type" | "title">): ChargeKind {
  if (l.line_type === "recovery") return "recovery";
  return /\b(fuel|petrol|diesel)\b/i.test(String(l.title ?? "")) ? "fuel" : "other";
}

/** "OUR TRUCK", "Own recovery", "OFJ": our own trucks, as typed in a provider or company box. */
export function isOurProvider(name: string | null | undefined): boolean {
  const s = String(name ?? "").trim();
  return /^(our|ours|own)\b/i.test(s) || /^ofj\b/i.test(s) || /\bour\s+(own\s+)?(truck|trucks|recovery|driver)\b/i.test(s);
}

/** Who did a quotation's recovery: its provider choice ("ours" / "external" with the company's name). */
export function whoOfLine(l: Pick<ChargeQuoteLine, "recovery_provider" | "recovery_provider_kind">, provider: string | null = l.recovery_provider ?? null): ChargeWho {
  if (l.recovery_provider_kind === "ours") return "ours";
  const name = String(provider ?? "").trim();
  if (l.recovery_provider_kind === "external") return name && isOurProvider(name) ? "ours" : "company";
  if (!name) return "any";
  return isOurProvider(name) ? "ours" : "company";
}

/** Who did a job-card recovery: the provider typed ("Recovery company, or Our truck"); nothing typed matches any trip. */
export function whoOfRow(row: Pick<ChargeLineRow, "provider">): ChargeWho {
  const name = String(row.provider ?? "").trim();
  if (!name) return "any";
  return isOurProvider(name) ? "ours" : "company";
}

/** The first version of a line: followed back through revised_from_line_id (a revision copies every line). */
export function rootLineOf(id: string, parentOf: Map<string, string | null | undefined>): string {
  let cur = id;
  const seen = new Set<string>([cur]);
  for (;;) {
    const up = parentOf.get(cur);
    if (!up || seen.has(up)) return cur;
    // An earlier line that was not loaded is still the earliest one known: every reader stops at the same id.
    if (!parentOf.has(up)) return up;
    seen.add(up);
    cur = up;
  }
}

/** The quotation's state in a few words, after "on Q-00039 · ". */
export function quoteStateWords(status: string): string {
  switch (status) {
    case "approved": return "approved";
    case "sent": return "sent, waiting for the customer";
    case "opened": return "opened by the customer";
    case "urgent_requested": return "customer asked for urgent work only";
    case "pending_owner": return "waiting for the owner";
    case "draft": return "being prepared";
    case "declined": return "declined – not charged";
    case "expired": return "expired – not charged";
    case "superseded": return "replaced by a newer version";
    case "cancelled": return "cancelled – not charged";
    default: return status;
  }
}

/** "on Q-00039 · approved", "on Q-00039 v2 · being prepared". */
export function whereWords(v: Pick<ChargeQuoteVersion, "number" | "version" | "status">): string {
  return `on ${v.number}${v.version > 1 ? ` v${v.version}` : ""} · ${quoteStateWords(v.status)}`;
}

/** "Q-00039", "Q-00039 v2". */
export function versionLabel(v: Pick<ChargeQuoteVersion, "number" | "version">): string {
  return `${v.number}${v.version > 1 ? ` v${v.version}` : ""}`;
}

/**
 * How a quotation's charge is changed, in words around the quotation's number (the screen links the number for the
 * people who may open quotations): an approved quotation only through a revised version the owner allows; a draft on
 * the quotation itself; a sent one through a new version.
 */
export function readOnlyWords(status: string): { lead: string; tail: string } {
  if (status === "approved" || status === "superseded") return { lead: "Read-only – it changes only with a revised ", tail: ", which the owner allows." };
  if (status === "draft" || status === "pending_owner") return { lead: "Read-only here – change it on ", tail: "." };
  return { lead: "Read-only here – it changes with a new version of ", tail: "." };
}

/** A family whose newest version ended without approval: nothing on it is charged. */
const DEAD = new Set(["declined", "expired", "cancelled"]);

/** The versions whose charge lines are listed: per quotation number, the newest approved version (it counts), plus the
 *  newest version when a revision is under way; a number never approved, its newest version unless it ended. */
export function shownVersions(versions: ChargeQuoteVersion[]): ChargeQuoteVersion[] {
  const byNumber = new Map<string, ChargeQuoteVersion[]>();
  for (const v of versions) byNumber.set(v.number, [...(byNumber.get(v.number) ?? []), v]);
  const out: ChargeQuoteVersion[] = [];
  for (const list of byNumber.values()) {
    const sorted = [...list].sort((a, b) => a.version - b.version);
    const current = sorted[sorted.length - 1];
    const approved = [...sorted].reverse().find((v) => v.status === "approved") ?? null;
    if (approved) out.push(approved);
    if (current !== approved && !DEAD.has(current.status) && current.status !== "superseded") out.push(current);
  }
  return out;
}

/** "AED 400.00 + VAT", "Complimentary", "Internal – not charged" or "Not charged" (taken off its quotation). */
export function chargeAmountWords(i: Pick<ChargeItem, "hidden" | "free" | "charge"> & Partial<Pick<ChargeItem, "notCharged">>): string {
  if (i.notCharged) return "Not charged";
  if (i.hidden) return "Internal – not charged";
  if (i.free) return "Complimentary";
  return `AED ${money(i.charge)} + VAT`;
}

/** The owner's below-cost approval on a quotation line covers these figures: never a lower price, never a higher cost. */
export function ownerApprovedBelowCost(l: Pick<ChargeQuoteLine, "below_cost_at" | "below_cost_sell_aed" | "below_cost_cost_aed">, cost: number, charge: number): boolean {
  if (!l.below_cost_at) return false;
  const okSell = l.below_cost_sell_aed === null || l.below_cost_sell_aed === undefined ? null : Number(l.below_cost_sell_aed);
  const okCost = l.below_cost_cost_aed === null || l.below_cost_cost_aed === undefined ? null : Number(l.below_cost_cost_aed);
  return okSell !== null && charge + 0.005 >= okSell && (okCost === null || cost <= okCost + 0.005);
}

/**
 * THE list of the car's charges, each exactly once (see the top of the file). `rows` are the job-card charges (not the
 * quotation cost rows), `costRows` the costs typed on quotation charges, `versions` every version of the job's
 * quotations and `lines` their recovery and Other lines (every version, so a revision is traced back to its first line).
 * `owners` are the owner's staff ids (to say who entered a charge that costs more than it is charged).
 */
export function chargeItems(input: { rows: ChargeLineRow[]; costRows?: ChargeCostRow[]; versions: ChargeQuoteVersion[]; lines: ChargeQuoteLine[]; owners?: string[] }): ChargeItem[] {
  const { rows, versions, lines } = input;
  const owners = new Set(input.owners ?? []);
  const parentOf = new Map<string, string | null | undefined>(lines.map((l) => [l.id, l.revised_from_line_id ?? null]));
  const root = (id: string) => rootLineOf(id, parentOf);
  const versionOf = new Map(versions.map((v) => [v.id, v]));
  const shown = shownVersions(versions);
  // Root line -> the line shown and its version: the counting (approved) version first, so its figures win.
  const placed = new Map<string, { line: ChargeQuoteLine; v: ChargeQuoteVersion }>();
  for (const v of shown) {
    const mine = lines.filter((l) => l.quotation_id === v.id && isQuoteCharge(l)).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
    for (const l of mine) {
      const r = root(l.id);
      if (!placed.has(r)) placed.set(r, { line: l, v });
    }
  }
  /** A quotation number that ended without approval: its newest version ("on Q-00039 · declined – not charged"). */
  const endedVersion = (number: string): ChargeQuoteVersion | null => {
    const fam = versions.filter((v) => v.number === number).sort((a, b) => a.version - b.version);
    const cur = fam[fam.length - 1];
    return cur && DEAD.has(cur.status) && !fam.some((v) => v.status === "approved") ? cur : null;
  };
  const costByRoot = new Map((input.costRows ?? []).map((c) => [root(c.quotation_line_id), c]));
  // A job-card charge that went into a quotation is ONE item: the job-card row (it carries the cost and the bill).
  const pushedRoots = new Set(rows.filter((row) => !!row.quotation_line_id).map((row) => root(row.quotation_line_id!)));
  const out: ChargeItem[] = [];
  const quoteItems: ChargeItem[] = [];
  for (const [r, { line, v }] of placed) {
    if (pushedRoots.has(r)) continue;
    const c = costByRoot.get(r) ?? null;
    const quoted = lineCost(line);
    const hidden = isHidden(line);
    const charge = hidden ? 0 : lineTotal(line);
    const cost = c ? r2(Number(c.cost_aed) || 0) : quoted;
    const provider = c?.provider ?? line.recovery_provider ?? null;
    const approved = v.status === "approved";
    // What the owner knows when it costs more than it is charged: his own below-cost approval on the line; else the
    // bill's cost typed by someone else, which told him (saveQuoteChargeCost); else the cost he typed himself.
    const ownerKnows: OwnerKnows = ownerApprovedBelowCost(line, cost, charge) ? "approved" : c ? (c.by_owner ? "owner" : Number(c.cost_aed) > charge + 0.005 ? "told" : null) : null;
    quoteItems.push({
      key: `line:${r}`,
      source: "quotation",
      id: line.id,
      lineId: line.id,
      rootLineId: r,
      kind: quoteChargeKind(line),
      description: String(line.title ?? "").trim(),
      provider,
      supplierTrn: c?.supplier_trn ?? null,
      who: line.line_type === "recovery" ? whoOfLine(line, provider) : "any",
      where: v,
      whereWords: whereWords(v),
      charge,
      billed: approved,
      notCharged: false,
      free: isComplimentary(line),
      hidden,
      quotedCost: quoted,
      actualCost: c ? r2(Number(c.cost_aed) || 0) : null,
      cost,
      counted: approved,
      trips: line.line_type === "recovery" ? Math.max(1, Math.round(Number(line.recovery_trips ?? line.quantity) || 1)) : 0,
      billRefId: r,
      costRowId: c?.id ?? null,
      ownerKnows,
      row: null,
    });
  }
  out.push(...quoteItems);
  for (const row of [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))) {
    const r = row.quotation_line_id ? root(row.quotation_line_id) : null;
    const at = r ? placed.get(r) : undefined;
    // Went into a quotation, but its line is no longer on the version that counts (taken off, or the quotation
    // ended without approval): the customer is not charged for it. Its cost is still ours.
    const offQuote = !!row.quotation_line_id && !at;
    let words: string | null = null;
    if (at) words = whereWords(at.v);
    else if (row.quotation_line_id) {
      const ql = lines.find((l) => l.id === row.quotation_line_id);
      const v = ql ? versionOf.get(ql.quotation_id) : undefined;
      if (v) {
        const ended = endedVersion(v.number);
        words = ended ? whereWords(ended) : `taken off ${v.number} – not charged`;
      } else words = "its quotation was cancelled – not charged";
    }
    const cost = r2(Number(row.cost_aed) || 0);
    const hidden = at ? isHidden(at.line) : false;
    // A charge that went into a quotation bills what the quotation line says (the quotation is the truth for the customer).
    const charge = offQuote || hidden ? 0 : at ? lineTotal(at.line) : chargeNet(row);
    const ownerKnows: OwnerKnows = at && ownerApprovedBelowCost(at.line, cost, charge)
      ? "approved"
      : row.created_by && owners.has(row.created_by)
        ? "owner"
        : !row.free && cost > (Number(row.charge_aed) || 0) + 0.005
          ? "told" // addCharges told the owner when it was saved
          : null;
    out.push({
      key: `charge:${row.id}`,
      source: "charge",
      id: row.id,
      lineId: at?.line.id ?? null,
      rootLineId: r,
      kind: row.kind,
      description: row.description,
      provider: row.provider ?? null,
      supplierTrn: row.supplier_trn ?? null,
      who: row.kind === "recovery" ? whoOfRow(row) : "any",
      where: at?.v ?? null,
      whereWords: words,
      charge,
      billed: offQuote ? false : at ? at.v.status === "approved" : true,
      notCharged: offQuote,
      free: at ? isComplimentary(at.line) || !!row.free : !!row.free,
      hidden,
      quotedCost: null,
      actualCost: cost,
      cost,
      counted: true,
      trips: row.kind === "recovery" ? Math.max(1, Math.round(Number(row.trips) || 1)) : 0,
      billRefId: row.id,
      costRowId: null,
      ownerKnows,
      row,
    });
  }
  return out;
}

/** "Costs more than it is charged – the owner approved it." Only what really happened (never "the owner is told" when nobody told him). */
export function belowCostWords(i: Pick<ChargeItem, "ownerKnows">): string {
  switch (i.ownerKnows) {
    case "approved": return "Costs more than it is charged – the owner approved it.";
    case "told": return "Costs more than it is charged – the owner was told.";
    case "owner": return "Costs more than it is charged – entered by the owner.";
    default: return "Costs more than it is charged.";
  }
}

/** Under a job-card charge that went into a quotation not approved yet: it is charged only once that quotation is. */
export function notBilledWords(i: Pick<ChargeItem, "source" | "billed" | "notCharged" | "where">): string | null {
  if (i.source !== "charge" || i.billed || i.notCharged || !i.where) return null;
  return `Charged to the customer once ${versionLabel(i.where)} is approved; its cost counts already.`;
}

export type ChargeCosts = {
  recovery: number;
  other: number;
  total: number;
  /** The car has recovery trips (Recovery page). */
  fromTrips: boolean;
  trips: number;
  pricedTrips: number;
  tripsTotal: number;
  /** Trips the counted recovery charges stand for. */
  estimatedTrips: number;
  /** The charges' cost standing in for their trips not priced yet, and how many trips that is. */
  standIn: number;
  standInTrips: number;
  /** Recovery charges no trip belongs to (an outside company's tow with its own bill): their own cost. */
  fromCharges: number;
  fromChargesCount: number;
  /** The items costed from their trips (keys): their own cost box takes the bill for the paper only. */
  tripKeys: string[];
  /** "recovery: 1 of 2 trips priced". */
  provisional: string[];
};

type CostItem = Pick<ChargeItem, "kind" | "cost" | "counted" | "trips"> & Partial<Pick<ChargeItem, "key" | "who" | "provider">>;

/**
 * THE cost rule: what the car's charges cost us, every one counted ONCE. Fuel and other: each counted item's cost.
 * Recovery: each trip on the Recovery page belongs to the recovery charges of whoever did it - our trucks (a trip with
 * no company) or the same company; a charge with nobody named takes any trip. A group of charges with trips costs its
 * priced trips plus the charges' cost per trip for each of its trips not priced yet - while the car is with us (`open`)
 * every trip the charges stand for, once it has left only the trips recorded on it. A group with no trip costs its own
 * figure (the bill, else the estimate). A trip that belongs to no charge counts on its own once priced.
 */
export function chargeCostsOnce(items: CostItem[], trips: ChargeTrip[], opts: { open?: boolean } = {}): ChargeCosts {
  const open = opts.open !== false;
  const counted = items.filter((i) => i.counted);
  const other = r2(counted.filter((i) => i.kind !== "recovery").reduce((a, i) => a + (Number(i.cost) || 0), 0));
  const rec = counted.filter((i) => i.kind === "recovery");
  type Group = { who: ChargeWho; name: string | null; items: CostItem[]; trips: ChargeTrip[] };
  const groups: Group[] = [];
  for (const i of rec) {
    const who = i.who ?? "any";
    const name = who === "company" ? String(i.provider ?? "").trim() || null : null;
    let g = groups.find((x) => x.who === who && (who !== "company" || (name ? !!x.name && sameName(x.name, name) : !x.name)));
    if (!g) groups.push((g = { who, name, items: [], trips: [] }));
    g.items.push(i);
  }
  const extra: ChargeTrip[] = [];
  for (const t of trips) {
    const company = String(t.company ?? "").trim();
    const ours = !company || isOurProvider(company);
    const g = ours
      ? groups.find((x) => x.who === "ours") ?? groups.find((x) => x.who === "any")
      : groups.find((x) => x.who === "company" && !!x.name && sameName(x.name, company)) ?? groups.find((x) => x.who === "company" && !x.name) ?? groups.find((x) => x.who === "any");
    if (g) g.trips.push(t);
    else extra.push(t);
  }
  const isPriced = (t: ChargeTrip) => t.price_aed !== null && t.price_aed !== undefined && Number.isFinite(Number(t.price_aed));
  const priced = trips.filter(isPriced);
  const tripsTotal = r2(priced.reduce((a, t) => a + Number(t.price_aed), 0));
  let recovery = 0;
  let standIn = 0;
  let standInTrips = 0;
  let fromCharges = 0;
  let fromChargesCount = 0;
  let pricedSeen = 0;
  let allSeen = 0;
  const tripKeys: string[] = [];
  for (const g of groups) {
    const est = g.items.reduce((a, i) => a + (Number(i.cost) || 0), 0);
    const estTrips = g.items.reduce((a, i) => a + (Number(i.trips) || 0), 0);
    if (!g.trips.length) {
      fromCharges += est;
      fromChargesCount += g.items.length;
      continue;
    }
    for (const i of g.items) if (i.key) tripKeys.push(i.key);
    const p = g.trips.filter(isPriced);
    const perTrip = estTrips > 0 ? est / estTrips : 0;
    // While the car is with us its charges stand for every trip they name (one may not be recorded yet); once it has
    // left, the trips recorded on it are the truth - a trip never recorded is never priced, so it is not waited for.
    const stand = open ? estTrips : Math.min(estTrips, g.trips.length);
    const toPrice = Math.max(0, stand - p.length);
    recovery += p.reduce((a, t) => a + Number(t.price_aed), 0) + perTrip * toPrice;
    standIn += perTrip * toPrice;
    standInTrips += toPrice;
    pricedSeen += p.length;
    allSeen += open ? Math.max(g.trips.length, estTrips) : g.trips.length;
  }
  const extraPriced = extra.filter(isPriced);
  recovery += extraPriced.reduce((a, t) => a + Number(t.price_aed), 0) + fromCharges;
  pricedSeen += extraPriced.length;
  allSeen += extra.length;
  const provisional: string[] = [];
  if (pricedSeen < allSeen) provisional.push(`recovery: ${pricedSeen} of ${allSeen} ${plural(allSeen, "trip")} priced`);
  recovery = r2(recovery);
  const estimatedTrips = rec.reduce((a, i) => a + (Number(i.trips) || 0), 0);
  return { recovery, other, total: r2(recovery + other), fromTrips: trips.length > 0, trips: trips.length, pricedTrips: priced.length, tripsTotal, estimatedTrips, standIn: r2(standIn), standInTrips, fromCharges: r2(fromCharges), fromChargesCount, tripKeys, provisional };
}

/**
 * The recovery cost in words, each part named: "Recovery cost AED 720.00: AED 460.00 from 2 priced trips + AED 260.00
 * estimated for 1 trip still to price". Null when the car has no trips (each recovery row shows its own cost then).
 */
export function recoveryCostWords(c: ChargeCosts): string | null {
  if (!c.fromTrips) return null;
  const parts: string[] = [];
  if (c.pricedTrips) parts.push(`AED ${money(c.tripsTotal)} from ${c.pricedTrips} priced ${plural(c.pricedTrips, "trip")}`);
  if (c.standInTrips) parts.push(`AED ${money(c.standIn)} estimated for ${c.standInTrips} ${plural(c.standInTrips, "trip")} still to price`);
  if (c.fromChargesCount) parts.push(`AED ${money(c.fromCharges)} from ${c.fromChargesCount === 1 ? "the recovery charge" : `${c.fromChargesCount} recovery charges`} with no trip on the Recovery page`);
  if (!parts.length) parts.push("no trip priced yet");
  return `Recovery cost AED ${money(c.recovery)}: ${parts.join(" + ")}`;
}

/** What the charges bill the customer before VAT: only what is really charged (free, internal, taken off and not yet approved are 0). */
export function chargedTotal(items: (Pick<ChargeItem, "counted" | "charge"> & Partial<Pick<ChargeItem, "billed">>)[]): number {
  return r2(items.filter((i) => i.billed ?? i.counted).reduce((a, i) => a + (Number(i.charge) || 0), 0));
}

/** "RECOVERY, FULL DOWN, TWO WAYS · AED 400.00 · on Q-00039 · approved". */
export function recoveryWords(i: Pick<ChargeItem, "description" | "hidden" | "free" | "charge" | "whereWords" | "row">): string {
  const amount = i.hidden ? "internal – not charged" : i.free ? "complimentary" : `AED ${money(i.charge)}`;
  const where = i.whereWords ?? (i.row?.agreed_at ? "agreed on the vehicle check-in" : "on this car's charges");
  return `${i.description || "RECOVERY"} · ${amount} · ${where}`;
}

/**
 * 8.2: the recoveries already on the car that a new recovery would repeat - on any quotation of the job, or typed on
 * the job card. `exceptNumber` leaves out one quotation (the editor already stops a second recovery on its own quotation).
 * A job-card recovery taken off its quotation is no longer charged, so it never asks.
 */
export function recoveryAlready(items: ChargeItem[], opts: { exceptNumber?: string | null } = {}): ChargeItem[] {
  return items.filter((i) => i.kind === "recovery" && !i.notCharged && !(opts.exceptNumber && i.where?.number === opts.exceptNumber));
}

/** The question's words, next to the recovery being added. */
export function recoveryAlreadyWords(already: ChargeItem[]): string | null {
  if (!already.length) return null;
  return `Recovery already on this car: ${already.map(recoveryWords).join("; ")}. Another recovery charges the customer twice unless it is a different trip.`;
}

/**
 * The quotation lines whose cost is counted by the charge rule (so an invoice line or a hidden line carrying one is not
 * counted again), and the actual cost of a shown line where it differs from its quoted cost (the bill typed, or the
 * job-card charge it came from).
 */
export function chargeLineCosts(items: ChargeItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of items) if (i.lineId && i.actualCost !== null) out.set(i.lineId, i.actualCost);
  return out;
}
