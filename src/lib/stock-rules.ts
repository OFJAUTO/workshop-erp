/**
 * THE STOCK PAGE RULES (20 November 2026, Section 5). Pure: the page, the side panel, the count and the unit tests
 * read the same rules. Status per item, the four tiles, search and filters, sorting and paging, the one unit list, the
 * placeholder part numbers, and the stock count's difference per item and in value.
 */

export const STOCK_UNITS = ["pc", "L", "ml", "set", "pair", "m", "kg", "g", "box", "roll", "can", "bottle"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

/** One unit per item from the fixed list ("litre", "ltr" and "Lt" are L; "pcs" is pc). Unknown = null (refused). */
export function cleanStockUnit(raw: string | null | undefined): StockUnit | null {
  const t = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!t) return "pc";
  const map: Record<string, StockUnit> = { pc: "pc", pcs: "pc", piece: "pc", pieces: "pc", nos: "pc", no: "pc", ea: "pc", each: "pc", l: "L", lt: "L", ltr: "L", litre: "L", litres: "L", liter: "L", liters: "L", ml: "ml", set: "set", sets: "set", pair: "pair", pairs: "pair", m: "m", mtr: "m", metre: "m", meter: "m", metres: "m", kg: "kg", g: "g", gm: "g", box: "box", boxes: "box", roll: "roll", rolls: "roll", can: "can", cans: "can", bottle: "bottle", bottles: "bottle" };
  return map[t] ?? null;
}

export type StockStatus = "in" | "low" | "out";
export const STOCK_STATUS_LABEL: Record<StockStatus, string> = { in: "In stock", low: "Low stock", out: "Out of stock" };

export type StockLite = { id: string; name: string; part_number: string | null; quantity: number; minimum_level: number; unit: string; unit_cost?: number; category_id?: string | null; brand?: string | null; item_type?: string };

/** In stock, low (at or below its minimum), or out (nothing on the shelf). */
export function stockStatusOf(i: Pick<StockLite, "quantity" | "minimum_level">): StockStatus {
  if (i.quantity <= 0.0005) return "out";
  if (i.minimum_level > 0 && i.quantity <= i.minimum_level) return "low";
  return "in";
}

/** The four tiles: total, in stock, low, out. */
export function stockTiles(items: Pick<StockLite, "quantity" | "minimum_level">[]): { total: number; in: number; low: number; out: number } {
  const t = { total: items.length, in: 0, low: 0, out: 0 };
  for (const i of items) t[stockStatusOf(i)]++;
  return t;
}

/** Part numbers that are stand-ins, not real ones (123W, 5ZH2, NO NUMBER): 4 or fewer characters with a digit, or words. */
export function isPlaceholderStockNumber(pn: string | null | undefined): boolean {
  const t = String(pn ?? "").trim().toUpperCase();
  if (!t) return false;
  if (/^(NO NUMBER|N\/A|NA|TBC|NONE|-)$/.test(t)) return true;
  const compact = t.replace(/[\s-]/g, "");
  return compact.length <= 4 && /\d/.test(compact);
}

export type StockFilter = { q: string; status: StockStatus | "all" | "nomin" | "placeholder"; category: string; brand: string };

const norm = (s: string) => s.toLowerCase().replace(/[\s-]/g, "");

/** Search by name or part number (spaces and dashes ignored), then the status, category and brand filters. */
export function filterStock<T extends StockLite>(items: T[], f: StockFilter): T[] {
  const q = norm(f.q.trim());
  return items.filter((i) => {
    if (q && !norm(i.name).includes(q) && !norm(i.part_number ?? "").includes(q)) return false;
    if (f.status === "nomin" && i.minimum_level > 0) return false;
    if (f.status === "placeholder" && !isPlaceholderStockNumber(i.part_number)) return false;
    if ((f.status === "in" || f.status === "low" || f.status === "out") && stockStatusOf(i) !== f.status) return false;
    if (f.category && (i.category_id ?? "") !== f.category) return false;
    if (f.brand && (i.brand ?? "").toLowerCase() !== f.brand.toLowerCase()) return false;
    return true;
  });
}

export const STOCK_SORTS = ["name", "qty", "cost", "status", "category"] as const;
export type StockSort = (typeof STOCK_SORTS)[number];

/** Sort by a column, ascending or descending (cost only for those who see it). */
export function sortStock<T extends StockLite>(items: T[], sort: StockSort, desc: boolean, categoryName: (id: string | null | undefined) => string = () => ""): T[] {
  const rank: Record<StockStatus, number> = { out: 0, low: 1, in: 2 };
  const key = (i: T): string | number => (sort === "qty" ? i.quantity : sort === "cost" ? Number(i.unit_cost ?? 0) : sort === "status" ? rank[stockStatusOf(i)] : sort === "category" ? categoryName(i.category_id).toLowerCase() : i.name.toLowerCase());
  const out = [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
    return c !== 0 ? c : a.name.localeCompare(b.name);
  });
  return desc ? out.reverse() : out;
}

export const STOCK_PAGE_SIZE = 50;

/** One page of the list and the words "Showing 51–100 of 137". */
export function pageOf<T>(items: T[], page: number, size = STOCK_PAGE_SIZE): { rows: T[]; page: number; pages: number; words: string } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = items.slice((p - 1) * size, p * size);
  const words = items.length ? `Showing ${(p - 1) * size + 1}–${(p - 1) * size + rows.length} of ${items.length}` : "No items";
  return { rows, page: p, pages, words };
}

export type CountLine = { itemId: string; name: string; unit: string; systemQty: number; countedQty: number | null; notFound: boolean; unitCost: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Each counted line's difference and its value; items not found go to 0 (and are archived); the total change. */
export function countDifferences(lines: CountLine[]): { lines: (CountLine & { diff: number; value: number })[]; counted: number; notFound: number; totalValue: number; changed: number } {
  const out = lines
    .filter((l) => l.notFound || l.countedQty !== null)
    .map((l) => {
      const after = l.notFound ? 0 : Number(l.countedQty) || 0;
      const diff = r3(after - l.systemQty);
      return { ...l, diff, value: r2(diff * l.unitCost) };
    });
  return { lines: out, counted: out.length, notFound: out.filter((l) => l.notFound).length, totalValue: r2(out.reduce((a, l) => a + l.value, 0)), changed: out.filter((l) => Math.abs(l.diff) > 0.0005).length };
}

/** "OPENING COUNT 20 Nov 2026" (the first count), else "STOCK COUNT <date>". */
export function countLabel(day: string, opening: boolean): string {
  const d = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${opening ? "OPENING COUNT" : "STOCK COUNT"} ${d}`;
}

/** The words for a change in value ("+ AED 120.00" / "− AED 45.50"). */
export function valueWords(v: number): string {
  const a = Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v > 0.004 ? `+ AED ${a}` : v < -0.004 ? `− AED ${a}` : "AED 0.00";
}
