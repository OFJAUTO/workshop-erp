/**
 * Supplier price lists read into a car's parts list: a Mercedes B2BConnect spreadsheet, a Land Rover quotation
 * pasted from an email (tab-separated or one value per line), any table whose headings can be read, or a mapping
 * Parts set once for a supplier. Pure functions, shared by the server action and the check screen; nothing here
 * touches the database or the screen. Anything that cannot be read clearly is left blank, never guessed.
 */

export type ImportField = "partNumber" | "description" | "qty" | "list" | "net" | "total" | "availability" | "vin" | "ignore";
export type ColumnMapping = Partial<Record<ImportField, number>>;
export type ImportFormat = "b2bconnect" | "landrover" | "dealer" | "generic" | "mapped" | "unknown";

/**
 * The supplier's words on availability. "same_day": the supplier has it ("in stock", "available"), so it is ordered
 * today and here today; "days": a lead time; "back_order": on back order with the supplier; "confirm": unknown
 * ("will update"). Never a price.
 */
export type ImportAvailability = { kind: "same_day" | "days" | "back_order" | "confirm"; days: number | null; text: string };

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
  /** An amber note on the line (the sum does not divide back to the net each). */
  flag?: string | null;
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
  /** The dealer's customer id in the header ("P0000412"): the chosen supplier is remembered against it. */
  customerId?: string | null;
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

const TOTAL_LABELS = /^(gross amount|gross|sub ?total|subtotal|net aed|net amount|net total|total( aed)?|vat(\s*\d+(\.\d+)?\s*%)?|tax(\s*\d+(\.\d+)?\s*%)?|grand total|amount due|total due|total before vat|total incl\.? vat|total excl\.? vat)\s*:?$/i;

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

/**
 * The supplier's words for availability as our choice: "in stock" or "available" = same day, "1 day-1 psc" = 1 day,
 * "2 days" = 2 days, "back order" = back order, "will update" or anything unclear = unknown (Supplier to confirm).
 */
export function parseAvailability(s: string | null | undefined): ImportAvailability | null {
  const text = String(s ?? "").trim();
  if (!text) return null;
  const t = text.toLowerCase();
  if (/back ?order|b\/o\b|backorder/.test(t)) return { kind: "back_order", days: null, text };
  if (/in ?stock|ex[- ]?stock|available|avail\b|same day|immediate|ready|yes/.test(t)) return { kind: "same_day", days: null, text };
  if (/next day|tomorrow/.test(t)) return { kind: "days", days: 1, text };
  // "1 day", "1 day-1 psc", "2-3 days", "3 working days": the number of days (the last of a range).
  const m = t.match(/(\d+)\s*(?:-\s*(\d+)\s*)?(?:working\s*|business\s*)?(day|days|d|wd)\b/);
  if (m) return { kind: "days", days: Number(m[2] ?? m[1]), text };
  const w = t.match(/(\d+)\s*(week|weeks|wk|wks)\b/);
  if (w) return { kind: "days", days: Number(w[1]) * 7, text };
  return { kind: "confirm", days: null, text };
}

/**
 * The words for an imported availability that is not a date: a plain number is the supplier's stock ("Supplier stock:
 * 653"; a negative figure means none, "Out of stock"); "back order" stays; anything else is for the supplier to confirm.
 */
export function importAvailabilityNote(a: ImportAvailability | null): string | null {
  if (!a) return null;
  if (a.kind === "back_order") return "Back order at the supplier";
  if (a.kind !== "confirm") return null;
  const t = (a.text ?? "").trim();
  const n = /^[-+]?\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
  if (n !== null) return n < 0 ? "Out of stock" : `Supplier stock: ${n}`;
  return `Supplier to confirm${t && !/will update|tbc|tba/i.test(t) ? ` (${t.slice(0, 60)})` : ""}`;
}

/** A part number with every space and dash taken out, for matching: "A 167 330 68 00" and "A1673306800" are the same part. */
export function compactPartNumber(s: string | null | undefined): string {
  return String(s ?? "").replace(/[\s\-._/]/g, "").toUpperCase();
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
    // A page footer, a title or a stray word has no quantity and no price: not a part line.
    if (qty === null && list === null && net === null && total === null && !(partNumber && description)) return;
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
  const vat = pick(/^(vat|tax)(\s*\d+(\.\d+)?\s*%)?$/i);
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
  let headings = clean[headerIdx];
  let body = clean.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ""));
  let mapping = mapHeadings(headings);
  if (Object.keys(mapping).length === 0) {
    // No heading row at all (values only): every row is data and the columns are named by number for the mapping step.
    headings = headings.map((_, i) => `Column ${i + 1}`);
    body = clean.slice(headerIdx).filter((r) => r.some((c) => c !== ""));
  }
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
 * Text pasted from an email or copied from a spreadsheet. Tab-separated lines are a table at once (blank lines
 * ignored). Otherwise the one-value-per-line layout, as Outlook or Gmail give it as plain text: the headings first,
 * then the values in groups of the heading count, blank lines anywhere ignored, and the totals at the bottom
 * ("Gross Amount", "Vat", "Net AED"...) each followed by its value, which are never parts.
 */
export function parsePaste(text: string, valuesPerRow: number | null = null): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const tabbed = lines.filter((l) => l.includes("\t")).length;
  if (tabbed >= 2) return lines.filter((l) => l.trim() !== "").map((l) => l.split("\t").map((c) => c.trim()));
  // A table drawn with several spaces between the columns (an email in a fixed font).
  const spaced = lines.filter((l) => /\S\s{2,}\S/.test(l)).length;
  if (spaced >= 2 && spaced >= lines.filter((l) => l.trim()).length / 2) return lines.filter((l) => l.trim() !== "").map((l) => l.trim().split(/\s{2,}/).map((c) => c.trim()));
  return oneValuePerLine(lines, valuesPerRow);
}

/** How many values make one part line in a one-value-per-line paste: the heading run, else the repeating pattern of numbers and words. */
export function guessValuesPerRow(text: string): number | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  let count = 0;
  while (count < lines.length && parseNumber(lines[count]) === null && isHeadingWord(lines[count])) count++;
  if (count >= 2) return count;
  // No heading run: the period after which the shape (number or text) of the lines repeats.
  const body = lines.filter((l) => !TOTAL_LABELS.test(l));
  const shape = body.map((l) => (parseNumber(l) !== null ? "n" : "t")).join("");
  for (let n = 3; n <= 12; n++) {
    if (body.length < n * 2) break;
    let ok = 0;
    let total = 0;
    for (let i = 0; i + n < shape.length; i++) {
      total++;
      if (shape[i] === shape[i + n]) ok++;
    }
    if (total && ok / total >= 0.9) return n;
  }
  return null;
}

function oneValuePerLine(lines: string[], valuesPerRow: number | null): string[][] {
  // Blank lines (Outlook and Gmail put one between every value) are nothing.
  const trimmed = lines.map((l) => l.trim()).filter((l) => l !== "");
  let count = 0;
  while (count < trimmed.length && parseNumber(trimmed[count]) === null && isHeadingWord(trimmed[count])) count++;
  const hasHeadings = count >= 2;
  const per = hasHeadings ? count : (valuesPerRow ?? guessValuesPerRow(trimmed.join("\n")));
  if (!per || per < 2) {
    // Nothing to go on: every line becomes a row of one cell; the mapping step asks how many values make a part.
    return trimmed.map((l) => [l]);
  }
  const rows: string[][] = hasHeadings ? [trimmed.slice(0, count)] : [];
  let i = hasHeadings ? count : 0;
  let group: string[] = [];
  while (i < trimmed.length) {
    const l = trimmed[i];
    // A totals label ends the part lines; its value is on the same line or the next.
    if (TOTAL_LABELS.test(l) || /^(gross amount|vat|net aed|sub ?total|grand total|total)\b/i.test(l) && parseNumber(trimmed[i + 1] ?? "") !== null && group.length === 0) {
      if (group.length) rows.push(group);
      group = [];
      const inline = l.match(/^(.*?)[\s:]+([-\d.,]+)$/);
      if (inline && parseNumber(inline[2]) !== null && TOTAL_LABELS.test(inline[1].trim())) {
        rows.push([inline[1].trim(), inline[2]]);
        i += 1;
      } else {
        rows.push([l.replace(/:$/, ""), trimmed[i + 1] ?? ""]);
        i += 2;
      }
      continue;
    }
    group.push(l);
    if (group.length === per) {
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
  return (Object.keys(SYNONYMS) as (keyof typeof SYNONYMS)[]).some((f) => SYNONYMS[f].some((syn) => n === syn || n.startsWith(syn + " ") || n.startsWith(syn + "("))) || /^(wip ?no|wipno|line ?no|lineno|sr ?no|s ?no|#|no|ref|remarks?|notes?|currency|brand|make|model|uom|unit)$/.test(n);
}

/**
 * A first guess at the columns of a table with no usable headings, from the data itself: part numbers are codes
 * with digits, the name is the longest text, quantities are small whole numbers, the price has decimals, and the
 * availability column holds the supplier's words. Parts change any of it with one tap.
 */
export function guessMappingFromData(rows: string[][]): ColumnMapping {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width) return {};
  const cols = Array.from({ length: width }, (_, i) => rows.map((r) => String(r[i] ?? "").trim()).filter(Boolean));
  const share = (vals: string[], test: (v: string) => boolean) => (vals.length ? vals.filter(test).length / vals.length : 0);
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  const pick = (field: Exclude<ImportField, "ignore">, score: (vals: string[], i: number) => number, min = 0.5) => {
    let best = -1;
    let bestScore = 0;
    cols.forEach((vals, i) => {
      if (taken.has(i) || !vals.length) return;
      const s = score(vals, i);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (best >= 0 && bestScore >= min) { mapping[field] = best; taken.add(best); }
  };
  pick("availability", (v) => share(v, (x) => parseAvailability(x) !== null && parseNumber(x) === null && /stock|avail|day|week|order|update|tbc|confirm/i.test(x)));
  // A code: letters and digits with at least one digit, no word of three letters or more ("LR123456", "A 167 330 68 00", "X1").
  pick("partNumber", (v) => share(v, (x) => /^[A-Z0-9][A-Z0-9 .\-/]*$/i.test(x) && /\d/.test(x) && !/[A-Z]{3,}/i.test(x) && parseNumber(x) === null));
  pick("net", (v) => share(v, (x) => parseNumber(x) !== null && /[.,]\d{2}$/.test(x)) * (1 + v.reduce((a, x) => a + (parseNumber(x) ?? 0), 0) / 1e9));
  pick("qty", (v) => share(v, (x) => { const n = parseNumber(x); return n !== null && Number.isInteger(n) && n >= 1 && n <= 500; }));
  pick("description", (v) => share(v, (x) => /[a-z]{3,}/i.test(x) && parseNumber(x) === null) * (1 + v.reduce((a, x) => a + x.length, 0) / 1e6));
  return mapping;
}

/** The six meanings the mapping screen offers, in its order. */
export const MAPPING_CHOICES: { field: ImportField; label: string }[] = [
  { field: "partNumber", label: "Part number" },
  { field: "description", label: "Name" },
  { field: "qty", label: "Qty" },
  { field: "net", label: "Price" },
  { field: "availability", label: "Availability" },
  { field: "ignore", label: "Ignore" },
];

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
    const wanted = compactPartNumber(line.partNumber);
    const same = targets.find((t) => t.partNumber && compactPartNumber(t.partNumber) === wanted);
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

/* ------------------------------------------------------------------------------------------------
   Dealer block PDFs (the Mercedes Deira layout and friends): each part is a BLOCK - the name
   (sometimes wrapped with a hyphen) and the part number stacked in one column, "List price /
   Discount (x %) / Net price" as three label rows beside it, the quantity and the line sum on the
   block's first row. Parsed from the PDF's own line positions (src/lib/pdf-read.ts hands them in),
   so the part number never lands inside the name and the net each is really the net each.
   ------------------------------------------------------------------------------------------------ */

export type PosLine = { x: number; y: number; text: string };

/** "A 177 200 04 00 28" and friends: an optional letter prefix and at least four groups of digits. */
const DEALER_PART_RE = /^[A-Z]{0,3}[\s-]?(?:\d{2,4}[\s-]){3,6}\d{2,4}$/;
const VIN_IN_TEXT = /\b[A-HJ-NPR-Z0-9]{17}\b/;

export function parseDealerBlocks(pages: PosLine[][]): ImportResult | null {
  const all = pages.flat();
  const netLabels = all.filter((l) => /^net price$/i.test(l.text.trim()));
  if (!netLabels.length) return null;
  const labelX = netLabels.map((l) => l.x).sort((a, b) => a - b)[Math.floor(netLabels.length / 2)];
  const lines: ImportLine[] = [];
  const found: { label: string; value: number }[] = [];
  const warnings: string[] = [];
  let vin: string | null = null;
  let customerId: string | null = null;
  let supplierHint: string | null = null;
  const money = (t: string | undefined | null) => { const v = parseNumber(String(t ?? "").replace(/AED/i, "").replace(/−/g, "-").trim()); return v === null ? null : Math.abs(v); };
  for (const page of pages) {
    const sorted = page.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text).sort((a, b) => a.y - b.y || a.x - b.x);
    // The header: the VIN, the branch line and the customer id.
    for (const l of sorted) {
      if (!vin) { const m = l.text.match(VIN_IN_TEXT); if (m && !DEALER_PART_RE.test(l.text)) vin = m[0].toUpperCase(); }
      const cid = /customer id:?\s*([A-Z0-9-]{3,20})/i.exec(l.text);
      if (cid) customerId = cid[1];
      if (!supplierHint && /branch/i.test(l.text)) supplierHint = l.text.replace(/\s*-\s*$/, "").trim();
    }
    // Item anchors: the position numbers in the leftmost column; the totals block bounds the last item.
    const ints = sorted.filter((l) => /^\d{1,3}$/.test(l.text) && l.x < labelX - 100);
    if (!ints.length) continue;
    const leftX = Math.min(...ints.map((l) => l.x));
    const anchors = ints.filter((l) => Math.abs(l.x - leftX) <= 10);
    const totalsY = Math.min(...sorted.filter((l) => /^(sum of list prices|total net price)$/i.test(l.text)).map((l) => l.y), Infinity);
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.y >= totalsY) continue;
      const endY = Math.min(anchors[i + 1]?.y ?? Infinity, totalsY);
      const block = sorted.filter((l) => l.y >= a.y - 8 && l.y < endY - 8 && l !== a);
      // The name column sits between the position and the price labels; the part number is its own line.
      let name = "";
      let partNumber: string | null = null;
      for (const l of block.filter((b) => b.x > leftX + 12 && b.x < labelX - 35).sort((p, q) => p.y - q.y)) {
        if (/^\d{1,3}$/.test(l.text)) continue; // the DG column
        if (!partNumber && DEALER_PART_RE.test(l.text)) { partNumber = l.text; continue; }
        if (partNumber) continue; // small print under the part number
        name = name.endsWith("-") ? name.slice(0, -1) + l.text : name ? `${name} ${l.text}` : l.text;
      }
      // The three price rows: each value on the same line as its label, left of the quantity column.
      const rowOf = (re: RegExp) => {
        const label = block.find((b) => Math.abs(b.x - labelX) <= 12 && re.test(b.text));
        if (!label) return { v: null as number | null, label: null as string | null };
        const val = block.filter((b) => Math.abs(b.y - label.y) <= 4 && b.x > labelX + 30 && b.x < labelX + 140).sort((p, q) => p.x - q.x).at(-1);
        return { v: money(val?.text), label: label.text };
      };
      const list = rowOf(/^list price$/i).v;
      const disc = rowOf(/^discount/i);
      const net = rowOf(/^net price$/i).v;
      const discount = disc.label ? Number(/\((\d+(?:\.\d+)?)\s*%\)/.exec(disc.label)?.[1]) || null : null;
      // The block's first row: the quantity and the line sum.
      const base = block.filter((b) => Math.abs(b.y - a.y) <= 5 && b.x > labelX + 140);
      const qty = parseQty(base.find((b) => /^\d{1,4}$/.test(b.text))?.text ?? null);
      const total = money(base.filter((b) => /\d/.test(b.text) && !/^\d{1,4}$/.test(b.text)).sort((p, q) => p.x - q.x).at(-1)?.text);
      if (!name && !partNumber) continue;
      const line: ImportLine = { key: `d${lines.length + 1}`, partNumber, description: name || null, qty, list, net, discount: discount ?? (list && net ? Math.round((1 - net / list) * 1000) / 10 : null), total, availability: null, vin: null, raw: [a.text, name, partNumber ?? "", String(qty ?? ""), String(list ?? ""), String(net ?? "")], flag: null };
      if (net !== null && qty && total !== null && Math.abs(net * qty - total) > 0.02) line.flag = `The line sum ${total.toFixed(2)} ÷ ${qty} does not give the net each ${net.toFixed(2)} - check this line`;
      lines.push(line);
    }
    // The totals under the last item ("Total net price" is the one the lines must add up to).
    for (const lab of sorted.filter((l) => l.y >= totalsY - 2 && /^(sum of list prices|discount|total net price|vat\s*\(?\d+(?:\.\d+)?\s*%\)?|total)$/i.test(l.text))) {
      const val = sorted.filter((l) => Math.abs(l.y - lab.y) <= 4 && l.x > lab.x + 40).sort((p, q) => p.x - q.x).at(-1);
      const v = money(val?.text);
      if (v === null) continue;
      found.push({ label: lab.text.replace(/[()]/g, "").replace(/\s+/g, " ").replace(/^total net price$/i, "Total before VAT").trim(), value: v });
    }
  }
  if (!lines.length) return null;
  return { format: "dealer", supplierHint, customerId, headings: ["Pos", "Part", "Part number", "Qty", "List", "Net each"], rows: lines.map((l) => l.raw), mapping: {}, lines, totals: checkTotals(lines, found), vin, warnings };
}
