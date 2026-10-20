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
  /** "5–7 working days" - shown to the customer. */
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

/** The customer's words under the package line: every surface (link, proforma, tax invoice, PDFs) uses the same text. */
export function packageDetailsText(raw: unknown): string | null {
  const s = toSnapshot(raw);
  if (!s) return null;
  const lines = s.items.map((i) => `• ${i.label}${i.warranty ? ` — ${i.warranty.toLowerCase().includes("warrant") ? i.warranty : `${i.warranty} warranty`}` : ""}`);
  if (s.time_in_workshop) lines.push(`Time in workshop: ${s.time_in_workshop}`);
  if (s.pickup_dropoff) lines.push("• Complimentary pick-up & drop-off");
  if (s.aftercare_check) lines.push("• Complimentary 10-day after-care check");
  return lines.join("\n") || null;
}
