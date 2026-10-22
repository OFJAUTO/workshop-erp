/**
 * Section 12 (21 October 2026): the warranty card vocabulary - ONE model behind the tax invoice's WARRANTY table and
 * its framed "YOUR OFJ WARRANTY" panel, the customer's invoice page, the public warranty page, the certificate PDF
 * and the warranty list. The terms per product (Settings > Warranty terms, the owner's own words), the periods, the
 * PPF areas the team leader ticks, and the activation status that the 10-day after-care check turns to Active.
 * Pure: no imports.
 */
export type WarrantyProduct = "ppf" | "tint" | "ceramic";
export type TermsKey = WarrantyProduct | "mechanical";
export type ProductTerms = { months: number; short: string; full: string };
export type WarrantyTerms = Record<TermsKey, ProductTerms>;

export const TERMS_KEYS: TermsKey[] = ["ppf", "tint", "ceramic", "mechanical"];
export const TERMS_LABELS: Record<TermsKey, string> = { ppf: "Paint protection film (PPF)", tint: "Window tint", ceramic: "Ceramic coating", mechanical: "Mechanical workmanship" };

export const DEFAULT_WARRANTY_TERMS: WarrantyTerms = {
  ppf: { months: 120, short: "Covers the film against yellowing, cracking, bubbling and peeling caused by a defect in the film or its installation. Keep the 10-day after-care check to activate it.", full: "The paint protection film is guaranteed against yellowing, cracking, bubbling, blistering and peeling caused by a defect in the film or in its installation, for the period shown from the handover date. The warranty is activated by the complimentary 10-day after-care check. It does not cover damage from accidents, stone chips that cut through the film, improper washing, chemical spills, or film removed or repaired by anyone other than OFJ Automotive." },
  tint: { months: 60, short: "Covers the tint against bubbling, peeling, cracking and colour change caused by a defect in the film or its installation.", full: "The window tint is guaranteed against bubbling, peeling, cracking, delamination and colour change caused by a defect in the film or in its installation, for the period shown from the handover date. It does not cover scratches, damage from sharp objects, seat belts or stickers, or film removed or repaired by anyone other than OFJ Automotive. Darkness chosen above the legal limit is the customer's own request and responsibility." },
  ceramic: { months: 24, short: "Covers the coating's gloss and water repellence when the car is washed as advised and the care visits are kept.", full: "The ceramic coating is guaranteed to keep its gloss and water repellence for the period shown from the handover date when the car is washed with pH-neutral shampoo, never machine-polished, and brought in for the advised care visits. It does not cover damage from accidents, scratches, chemical spills, bird droppings or tree sap left on the surface, or the coating being treated by anyone other than OFJ Automotive." },
  mechanical: { months: 6, short: "Covers our workmanship on the work listed on this invoice.", full: "Our workmanship on the work listed on this invoice is guaranteed for the period shown from the handover date. Parts carry their own manufacturer warranty. The warranty does not cover wear and tear, damage from accidents or misuse, or work done on the car by anyone else after the handover." },
};

/** The owner's terms from Settings, each product falling back to the standard wording where a box is empty. */
export function termsOf(raw: unknown): WarrantyTerms {
  const r = raw && typeof raw === "object" ? (raw as Record<string, Partial<ProductTerms> | undefined>) : {};
  const out = {} as WarrantyTerms;
  for (const k of TERMS_KEYS) {
    const d = DEFAULT_WARRANTY_TERMS[k];
    const x = r[k] ?? {};
    const months = Number(x.months);
    out[k] = {
      months: Number.isFinite(months) && months > 0 ? Math.round(months) : d.months,
      short: typeof x.short === "string" && x.short.trim() ? x.short.trim() : d.short,
      full: typeof x.full === "string" && x.full.trim() ? x.full.trim() : d.full,
    };
  }
  return out;
}

/** "10-year warranty" → 120, "5 years" → 60, "18 months" → 18; null when the words carry no period. */
export function monthsFromWords(w: string | null | undefined): number | null {
  const s = String(w ?? "").toLowerCase();
  const y = s.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:years?|yrs?)\b/);
  if (y) return Math.round(Number(y[1]) * 12);
  const m = s.match(/(\d+)\s*-?\s*(?:months?|mos?)\b/);
  if (m) return Number(m[1]);
  return null;
}

/** The same day N months later (the 31st becomes the month's last day). */
export function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** 120 → "10 years", 6 → "6 months", 18 → "18 months". */
export function periodWords(months: number): string {
  if (months > 0 && months % 12 === 0) {
    const y = months / 12;
    return `${y} year${y === 1 ? "" : "s"}`;
  }
  return `${months} month${months === 1 ? "" : "s"}`;
}

/** A timestamp's day in Dubai. */
export function dubaiDay(iso: string): string {
  return new Date(Date.parse(iso) + 4 * 3600000).toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / 86400000);
}

/** The form field names of one product's details (shared by the stage form, the details card and the server action). */
export const fieldOf = (r: { product: string; itemKey: string }, what: "roll" | "product" | "areas" | "area_other") => `w:${r.product}:${r.itemKey}:${what}`;

/** The PPF areas the team leader ticks at the end of the PPF stage. */
export const PPF_AREAS = ["Full body", "Full front", "Bonnet", "Front bumper", "Front wings", "Mirrors", "Headlights", "A-pillars", "Roof", "Door edges", "Door cups", "Rocker panels", "Rear bumper", "Boot lid", "Interior screens & trims"] as const;

/** The areas the package or the line names, pre-ticked for the team leader. */
export function areasFromLabels(labels: string[]): string[] {
  const t = labels.join(" · ").toLowerCase();
  const on = new Set<string>();
  const add = (re: RegExp, area: string) => { if (re.test(t)) on.add(area); };
  add(/full\s*(body|car)|whole\s*car|\bfull ppf\b|full protection/, "Full body");
  add(/full\s*front|front\s*end/, "Full front");
  add(/bonnet|\bhood\b/, "Bonnet");
  add(/front\s*bumper/, "Front bumper");
  add(/wing|fender/, "Front wings");
  add(/mirror/, "Mirrors");
  add(/head\s*light|headlamp/, "Headlights");
  add(/pillar/, "A-pillars");
  add(/\broof\b/, "Roof");
  add(/door\s*edge/, "Door edges");
  add(/door\s*cup|handle/, "Door cups");
  add(/rocker|sill/, "Rocker panels");
  add(/rear\s*bumper/, "Rear bumper");
  add(/boot|trunk|tailgate/, "Boot lid");
  add(/interior|screen|trim/, "Interior screens & trims");
  return PPF_AREAS.filter((a) => on.has(a));
}

/** What the coating covers, from its name. */
export function ceramicCoverageOf(label: string): string {
  const l = label.toLowerCase();
  if (/interior|leather|seat/.test(l)) return "Interior leather";
  if (/wheel|rim/.test(l)) return "Wheels";
  if (/glass|windscreen|windshield/.test(l)) return "Glass";
  if (/ppf|film/.test(l)) return "Paintwork and film";
  return "Paintwork";
}

export type AftercareRow = { due_date: string; done_at: string | null; activated_at: string | null; activation_note: string | null; reminded_at: string | null; reminded_12_at: string | null; reminded_20_at: string | null };
export type WarrantyStatusKind = "before_handover" | "pending" | "active" | "not_activated";
export type WarrantyStatus = { kind: WarrantyStatusKind; title: string; detail: string | null; checkDate: string | null; manual: { at: string; note: string | null } | null; reminders: string[]; /** The 10-day check's day, while it is still to come. */ due: string | null };

/** After this many days without the 10-day check the warranty reads "Not activated". */
export const NOT_ACTIVATED_AFTER_DAYS = 30;

/**
 * The card's status. Before the handover it starts at the handover; with a 10-day check it is Pending activation
 * until the check is signed off (or the owner activates it by hand, with a note) and then Active ✓; 30 days after
 * the handover without the check it reads Not activated, with the reminder dates. No check needed: Active ✓.
 */
export function warrantyStatusOf(i: { handoverDay: string | null; check: AftercareRow | null; today: string }): WarrantyStatus {
  const c = i.check;
  const reminders = c ? [c.reminded_at, c.reminded_12_at, c.reminded_20_at].filter((x): x is string => !!x) : [];
  if (!i.handoverDay) return { kind: "before_handover", title: "Starts at handover", detail: "The warranty period runs from the day the car is handed over.", checkDate: null, manual: null, reminders, due: null };
  if (!c) return { kind: "active", title: "Active ✓", detail: null, checkDate: null, manual: null, reminders, due: null };
  if (c.done_at) return { kind: "active", title: "Active ✓", detail: "10-day after-care check completed", checkDate: c.done_at, manual: null, reminders, due: null };
  if (c.activated_at) return { kind: "active", title: "Active ✓", detail: "Activated by OFJ Automotive", checkDate: null, manual: { at: c.activated_at, note: c.activation_note }, reminders, due: null };
  if (daysBetween(i.handoverDay, i.today) >= NOT_ACTIVATED_AFTER_DAYS) return { kind: "not_activated", title: "Not activated – 10-day after-care check not completed", detail: null, checkDate: null, manual: null, reminders, due: null };
  return { kind: "pending", title: "Pending activation – complete your 10-day check", detail: null, checkDate: null, manual: null, reminders, due: c.due_date };
}
