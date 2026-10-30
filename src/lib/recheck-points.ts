/**
 * The PPF recheck checklist (30 October 2026). Pure: the tablet screen and the server read the same list.
 * Every point is OK or Needs fixing (with photos and a note); a fix is done under the recheck without a price and
 * ticked Fixed. Screen film, tint and ceramic can be "Not on this car".
 */
export type RecheckPointKey = "edges" | "bubbles" | "dust" | "alignment" | "panels" | "screen" | "tint" | "ceramic";
export type RecheckStatus = "ok" | "fix" | "na";

export const RECHECK_POINTS: { key: RecheckPointKey; label: string; optional?: boolean }[] = [
  { key: "edges", label: "Edges and lifting" },
  { key: "bubbles", label: "Bubbles" },
  { key: "dust", label: "Dust or contamination" },
  { key: "alignment", label: "Alignment and gaps" },
  { key: "panels", label: "Panels and badges refitted" },
  { key: "screen", label: "Interior screen film", optional: true },
  { key: "tint", label: "Tint", optional: true },
  { key: "ceramic", label: "Ceramic", optional: true },
];

export type RecheckPoint = { key: RecheckPointKey; label: string; optional: boolean; status: RecheckStatus | null; note: string | null; fixedAt: string | null };

/** The saved answers (aftercare_checks.findings.points) laid over the list. */
export function recheckPoints(saved: unknown): RecheckPoint[] {
  const map = (saved && typeof saved === "object" ? (saved as { points?: Record<string, { status?: string; note?: string | null; fixed_at?: string | null }> }).points : null) ?? {};
  return RECHECK_POINTS.map((p) => {
    const s = map[p.key] ?? {};
    const status = s.status === "ok" || s.status === "fix" || (s.status === "na" && p.optional) ? (s.status as RecheckStatus) : null;
    return { key: p.key, label: p.label, optional: !!p.optional, status, note: s.note ?? null, fixedAt: s.fixed_at ?? null };
  });
}

/** "6 of 8 answered · 1 to fix". */
export function recheckProgress(points: RecheckPoint[]): string {
  const answered = points.filter((p) => p.status).length;
  const toFix = points.filter((p) => p.status === "fix" && !p.fixedAt).length;
  return `${answered} of ${points.length} answered${toFix ? ` · ${toFix} to fix` : ""}`;
}

/** Something had to be redone: the recheck also counts as a comeback. */
export const recheckRedo = (points: RecheckPoint[]) => points.some((p) => p.status === "fix");
