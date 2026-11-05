/**
 * THE declined-work list on documents (5 November 2026, J-00970): what the customer declined, shown
 * as its OWN grouped section (Replace now → Replace → Advisory) on the invoice PDF's second page,
 * the customer's invoice page and the job card - never crammed into the note where forty lines
 * printed over the totals. Pure: the PDF, the pages and the tests all read these rules.
 */

export type DeclinedSeverity = "Replace now" | "Replace" | "Advisory";
export type DeclinedDocItem = { title: string; severity: DeclinedSeverity };
export type DeclinedGroup = { label: DeclinedSeverity; items: string[] };

export const DECLINED_MARKER = "Recommended work declined by the customer:";
export const DECLINED_HEADING = "RECOMMENDED WORK DECLINED BY THE CUSTOMER";

const SEVERITY_RANK: Record<string, number> = { "Replace now": 0, Replace: 1, Advisory: 2 };

/** Only real findings and parts go on the document: never labour lines, consumables, bare "Other"
 * lines or service packages (they are work SOLD, not recommendations). */
export function isDocItem(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/^labour\b/i.test(t) || /\blabour charges\b/i.test(t)) return false;
  if (/^consumables?\b/i.test(t)) return false;
  if (/^other\s*([-–·].*)?$/i.test(t)) return false;
  if (/\b(minor|major|intermediate)\s+service\b/i.test(t)) return false;
  if (/\bservice package\b/i.test(t)) return false;
  return true;
}

const keyOf = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");

/** Filter to real findings/parts, drop repeats (the worst severity wins), keep the first spelling. */
export function cleanDeclined(items: DeclinedDocItem[]): DeclinedDocItem[] {
  const out = new Map<string, DeclinedDocItem>();
  for (const i of items) {
    const title = (i.title ?? "").trim().replace(/\s+/g, " ");
    if (!isDocItem(title)) continue;
    const severity: DeclinedSeverity = SEVERITY_RANK[i.severity] !== undefined ? i.severity : "Advisory";
    const k = keyOf(title);
    const have = out.get(k);
    if (!have) out.set(k, { title, severity });
    else if (SEVERITY_RANK[severity] < SEVERITY_RANK[have.severity]) have.severity = severity;
  }
  return [...out.values()];
}

/** Replace now first, then Replace, then Advisory; items alphabetical inside each group. */
export function groupDeclined(items: DeclinedDocItem[]): DeclinedGroup[] {
  const clean = cleanDeclined(items);
  return (["Replace now", "Replace", "Advisory"] as const)
    .map((label) => ({ label, items: clean.filter((i) => i.severity === label).map((i) => i.title).sort((a, b) => a.localeCompare(b)) }))
    .filter((g) => g.items.length > 0);
}

export const declinedCount = (items: DeclinedDocItem[]) => cleanDeclined(items).length;

/** The one line on the invoice itself: "38 recommended items declined by the customer – listed on page 2". */
export function declinedSummary(n: number, where: "page 2" | "below"): string {
  return `${n} recommended item${n === 1 ? "" : "s"} declined by the customer – listed ${where === "below" ? "below" : "on page 2"}`;
}

/** An OLD invoice carries the whole list inside its note. This takes the block OUT (the rest of the
 * note survives) and reads the bullets as items, for invoices issued before the declined_work rows
 * can answer. "• FRONT BRAKE PADS – Replace" → { title, severity }. */
export function splitDeclinedNotes(notes: string | null | undefined): { rest: string | null; legacy: DeclinedDocItem[] } {
  const text = notes ?? "";
  const at = text.indexOf(DECLINED_MARKER);
  if (at === -1) return { rest: text.trim() || null, legacy: [] };
  const lines = text.slice(at + DECLINED_MARKER.length).split("\n");
  const legacy: DeclinedDocItem[] = [];
  let end = 0;
  for (const line of lines) {
    const m = line.match(/^\s*[•·-]\s*(.+?)\s*[–-]\s*(Replace now|Replace|Advisory)\s*$/i);
    if (m) {
      const sev = (["Replace now", "Replace", "Advisory"] as const).find((s) => s.toLowerCase() === m[2].toLowerCase()) ?? "Advisory";
      legacy.push({ title: m[1], severity: sev });
      end++;
    } else if (!line.trim() && end === 0) {
      end++; // a blank line straight after the marker
    } else break;
  }
  const rest = (text.slice(0, at) + lines.slice(end).join("\n")).trim();
  return { rest: rest || null, legacy };
}
