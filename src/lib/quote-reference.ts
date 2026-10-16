import { TYRE_POSITIONS, TYRE_REPLACE_REASONS, itemStatusLabel } from "./inspection";
import type { InspectionBundle } from "./inspection-data";
import { roadTestSummary, type RoadTestRow, type RoadTestSummary } from "./road-test";

/** One finding of the approved report as the quotation's folded reference shows it, with the keys the services point at (suggest_for). */
export type ReferenceFinding = {
  sourceType: "item" | "tyre";
  sourceKey: string;
  keys: string[];
  label: string;
  status: "bad" | "average";
  statusLabel: string;
  remark: string | null;
  dangerous: boolean;
};

export type QuoteReference = {
  requests: string[];
  requestsNote: string | null;
  findings: ReferenceFinding[];
  managerNote: string | null;
  internalNote: string | null;
  /** The QC inspector's road test: flagged items first, the good ones as one line. */
  roadTest: RoadTestSummary;
};

/** The report folded into a reference strip for the quotation: requests, Bad and Average findings (Required service items too), the tyres, the battery, the manager's notes. */
export function quoteReferenceOf(b: InspectionBundle, requests: string[], roadTest: RoadTestRow | null = null): QuoteReference {
  const findings: ReferenceFinding[] = [];
  for (const i of b.items) {
    const flagged = i.status === "bad" || (i.status === "average" && i.style !== "job");
    if (!flagged) continue;
    findings.push({
      sourceType: "item",
      sourceKey: i.item_key,
      keys: [i.item_key],
      label: `${i.section_title} · ${i.item_label}`,
      status: i.status === "bad" ? "bad" : "average",
      statusLabel: itemStatusLabel(i.status, i.style),
      remark: i.remarks?.trim() || null,
      dangerous: !!i.dangerous,
    });
  }
  const m = (b.inspection.measurements ?? {}) as Record<string, string | number>;
  const tyres = TYRE_POSITIONS.filter((p) => ["replace_now", "replace_soon"].includes(String(m[`tyre_${p.key}_action`] ?? "")));
  if (tyres.length) {
    const now = tyres.some((p) => String(m[`tyre_${p.key}_action`]) === "replace_now");
    findings.push({
      sourceType: "tyre",
      sourceKey: "tyres",
      keys: tyres.map((p) => `tyre:${p.key}`),
      label: `Tyres · ${tyres.map((p) => p.label).join(", ")}`,
      status: now ? "bad" : "average",
      statusLabel: now ? "Replace now" : "Replace soon",
      remark:
        tyres
          .map((p) => {
            const reason = TYRE_REPLACE_REASONS.find((r) => r.value === String(m[`tyre_${p.key}_reason`] ?? ""))?.label;
            return `${p.label} ${m[`tyre_${p.key}_tread`] ? `${m[`tyre_${p.key}_tread`]} mm` : ""}${reason ? ` (${reason.toLowerCase()})` : ""}`.trim();
          })
          .join(" · ") || null,
      dangerous: tyres.some((p) => String(m[`tyre_${p.key}_danger`] ?? "") === "1"),
    });
  }
  if (String(m.battery_health ?? "") === "replace") {
    findings.push({ sourceType: "item", sourceKey: "measure:battery_health", keys: ["measure:battery_health"], label: "Battery test", status: "bad", statusLabel: "Replace", remark: m.battery_voltage ? `${m.battery_voltage} V` : null, dangerous: false });
  }
  return {
    requests,
    requestsNote: b.inspection.requests_note ?? null,
    findings,
    managerNote: b.inspection.manager_note ?? null,
    internalNote: b.inspection.manager_note_internal ?? null,
    roadTest: roadTestSummary(roadTest),
  };
}
