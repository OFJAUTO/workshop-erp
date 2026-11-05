/**
 * PARTS CHANGED AFTER THE CUSTOMER'S APPROVAL (5 November 2026, J-00985): the one rule for what changed on a car's
 * parts since its quotation was approved - parts added (they need approval before any LPO), parts taken off
 * (cancelled, returned, not needed) and parts whose cost or quantity changed - with the cost difference in plain
 * words: "Changes since approval: 8 added, 6 removed, cost + AED 31.58". Pure: the parts page, the job card, the
 * LPO approval page and "Resend for approval" all read it, so they can never disagree.
 *
 * The baseline is every part line on the job's APPROVED quotations (left-off lines and unchosen options included:
 * the customer saw them, so they are never "new"). A part on no approved quotation that is still live and not
 * approved for ordering (order status "none") is NEW and needs approval.
 */

export type ApprovedPartLine = { part_item_id: string; unit_cost: number | null; quantity: number };

export type ChangePart = {
  id: string;
  description: string;
  cost: number | null;
  qty: number;
  order_status: string | null;
  /** Active and not given an ending (cancelled, returned, kept in stock) nor removed. */
  live: boolean;
  /** Why it was taken off (the ending's note or the removal reason). */
  reason: string | null;
};

export type PartsChanges = {
  added: { id: string; description: string; cost: number | null; qty: number; total: number; priced: boolean; /** Not approved for ordering yet (order status "none"). */ needsApproval: boolean }[];
  removed: { id: string; description: string; oldTotal: number; reason: string | null }[];
  changed: { id: string; description: string; oldCost: number; newCost: number; oldQty: number; newQty: number; oldTotal: number; newTotal: number }[];
  /** Live parts on no approved quotation and not approved for ordering: what "Resend for approval" sends. */
  needsApproval: string[];
  /** New total of the changes minus the old: added + changed (new − old) − removed. */
  costDelta: number;
  /** "Changes since approval: 8 added, 6 removed, cost + AED 31.58", or null when nothing changed. */
  words: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "cost + AED 31.58", "cost − AED 12.00", "cost unchanged". */
export function costDeltaWords(delta: number): string {
  if (Math.abs(delta) < 0.005) return "cost unchanged";
  return `cost ${delta > 0 ? "+" : "−"} AED ${money(delta)}`;
}

/** Live, order status "none", on no approved quotation: the part waits for an approval that only a resend can give. */
export function needsApprovalAfter(p: Pick<ChangePart, "id" | "live" | "order_status">, onApproved: Set<string>): boolean {
  return p.live && (p.order_status ?? "none") === "none" && !onApproved.has(p.id);
}

export function partsChangesOf(approved: ApprovedPartLine[], parts: ChangePart[]): PartsChanges {
  const line = new Map<string, ApprovedPartLine>();
  for (const l of approved) if (!line.has(l.part_item_id)) line.set(l.part_item_id, l);
  const onApproved = new Set(line.keys());
  const added: PartsChanges["added"] = [];
  const removed: PartsChanges["removed"] = [];
  const changed: PartsChanges["changed"] = [];
  for (const p of parts) {
    const l = line.get(p.id);
    if (!l) {
      // Added since approval whatever its order status (resent, ordered, received…); only "none" still needs approval.
      if (p.live) {
        const cost = p.cost !== null && p.cost !== undefined ? Number(p.cost) : null;
        added.push({ id: p.id, description: p.description, cost, qty: p.qty, total: r2((cost ?? 0) * p.qty), priced: cost !== null && cost > 0, needsApproval: needsApprovalAfter(p, onApproved) });
      }
      continue;
    }
    const oldCost = Number(l.unit_cost) || 0;
    const oldQty = Number(l.quantity) || 1;
    const oldTotal = r2(oldCost * oldQty);
    if (!p.live) {
      removed.push({ id: p.id, description: p.description, oldTotal, reason: p.reason });
      continue;
    }
    const newCost = p.cost !== null && p.cost !== undefined ? Number(p.cost) : oldCost;
    const newTotal = r2(newCost * p.qty);
    if (Math.abs(newCost - oldCost) > 0.005 || Math.abs(p.qty - oldQty) > 0.005) changed.push({ id: p.id, description: p.description, oldCost, newCost, oldQty, newQty: p.qty, oldTotal, newTotal });
  }
  const costDelta = r2(added.reduce((a, x) => a + x.total, 0) + changed.reduce((a, x) => a + (x.newTotal - x.oldTotal), 0) - removed.reduce((a, x) => a + x.oldTotal, 0));
  const parts2 = [added.length ? `${added.length} added` : null, removed.length ? `${removed.length} removed` : null, changed.length ? `${changed.length} changed` : null].filter(Boolean);
  return {
    added,
    removed,
    changed,
    needsApproval: added.filter((a) => a.needsApproval).map((a) => a.id),
    costDelta,
    words: parts2.length ? `Changes since approval: ${parts2.join(", ")}, ${costDeltaWords(costDelta)}` : null,
  };
}
