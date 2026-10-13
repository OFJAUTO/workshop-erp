/**
 * Supplier price lists read into a car's parts list: a Mercedes B2BConnect spreadsheet, a Land Rover quotation
 * pasted from an email (tab-separated or one value per line), any table whose headings can be read, or a mapping
 * Parts set once for a supplier. Pure functions, shared by the server action and the check screen; nothing here
 * touches the database or the screen. Anything that cannot be read clearly is left blank, never guessed.
 */

export type ImportField = "partNumber" | "description" | "qty" | "list" | "net" | "total" | "availability" | "vin" | "ignore";
export type ColumnMapping = Partial<Record<ImportField, number>>;
export type ImportFormat = "b2bconnect" | "landrover" | "generic" | "mapped" | "unknown";

export type ImportAvailability = { kind: "in_stock" | "days" | "confirm"; days: number | null; text: string };

export type ImportLine = {
  key: string;
  partNumber: string | null;
  description: string | null;
  qty: number | null;
  list: number | null;
  net: number | null;
  /** 1 - net / list, in percent, when both are known. */
  discount: number | null;
  /** The line's total as written in the source, when there is one. */
  total: number | null;
  availability: ImportAvailability | null;
  vin: string | null;
  raw: string[];
};

export type ImportTotals = {
  /** Every labelled total found in the source: "Gross Amount" 11853, "Vat" 592.65, "Net AED" 12445.65. */
  found: { label: string; value: number }[];
  /** The lines added up: net × qty, or the line totals when the source has them. */
  sumLines: number | null;
  /** The total before VAT the lines should add up to, when the source has one. */
  expected: number | null;
  /** True when the lines add up, false when they do not, null when the source has no total to check against. */
  match: boolean | null;
};

export type ImportResult = {
  format: ImportFormat;
  /** The supplier the format points at ("Gargash" for B2BConnect dealer files), to pre-select. */
  supplierHint: string | null;
  headings: string[];
  rows: string[][];
  mapping: ColumnMapping;
  lines: ImportLine[];
  totals: ImportTotals;
  /** The VIN in the file, when there is one, to compare with the car. */
  vin: string | null;
  warnings: string[];
};

// Headings recognised for each field, matched as whole words, case-insensitive, "*" and punctuation ignored.
const SYNONYMS: Record<Exclude<ImportField, "ignore">, string[]> = {
  partNumber: ["part number", "part no", "partno", "part", "product", "product code", "item code", "item no", "article", "code", "sku", "oem", "oem no", "ref", "reference", "material"],
  description: ["description", "designation", "desc", "name", "item description", "item", "details", "part name", "part description"],
  qty: ["quantity", "qty", "q'ty", "pcs", "units", "nos"],
  list: ["list price", "list", "mrp", "retail", "rrp", "retail price", "gross price", "unit list"],
  net: ["net price", "net", "unit price", "unit price(aed)", "unit price aed", "price", "cost", "net aed", "net amount", "unit cost", "rate", "unit net"],
  total: ["total price", "total", "amount", "line total", "ext price", "extended", "total aed", "value"],
  availability: ["availability", "avail", "stock", "eta", "delivery", "lead time", "status", "available"],
  vin: ["vin", "chassis", "chassis no", "vin number"],
};

const TOTAL_LABELS = /^(gross amount|gross|sub ?total|subtotal|net aed|net amount|net total|total( aed)?|vat|tax|grand total|amount due|total due|total before vat|total incl\.? vat|total excl\.? vat)\s*:?$/i;

export function normaliseHeading(h: string): string {
  return h.replace(/\*/g, "").replace(/[_\-:.]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** "A   167 330 68 00" → "A 167 330 68 00"; runs of spaces collapse to one, case is upper. */
export function normalisePartNumber(s: string | null | undefined): string | null {
  const t = String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  return t ? t : null;
}

/** "5,489.00" → 5489; "AED 1.234,50" (European) → 1234.5; blank, words or two numbers → null. Never a guess. */
export function parseNumber(s: string | number | null | undefined): number | null {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  let t = String(s ?? "").trim();
  if (!t) return null;
  t = t.replace(/aed|dhs?|usd|\$|€|£/gi, "").replace(/\s+/g, "");
  if (!/^[-+]?[\d.,]+%?$/.test(t)) return null;
  t = t.replace(/%$/, "");
  const commas = (t.match(/,/g) ?? []).length;
  const dots = (t.match(/\./g) ?? []).length;
  if (commas && dots) {
    // Whichever comes last is the decimal mark.
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (commas) {
    // "1,250" is a thousand; "12,5" is a decimal.
    const after = t.split(",").pop() ?? "";
    t = commas === 1 && after.length !== 3 ? t.replace(",", ".") : t.replace(/,/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseQty(s: string | null | undefined): number | null {
  const n = parseNumber(s);
  return n !== null && n > 0 ? n : null;
}

/** The supplier's words for availability as our choice: In stock, n days, or "Supplier to confirm". */
export function parseAvailability(s: string | null | undefined): ImportAvailability | null {
  const text = String(s ?? "").trim();
  if (!text) return null;
  const t = text.toLowerCase();
  if (/in ?stock|ex[- ]?stock|available now|^available$|same day|immediate|ready/.test(t)) return { kind: "in_stock", days: null, text };
  if (/next day|tomorrow/.test(t)) return { kind: "days", days: 1, text };
  const m = t.match(/(\d+)\s*(?:-\s*(\d+)\s*)?(?:working\s*|business\s*)?(day|days|d|wd)\b/);
  if (m) return { kind: "days", days: Number(m[2] ?? m[1]), text };
  const w = t.match(/(\d+)\s*(week|weeks|wk|wks)\b/);
  if (w) return { kind: "days", days: Number(w[1]) * 7, text };
  return { kind: "confirm", days: null, text };
}

/** Which of our fields each heading is, by its words. Unknown headings are left out (ignored). */
export function mapHeadings(headings: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<ImportField>();
  const norm = headings.map(normaliseHeading);
  // Exact matches first, then headings that contain a synonym, so "Net Price" never steals "Total Price".
  for (const pass of ["exact", "contains"] as const) {
    norm.forEach((h, i) => {
      if (!h || Object.values(mapping).includes(i)) return;
      for (const field of Object.keys(SYNONYMS) as (keyof typeof SYNONYMS)[]) {
        if (taken.has(field)) continue;
        const hit = SYNONYMS[field].some((syn) => (pass === "exact" ? h === syn : new RegExp(`(^|\\s)${syn.replace(/[()]/g, "\\$&").replace(/'/g, "'")}(\\s|$|\\()`).test(h)));
        if (hit) {
          mapping[field] = i;
          taken.add(field);
          break;
        }
      }
    });
  }
  return mapping;
}

export function detectFormat(headings: string[], mapping: ColumnMapping): ImportFormat {
  const n = headings.map(normaliseHeading);
  const has = (...words: string[]) => words.every((w) => n.some((h) => h === w || h.startsWith(w)));
  if (has("part", "quantity", "designation", "net price")) return "b2bconnect";
  if (has("product", "unit price") && n.some((h) => h.startsWith("availability"))) return "landrover";
  const fields = Object.keys(mapping).filter((k) => k !== "ignore").length;
  return fields >= 2 && (mapping.partNumber !== undefined || mapping.description !== undefined) && (mapping.net !== undefined || mapping.list !== undefined) ? "generic" : "unknown";
}

function cell(row: string[], i: number | undefined): string {
  return i === undefined ? "" : String(row[i] ?? "").trim();
}

/** A row that is a labelled total ("Gross Amount  11,853.00") rather than a part. */
function totalOfRow(row: string[]): { label: string; value: number } | null {
  const cells = row.map((c) => String(c ?? "").trim()).filter((c) => c !== "");
  if (cells.length < 2 || cells.length > 3) return null;
  const label = cells.find((c) => TOTAL_LABELS.test(c));
  if (!label) return null;
  const value = cells.filter((c) => c !== label).map(parseNumber).find((n) => n !== null);
  return value === undefined || value === null ? null : { label: label.replace(/:$/, ""), value };
}

/** Rows into lines through a mapping. Rows with no part number and no description are skipped; totals rows are collected. */
export function linesFromRows(rows: string[][], mapping: ColumnMapping, keyPrefix = "r"): { lines: ImportLine[]; found: { label: string; value: number }[]; vin: string | null } {
  const lines: ImportLine[] = [];
  const found: { label: string; value: number }[] = [];
  let vin: string | null = null;
  rows.forEach((row, idx) => {
    const t = totalOfRow(row);
    if (t) {
      found.push(t);
      return;
    }
    const partNumber = normalisePartNumber(cell(row, mapping.partNumber));
    const description = cell(row, mapping.description) || null;
    if (!partNumber && !description) return;
    // A repeated heading row inside the data (a second page) is not a part.
    if (mapping.partNumber !== undefined && normaliseHeading(cell(row, mapping.partNumber)) === "part") return;
    const list = parseNumber(cell(row, mapping.list));
    const net = parseNumber(cell(row, mapping.net));
    const qty = parseQty(cell(row, mapping.qty));
    const total = parseNumber(cell(row, mapping.total));
    const rowVin = cell(row, mapping.vin).replace(/\s+/g, "").toUpperCase() || null;
    if (rowVin && rowVin.length >= 11) vin = vin ?? rowVin;
    const discount = list && net !== null && list > 0 ? Math.round((1 - net / list) * 10000) / 100 : null;
    lines.push({
      key: `${keyPrefix}${idx}`,
      partNumber,
      description: description ? description.replace(/\s+/g, " ") : null,
      qty,
      list,
      net,
      discount: discount !== null && discount >= 0 && discount <= 100 ? discount : null,
      total,
      availability: parseAvailability(cell(row, mapping.availability)),
      vin: rowVin,
      raw: row.map((c) => String(c ?? "")),
    });
  });
  return { lines, found, vin };
}

/** The cross-check: the lines added up against the total before VAT the source states. */
export function checkTotals(lines: ImportLine[], found: { label: string; value: number }[]): ImportTotals {
  const lineValue = (l: ImportLine) => (l.total !== null ? l.total : l.net !== null ? l.net * (l.qty ?? 1) : null);
  const values = lines.map(lineValue);
  const sumLines = values.length && values.every((v) => v !== null) ? Math.round(values.reduce((a, b) => a + (b ?? 0), 0) * 100) / 100 : null;
  // The total before VAT: "Gross Amount" (Land Rover), "Subtotal", "Total before VAT", "Net amount"; else a plain "Total" when there is no VAT line.
  const pick = (re: RegExp) => found.find((f) => re.test(f.label))?.value ?? null;
  const vat = pick(/^(vat|tax)$/i);
  let expected = pick(/^(gross amount|gross|sub ?total|subtotal|total before vat|total excl\.? vat|net amount|net total)$/i);
  if (expected === null) {
    const total = pick(/^(total( aed)?|grand total|amount due|total due|net aed)$/i);
    if (total !== null) expected = vat !== null ? Math.round((total - vat) * 100) / 100 : total;
  }
  const match = sumLines === null || expected === null ? null : Math.abs(sumLines - expected) <= Math.max(0.05, 0.01 * lines.length);
  return { found, sumLines, expected, match };
}

/** A spreadsheet's rows (every cell as text) into an import result. The heading row is the first row with at least three known headings. */
export function readTable(rows: string[][], opts: { supplierHint?: string | null; savedMapping?: { headings: string[]; mapping: ColumnMapping } | null } = {}): ImportResult {
  const warnings: string[] = [];
  const clean = rows.map((r) => r.map((c) => String(c ?? "").replace(/\u00a0/g, " ").trim()));
  let headerIdx = clean.findIndex((r) => Object.keys(mapHeadings(r)).length >= 3);
  if (headerIdx === -1) headerIdx = clean.findIndex((r) => r.filter((c) => c !== "").length >= 3);
  if (headerIdx === -1) return { format: "unknown", supplierHint: opts.supplierHint ?? null, headings: [], rows: clean, mapping: {}, lines: [], totals: { found: [], sumLines: null, expected: null, match: null }, vin: null, warnings: ["Nothing that looks like a table was found."] };
  const headings = clean[headerIdx];
  const body = clean.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ""));
  let mapping = mapHeadings(headings);
  let format = detectFormat(headings, mapping);
  if (format === "unknown" && opts.savedMapping && sameHeadings(opts.savedMapping.headings, headings)) {
    mapping = opts.savedMapping.mapping;
    format = "mapped";
  }
  if (format === "b2bconnect") {
    // Part*, Quantity*, VIN, Designation, Discount Group, List Price, Net Price, Total Price, Currency, Dealer Id, Dealer Name, Customer Id.
    const col = (name: string) => headings.findIndex((h) => normaliseHeading(h) === name);
    mapping = { partNumber: col("part"), qty: col("quantity"), vin: col("vin"), description: col("designation"), list: col("list price"), net: col("net price"), total: col("total price") };
    for (const k of Object.keys(mapping) as ImportField[]) if (mapping[k] === -1) delete mapping[k];
  }
  const { lines, found, vin } = linesFromRows(body, mapping);
  const dealer = format === "b2bconnect" ? body.map((r) => cell(r, headings.findIndex((h) => normaliseHeading(h) === "dealer name"))).find(Boolean) ?? null : null;
  const totals = checkTotals(lines, found);
  if (format === "unknown") warnings.push("This file's columns were not recognised. Tell me which column is which.");
  if (lines.length === 0 && format !== "unknown") warnings.push("No part lines were found under the headings.");
  const dupes = duplicates(lines);
  if (dupes.length) warnings.push(`The same part number appears more than once: ${dupes.join(", ")}.`);
  return { format, supplierHint: opts.supplierHint ?? (dealer ? dealer : format === "b2bconnect" ? "Gargash" : null), headings, rows: body, mapping, lines, totals, vin, warnings };
}

function sameHeadings(a: string[], b: string[]) {
  const na = a.map(normaliseHeading).filter(Boolean);
  const nb = b.map(normaliseHeading).filter(Boolean);
  return na.length === nb.length && na.every((h, i) => h === nb[i]);
}

function duplicates(lines: ImportLine[]): string[] {
  const seen = new Map<string, number>();
  for (const l of lines) if (l.partNumber) seen.set(l.partNumber, (seen.get(l.partNumber) ?? 0) + 1);
  return Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k);
}

/**
 * Text pasted from an email or copied from a spreadsheet. Tab-separated lines are a table at once. Otherwise the
 * one-value-per-line layout: the headings first, then the values in groups of the heading count, then lines of
 * spaces, then "Gross Amount", "Vat", "Net AED" each followed by its value.
 */
export function parsePaste(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const tabbed = lines.filter((l) => l.includes("\t")).length;
  if (tabbed >= 2) return lines.filter((l) => l.trim() !== "").map((l) => l.split("\t").map((c) => c.trim()));
  // A table drawn with several spaces between the columns (an email in a fixed font).
  const spaced = lines.filter((l) => /\S\s{2,}\S/.test(l)).length;
  if (spaced >= 2 && spaced >= lines.filter((l) => l.trim()).length / 2) return lines.filter((l) => l.trim() !== "").map((l) => l.trim().split(/\s{2,}/).map((c) => c.trim()));
  return oneValuePerLine(lines);
}

function oneValuePerLine(lines: string[]): string[][] {
  const trimmed = lines.map((l) => l.trim());
  // Headings: the leading run of lines that read as headings, none of them a number.
  let count = 0;
  while (count < trimmed.length && trimmed[count] !== "" && parseNumber(trimmed[count]) === null && isHeadingWord(trimmed[count])) count++;
  if (count < 2) {
    // No heading run: every line becomes a row of one cell; the mapping step sorts it out.
    return trimmed.filter(Boolean).map((l) => [l]);
  }
  const headings = trimmed.slice(0, count);
  const rows: string[][] = [headings];
  let i = count;
  let group: string[] = [];
  while (i < trimmed.length) {
    const l = trimmed[i];
    // A blank line, or a totals label, ends the part lines.
    if (l === "" || TOTAL_LABELS.test(l)) {
      if (group.length) rows.push(group);
      group = [];
      if (TOTAL_LABELS.test(l)) {
        const value = trimmed[i + 1] ?? "";
        rows.push([l, value]);
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    group.push(l);
    if (group.length === count) {
      rows.push(group);
      group = [];
    }
    i++;
  }
  if (group.length) rows.push(group);
  return rows;
}

function isHeadingWord(s: string): boolean {
  const n = normaliseHeading(s);
  if (!n || n.length > 40) return false;
  return (Object.keys(SYNONYMS) as (keyof typeof SYNONYMS)[]).some((f) => SYNONYMS[f].some((syn) => n === syn || n.startsWith(syn + " ") || n.startsWith(syn + "("))) || /^(wip ?no|line ?no|sr ?no|s ?no|#|no|ref|remarks?|notes?|currency|brand|make|model|uom|unit)$/.test(n);
}

/** Letters and digits only; a name is close to another when most of its two-letter pairs are shared. */
export function nameSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const out = new Map<string, number>();
    for (const word of t.split(" ")) {
      const w = ` ${word} `;
      for (let i = 0; i < w.length - 1; i++) {
        const g = w.slice(i, i + 2);
        out.set(g, (out.get(g) ?? 0) + 1);
      }
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  let total = 0;
  for (const [g, n] of ga) {
    total += n;
    shared += Math.min(n, gb.get(g) ?? 0);
  }
  for (const n of gb.values()) total += n;
  return total ? (2 * shared) / total : 0;
}

export type MatchTarget = { id: string; name: string; original: string | null; partNumber: string | null };

/** The best row on the car's list for an imported line: the same part number first, else the closest name. */
export function suggestMatch(line: ImportLine, targets: MatchTarget[]): { id: string; by: "number" | "name"; score: number } | null {
  if (line.partNumber) {
    const same = targets.find((t) => normalisePartNumber(t.partNumber) === line.partNumber);
    if (same) return { id: same.id, by: "number", score: 1 };
  }
  if (!line.description) return null;
  let best: { id: string; score: number } | null = null;
  for (const t of targets) {
    const score = Math.max(nameSimilarity(line.description, t.name), t.original ? nameSimilarity(line.description, t.original) : 0);
    if (!best || score > best.score) best = { id: t.id, score };
  }
  return best && best.score >= 0.5 ? { ...best, by: "name" } : null;
}

/**
 * Matches for a whole import: each row on the car's list is suggested to one line only (the same part number
 * first, then the closest names in order of likeness), so two lines can never land on the same part by accident.
 */
export function suggestMatches(lines: ImportLine[], targets: MatchTarget[]): Map<string, { id: string; by: "number" | "name"; score: number } | null> {
  const out = new Map<string, { id: string; by: "number" | "name"; score: number } | null>();
  const used = new Set<string>();
  const first = lines.map((l) => ({ key: l.key, s: suggestMatch(l, targets) })).sort((a, b) => (b.s?.by === "number" ? 1 : 0) - (a.s?.by === "number" ? 1 : 0) || (b.s?.score ?? 0) - (a.s?.score ?? 0));
  for (const { key, s } of first) {
    if (s && !used.has(s.id)) {
      used.add(s.id);
      out.set(key, s);
    } else if (s) {
      // The best row is taken: the next closest free name, if any is close enough.
      const line = lines.find((l) => l.key === key)!;
      const free = targets.filter((t) => !used.has(t.id));
      const alt = suggestMatch(line, free);
      if (alt && alt.by === "name") {
        used.add(alt.id);
        out.set(key, alt);
      } else out.set(key, null);
    } else out.set(key, null);
  }
  return out;
}

/** One imported line as it goes to Apply: where it lands on the car's list, and the figures to write. */
export type ApplyTarget = { partId: string | null; requestId: string | null } | "new" | "skip";
export type ApplyLine = {
  key: string;
  target: ApplyTarget;
  name: string;
  partNumber: string | null;
  qty: number | null;
  list: number | null;
  discount: number | null;
  net: number | null;
  availability: ImportAvailability | null;
};

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  partNumber: "Part number",
  description: "Description",
  qty: "Quantity",
  list: "List price",
  net: "Net price",
  total: "Line total",
  availability: "Availability",
  vin: "VIN",
  ignore: "Ignore",
};
