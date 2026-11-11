/**
 * CAR-CARD DASHBOARDS (11 November 2026, Section 11). Pure: the search (plate, VIN, make, model, job number) and the
 * row of make chips with counts, shared by every car-card dashboard.
 */
export type BoardCar = { plate: string; vin: string | null; make: string | null; model: string | null; jobNumber: string | null };

const squeeze = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function boardSearchHit(c: BoardCar, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  const words = [c.plate, c.vin ?? "", c.make ?? "", c.model ?? "", c.jobNumber ?? "", `${c.make ?? ""} ${c.model ?? ""}`].join(" ").toLowerCase();
  if (n.split(/\s+/).every((w) => words.includes(w))) return true;
  return squeeze(words).includes(squeeze(n));
}

/** The make chips: each make with its count, the biggest first. */
export function makeChips(cars: BoardCar[]): { make: string; count: number }[] {
  const m = new Map<string, number>();
  for (const c of cars) {
    const k = (c.make ?? "").trim();
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries()).map(([make, count]) => ({ make, count })).sort((a, b) => b.count - a.count || a.make.localeCompare(b.make));
}

/** The car may leave (gate-out): paid or credit approved, QC passed, the advisor released it. The reasons in words, never an amount. */
export function gateOutBlocks(j: { status: string; paidOrCredit: boolean; readySentAt: string | null; jobKind?: string | null }): string[] {
  const out: string[] = [];
  if (!["ready", "pending_payment", "in_delivery"].includes(j.status)) out.push("QC not passed yet");
  if (!j.paidOrCredit) out.push("Payment not complete: call accounts");
  if (!j.readySentAt && j.jobKind !== "loose") out.push("The advisor has not released it yet");
  return out;
}
