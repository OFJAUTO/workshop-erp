/**
 * Estimate back to the advisor (1 November 2026, E-00055). The advisor who started an estimate or quotation stays in
 * charge whoever edits or approves it; when the owner approves or edits one in someone else's charge it goes back to
 * that advisor with a short "what changed" line. Pure: the snapshot, the summary and the words. The server side is
 * src/lib/quote-lead.ts.
 */

export type HandbackKind = "approved" | "edited";

/** One line as it stood before the owner touched it. `key` matches the line it became (its id, or the line it was revised from). */
export type SnapLine = { key: string; type: string; title: string; qty: number; unitPrice: number | null; markup: number | null; markupMode: string | null; markupAed: number | null; hours: number | null; rate: number | null; total: number; counted: boolean };
export type Snapshot = { total: number; discount: number; from: "self" | "parent"; lines: SnapLine[] };

type LineLike = { id: string; revised_from_line_id?: string | null; line_type: string; title: string; quantity: number | string | null; unit_price: number | string | null; markup_percent: number | string | null; markup_mode?: string | null; markup_aed?: number | string | null; hours: number | string | null; labour_rate: number | string | null; line_total: number | string | null; chosen?: boolean | null; left_off?: boolean | null; is_active?: boolean | null; fee_kind?: string | null };

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** The lines as they stand, keyed by their own id (from = "self") or, for a new version, kept as the parent's lines. */
export function snapshotOf(lines: LineLike[], total: number | string | null, discount: number | string | null, from: "self" | "parent"): Snapshot {
  return {
    total: num(total) ?? 0,
    discount: num(discount) ?? 0,
    from,
    // The automatic hidden bank-charge line comes and goes with the figures: never "a line added" by anyone.
    lines: lines.filter((l) => l.is_active !== false && !l.fee_kind).map((l) => ({
      key: l.id,
      type: l.line_type,
      title: l.title,
      qty: num(l.quantity) ?? 0,
      unitPrice: num(l.unit_price),
      markup: num(l.markup_percent),
      markupMode: l.markup_mode ?? null,
      markupAed: num(l.markup_aed),
      hours: num(l.hours),
      rate: num(l.labour_rate),
      total: num(l.line_total) ?? 0,
      counted: l.chosen !== false && !l.left_off,
    })),
  };
}

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const differs = (a: number | null, b: number | null) => Math.abs((a ?? 0) - (b ?? 0)) > 0.005;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Markup changed on 2 parts, total 15,980.00 → 16,425.97": what the owner changed, counted per kind, then the total.
 * A new version's lines are matched to the parent's through revised_from_line_id.
 */
export function handbackSummary(before: Snapshot | null, after: Snapshot): string {
  const parts: string[] = [];
  if (before) {
    const keyOf = (l: SnapLine & { revisedFrom?: string | null }) => (before.from === "parent" ? (l.revisedFrom ?? "") : l.key);
    const old = new Map(before.lines.map((l) => [l.key, l]));
    const seen = new Set<string>();
    let markup = 0, rate = 0, hours = 0, price = 0, qty = 0, added = 0, offOn = 0, renamed = 0;
    for (const l of after.lines as (SnapLine & { revisedFrom?: string | null })[]) {
      const o = old.get(keyOf(l));
      if (!o) { added++; continue; }
      seen.add(o.key);
      if (o.counted !== l.counted) offOn++;
      if (o.title.trim().toUpperCase() !== l.title.trim().toUpperCase()) renamed++;
      if (l.type === "part" && (differs(o.markup, l.markup) || differs(o.markupAed, l.markupAed) || (o.markupMode ?? "percent") !== (l.markupMode ?? "percent"))) markup++;
      else if (l.type === "labour" && differs(o.rate, l.rate)) rate++;
      else if (l.type === "labour" && differs(o.hours, l.hours)) hours++;
      else if (differs(o.qty, l.qty)) qty++;
      else if (differs(o.total, l.total)) price++;
    }
    const removed = before.lines.filter((l) => !seen.has(l.key)).length;
    if (markup) parts.push(`Markup changed on ${plural(markup, "part", "parts")}`);
    if (rate) parts.push(`hourly rate changed on ${plural(rate, "line", "lines")}`);
    if (hours) parts.push(`hours changed on ${plural(hours, "line", "lines")}`);
    if (qty) parts.push(`quantity changed on ${plural(qty, "line", "lines")}`);
    if (price) parts.push(`price changed on ${plural(price, "line", "lines")}`);
    if (renamed) parts.push(`${plural(renamed, "line", "lines")} renamed`);
    if (offOn) parts.push(`${plural(offOn, "line", "lines")} left off or put back`);
    if (added) parts.push(`${plural(added, "line", "lines")} added`);
    if (removed) parts.push(`${plural(removed, "line", "lines")} removed`);
    if (differs(before.discount, after.discount)) parts.push(`discount ${money(before.discount)} → ${money(after.discount)}`);
  }
  const total = before && differs(before.total, after.total) ? `total ${money(before.total)} → ${money(after.total)}` : `total ${money(after.total)}${before ? " (unchanged)" : ""}`;
  if (!parts.length) return `${before ? "No line changes" : "Checked"}, ${total}`;
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return [first, ...parts.slice(1), total].join(", ");
}

/** Lines of the version as they stand, with the parent line each came from (to match a new version against its parent). */
export function afterOf(lines: LineLike[], total: number | string | null, discount: number | string | null): Snapshot {
  const s = snapshotOf(lines, total, discount, "self");
  const from = new Map(lines.map((l) => [l.id, l.revised_from_line_id ?? null]));
  return { ...s, lines: s.lines.map((l) => ({ ...l, revisedFrom: from.get(l.key) ?? null })) as SnapLine[] };
}

/** "Approved by Omar – ready to send" / "Edited by Omar – check and send". */
export function handbackWords(kind: HandbackKind, by: string): string {
  return kind === "approved" ? `Approved by ${by} – ready to send` : `Edited by ${by} – check and send`;
}

/** Does the handback still stand? Only while the version waits to be sent (draft); sending it ends it. */
export function handbackStands(q: { status: string; handed_back_at?: string | null }): boolean {
  return !!q.handed_back_at && q.status === "draft";
}
