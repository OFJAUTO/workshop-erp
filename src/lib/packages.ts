/**
 * Bodyshop packages (20 October 2026): the owner builds them in Settings, the advisor picks one and
 * types ONE price, the customer sees the package price with everything included and no individual
 * prices. The included items are SNAPSHOTTED onto the quotation line (package_items), so the customer's
 * page and PDF never change when the owner later edits the package. Pure: shared by screens and PDFs.
 */

export type PackageItem = {
  label: string;
  /** "10-year warranty", "5 years" - free words, shown beside the item. */
  warranty: string | null;
  /** Only if the car has one: the question the advisor answers when adding ("Sunroof / panoramic roof"). */
  only_if: string | null;
};

export type BodyshopPackage = {
  key: string;
  name: string;
  /** "5–7 working days" - shown to the customer as "Estimated completion" (the stored key keeps its old name). */
  time_in_workshop: string;
  items: PackageItem[];
  pickup_dropoff: boolean;
  aftercare_check: boolean;
};

/** What lands on the quotation line: the chosen items only, with their warranties. */
export type PackageSnapshot = {
  key: string;
  name: string;
  time_in_workshop: string;
  pickup_dropoff: boolean;
  aftercare_check: boolean;
  items: { label: string; warranty: string | null }[];
};

export function cleanPackages(input: unknown): BodyshopPackage[] {
  if (!Array.isArray(input)) return [];
  const out: BodyshopPackage[] = [];
  for (const p of input) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    const items = Array.isArray(r.items)
      ? (r.items as Record<string, unknown>[])
          .map((i) => ({ label: String(i?.label ?? "").trim(), warranty: String(i?.warranty ?? "").trim() || null, only_if: String(i?.only_if ?? "").trim() || null }))
          .filter((i) => i.label)
      : [];
    out.push({
      key: String(r.key ?? "").trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60),
      name,
      time_in_workshop: String(r.time_in_workshop ?? "").trim(),
      items,
      pickup_dropoff: r.pickup_dropoff !== false,
      aftercare_check: r.aftercare_check !== false,
    });
  }
  return out;
}

export function packagesOf(settings: { bodyshop_packages?: unknown }): BodyshopPackage[] {
  return cleanPackages(settings.bodyshop_packages);
}

/** The snapshot for the line: optional items kept only when the advisor ticked them. */
export function packageSnapshot(p: BodyshopPackage, tickedOptional: string[]): PackageSnapshot {
  return {
    key: p.key,
    name: p.name,
    time_in_workshop: p.time_in_workshop,
    pickup_dropoff: p.pickup_dropoff,
    aftercare_check: p.aftercare_check,
    items: p.items.filter((i) => !i.only_if || tickedOptional.includes(i.label)).map((i) => ({ label: i.label, warranty: i.warranty })),
  };
}

export function toSnapshot(raw: unknown): PackageSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.items)) return null;
  return {
    key: String(r.key ?? ""),
    name: String(r.name ?? ""),
    time_in_workshop: String(r.time_in_workshop ?? ""),
    pickup_dropoff: r.pickup_dropoff !== false,
    aftercare_check: r.aftercare_check !== false,
    items: (r.items as Record<string, unknown>[]).map((i) => ({ label: String(i?.label ?? ""), warranty: i?.warranty ? String(i.warranty) : null })).filter((i) => i.label),
  };
}

/**
 * The package split the way every customer document shows it: the included items (with warranties),
 * the complimentary extras (an item named "Complimentary …" and the two ticks, never the same thing
 * twice), and the estimated completion. Pure; the screens, the link and every PDF read it.
 */
export function packageParts(raw: unknown): { name: string; items: { label: string; warranty: string | null }[]; complimentary: string[]; completion: string | null } | null {
  const s = toSnapshot(raw);
  if (!s) return null;
  const isComp = (l: string) => /^complimentary\b/i.test(l.trim());
  const isPickup = (l: string) => /pick[\s-]?up/i.test(l) && /drop[\s-]?off/i.test(l);
  const isAftercare = (l: string) => /10[\s-]?day/i.test(l);
  const complimentary = s.items.filter((i) => isComp(i.label)).map((i) => i.label.trim());
  if (s.pickup_dropoff && !complimentary.some(isPickup)) complimentary.push("Complimentary pick-up & drop-off");
  if (s.aftercare_check && !complimentary.some(isAftercare)) complimentary.push("Complimentary 10-day after-care check");
  return { name: s.name, items: s.items.filter((i) => !isComp(i.label)), complimentary, completion: s.time_in_workshop || null };
}

/** The customer's words under the package line: every surface (link, proforma, tax invoice, PDFs) uses the same text. */
export function packageDetailsText(raw: unknown): string | null {
  const p = packageParts(raw);
  if (!p) return null;
  const lines = p.items.map((i) => `• ${i.label}${i.warranty ? ` — ${warrantyWords(i.warranty)}` : ""}`);
  for (const c of p.complimentary) lines.push(`• ${c}`);
  // Section 8: "Estimated completion" closes the list, on its own line.
  if (p.completion) lines.push(`${ESTIMATED_COMPLETION}: ${p.completion}`);
  return lines.join("\n") || null;
}

/** Section 8 (21 October): the one name for the package's duration, on every screen and document. */
export const ESTIMATED_COMPLETION = "Estimated completion";

/** "10 years" → "10 years warranty"; words already saying warranty stay as they are. */
export function warrantyWords(w: string): string {
  return w.toLowerCase().includes("warrant") ? w : `${w} warranty`;
}

/**
 * Section 9 (21 October): the ONE package model behind every customer document - the PDF section
 * (PackageSection in src/lib/pdf/template.tsx) and the web card (src/components/PackageCard.tsx) both
 * read it. Title large, subtitle "finish · car", the included items with their warranties, the
 * complimentary extras as badges, and the estimated completion on its own line. `decorate` lets the
 * tint items carry the job's shade (section 11) without the package ever storing one.
 */
export type PackageDoc = {
  title: string;
  subtitle: string;
  items: { label: string; warranty: string | null }[];
  complimentary: string[];
  completion: string | null;
};

const FINISHES: [RegExp, string][] = [
  [/\bmatte?\b/i, "Matte finish"],
  [/\bstealth\b/i, "Stealth finish"],
  [/\bsatin\b/i, "Satin finish"],
  [/\bgloss(y)?\b/i, "Gloss finish"],
];

export function packageDocOf(raw: unknown, opts: { car?: string | null; decorate?: (label: string) => string } = {}): PackageDoc | null {
  const p = packageParts(raw);
  if (!p) return null;
  // "OFJ Full Protection Package - Matte Finish": the part before the dash is the title, the part after
  // it is the owner's own finish wording; a name without a dash gets the finish found inside it.
  const [head, ...rest] = p.name.split(/\s+[-–—]\s+/);
  const tail = rest.join(" – ").trim();
  const finish = tail || (FINISHES.find(([re]) => re.test(p.name))?.[1] ?? "");
  return {
    title: (head || p.name).trim(),
    subtitle: [finish, opts.car ?? null].filter((x): x is string => !!x && !!x.trim()).join(" · "),
    items: p.items.map((i) => ({ label: opts.decorate ? opts.decorate(i.label) : i.label, warranty: i.warranty ? warrantyWords(i.warranty) : null })),
    complimentary: p.complimentary,
    completion: p.completion,
  };
}
