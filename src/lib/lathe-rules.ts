/*
 * OUTSOURCED LATHE WORK, THE RULES (9 November 2026, Section 8). Pure, no imports.
 * - The price list: one line per item ("Brake disc | 80" or a range "Flywheel | 150-250"); the cost is the price, the
 *   HIGHEST when a range, so the job's profit is right at once.
 * - The customer pays at least 3 × the cost (200% markup); lower needs the owner.
 * - Under the threshold (AED 200 of cost) the work skips LPO approval but is still recorded as a ticket.
 * - The month-end bill: each ticked ticket takes its typed amount, else a share of the bill (before VAT, less the lines
 *   with no ticket) in proportion to its estimate.
 */

export type LatheItem = { item: string; price: number; priceTo: number | null; service: string | null };

/** "Brake disc | 80", "Flywheel | 150-250", "Drum | 60 | Brake drum resurfacing" (the third part: the customer's words). */
export function parsePriceList(raw: unknown): LatheItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => x as { item?: unknown; price?: unknown; priceTo?: unknown; service?: unknown })
      .filter((x) => String(x.item ?? "").trim() && Number(x.price) > 0)
      .map((x) => ({ item: String(x.item).trim(), price: Number(x.price), priceTo: Number(x.priceTo) > 0 ? Number(x.priceTo) : null, service: x.service ? String(x.service).trim() : null }));
  }
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((p) => p[0] && p[1])
    .map((p) => {
      const [from, to] = p[1].replace(/aed/i, "").split(/[-–]/).map((x) => Number(x.replace(/,/g, "").trim()));
      return { item: p[0], price: from || 0, priceTo: to && to > (from || 0) ? to : null, service: p[2] || null };
    })
    .filter((x) => x.price > 0);
}

/** The cost of one item: the price, or the highest of a range. */
export const latheCost = (i: Pick<LatheItem, "price" | "priceTo">) => Math.max(i.price, i.priceTo ?? 0);

/** What the customer reads: the service name ("Brake disc resurfacing"), never the lathe shop or the cost. */
export function customerServiceName(i: Pick<LatheItem, "item" | "service">): string {
  if (i.service) return i.service;
  const what = i.item.trim();
  return /resurfac|machin|skim|turn/i.test(what) ? what : `${what} resurfacing`;
}

export const DEFAULT_LATHE_MIN_MARKUP = 200;
export const DEFAULT_LATHE_LPO_THRESHOLD = 200;

/** The selling price per unit at the minimum markup (3 × the cost at 200%). */
export const minimumPrice = (cost: number, minMarkup: number) => Math.round(cost * (1 + minMarkup / 100) * 100) / 100;

/** Under the threshold (of the whole ticket's cost) the work skips LPO approval. */
export const skipsLpo = (cost: number, qty: number, threshold: number) => cost * qty < threshold - 1e-9;

/** "SUB-00012" from the highest number so far. */
export function nextTicket(highest: string | null | undefined): string {
  const n = Number(String(highest ?? "SUB-0").replace(/^SUB-/, "")) || 0;
  return `SUB-${String(n + 1).padStart(5, "0")}`;
}

export type BillTicket = { partId: string; estimate: number; typed: number | null };

/**
 * The bill's actual cost per ticket: a typed amount where the bill is itemised, the rest shared out by each ticket's
 * estimate; the cents land on the largest so the shares add up to the bill exactly (before VAT, less the lines that
 * have no ticket).
 */
export function splitBill(beforeVat: number, extra: number, tickets: BillTicket[]): Map<string, number> {
  const out = new Map<string, number>();
  const pool = Math.round((beforeVat - extra) * 100) / 100;
  const typedSum = tickets.reduce((a, t) => a + (t.typed ?? 0), 0);
  const free = tickets.filter((t) => t.typed === null);
  let left = Math.round((pool - typedSum) * 100) / 100;
  for (const t of tickets) if (t.typed !== null) out.set(t.partId, Math.round(t.typed * 100) / 100);
  const estSum = free.reduce((a, t) => a + t.estimate, 0);
  free.forEach((t, i) => {
    const share = i === free.length - 1 ? left : Math.round((estSum > 0 ? (pool - typedSum) * (t.estimate / estSum) : (pool - typedSum) / free.length) * 100) / 100;
    out.set(t.partId, share);
    left = Math.round((left - share) * 100) / 100;
  });
  return out;
}

/** The bill check: the ticked tickets plus the extra lines must come to the bill before VAT (to the fils). */
export function billProblem(beforeVat: number, extra: number, tickets: BillTicket[]): string | null {
  if (!(beforeVat > 0)) return "Type the bill's amount before VAT.";
  if (!tickets.length) return "Tick the tickets this bill covers.";
  const typedSum = tickets.reduce((a, t) => a + (t.typed ?? 0), 0);
  const allTyped = tickets.every((t) => t.typed !== null);
  const pool = Math.round((beforeVat - extra) * 100) / 100;
  if (typedSum > pool + 0.004) return `The typed amounts (AED ${typedSum.toFixed(2)}) are more than the bill less its extra lines (AED ${pool.toFixed(2)}).`;
  if (allTyped && Math.abs(typedSum - pool) > 0.004) return `The typed amounts come to AED ${typedSum.toFixed(2)}, the bill less its extra lines to AED ${pool.toFixed(2)}. Check the amounts, or add the difference as a line with no ticket.`;
  return null;
}

/** Status words of a ticket. */
export function ticketStatus(t: { lathe_sent_at: string | null; lathe_back_at: string | null; lathe_bill_id: string | null }): "Sent" | "Back" | "Billed" | "Not sent" {
  if (t.lathe_bill_id) return "Billed";
  if (t.lathe_back_at) return "Back";
  if (t.lathe_sent_at) return "Sent";
  return "Not sent";
}

/** Unbilled after a month: listed in red. */
export const unbilledTooLong = (sentAt: string | null, billed: boolean, nowMs: number) => !billed && !!sentAt && nowMs - Date.parse(sentAt) > 31 * 86400_000;
