import "server-only";
import { actionLabel, damageWords, panelLabel, severityLabel, toneOf } from "./car-outline";
import { loadBodyState } from "./bodyshop-findings";
import { ROAD_TEST_SECTION_KEY, inspectionLimitsOf, type ChecklistSection } from "./inspection";
import { INSPECTION_BUCKET, type InspectionBundle } from "./inspection-data";
import { vehicleTitle, type JobCard } from "./job-data";
import { thumbsFor } from "./media-urls";
import { buildReportLayout, type ReportLayout } from "./report-layout";
import { reportVideos, videoLabel } from "./report-videos";
import { roadTestSummary, type RoadTestRow } from "./road-test";
import type { Settings } from "./settings";
import { formatPlate } from "./types";
import { contactNameOf } from "./messages";

/**
 * Everything the inspection report shows (29 October 2026, section 8), read once for the customer's link, the PDF
 * and the staff preview: the layout (`buildReportLayout`), the header boxes, and the photos and videos of every place
 * with their labels ("Front brake pads – Bad"). Photos carry a small picture for the page and the sharp address for
 * the viewer and the PDF.
 */
export type ReportPhoto = { id: string; url: string; thumb: string | null };
export type ReportVideoItem = { id: string; url: string; poster: string | null; duration_s: number | null; label: string };
export type ReportPlace = { label: string; photos: ReportPhoto[]; videos: ReportVideoItem[] };
export type ReportHead = {
  jobNumber: string;
  car: string;
  plate: string;
  mileage: string | null;
  vin: string | null;
  colour: string | null;
  customer: string;
  customerSub: string | null;
  phone: string | null;
  inspectedAt: string | null;
  approvedAt: string | null;
  loose: boolean;
};
export type ReportData = {
  layout: ReportLayout;
  head: ReportHead;
  media: Record<string, ReportPlace>;
  /** Videos whose place is not on the report (an item marked N/A, a request): their own block at the end. */
  extraVideos: ReportVideoItem[];
  dangerText: string;
};

const mileageWords = (g: JobCard["gateIn"]) => {
  if (!g || g.mileage === null || g.mileage === undefined) return null;
  if (g.mileage_unit === "mi") return `${Number(g.mileage_miles ?? Math.round(Number(g.mileage) / 1.609344)).toLocaleString("en-GB")} miles`;
  return `${Number(g.mileage).toLocaleString("en-GB")} km`;
};

export async function loadReportData(card: JobCard, bundle: InspectionBundle, roadTest: RoadTestRow | null, settings: Settings, opts: { thumbs?: boolean } = {}): Promise<ReportData> {
  const insp = bundle.inspection;
  const limits = inspectionLimitsOf(settings);
  const body = await loadBodyState(insp.id);
  const road = roadTestSummary(roadTest);
  // The report's own media: photos and videos of the checklist, the measurements, the tyres and the body (never the
  // pre-scan files or a request's photos).
  const shown = bundle.media.filter((x) => !x.is_prescan && x.item_key && (x.kind === "photo" || x.kind === "video"));
  const counts: Record<string, { photos: number; videos: number }> = {};
  for (const x of shown) {
    const c = (counts[x.item_key as string] ??= { photos: 0, videos: 0 });
    if (x.kind === "photo") c.photos++;
    else c.videos++;
  }
  const checklist = (insp.checklist ?? []) as ChecklistSection[];
  const sectionOrder = checklist.length ? checklist.map((s) => s.key) : Array.from(new Set([...bundle.items].sort((a, b) => a.position - b.position).map((i) => i.section_key)));
  const when = insp.submitted_at ?? insp.approved_at ?? insp.created_at;
  const layout = buildReportLayout({
    items: bundle.items.filter((i) => i.section_key !== ROAD_TEST_SECTION_KEY),
    sectionOrder,
    measurements: (insp.measurements ?? {}) as Record<string, unknown>,
    media: counts,
    road: road.state === "done" || road.state === "not_possible" ? { done: road.state === "done", flagged: road.flagged, good: road.good, notPossible: road.state === "not_possible" ? (roadTest?.not_possible_reason ?? "No reason given") : null } : null,
    body: body.findings.length ? { findings: body.findings.map((f) => ({ id: f.id, panel: f.panel, panelLabel: panelLabel(f.panel), severityLabel: severityLabel(f.severity), red: toneOf(f) === "red", words: [damageWords(f.damage), actionLabel(f.action), f.remark ?? ""] })), airbags: !!body.airbags, structural: !!body.structural } : null,
    tyreOldYears: limits.tyre_old_years,
    tyreListYears: limits.tyre_years,
    thisYear: new Date(when ?? Date.now()).getUTCFullYear(),
    managerNote: insp.manager_note,
  });

  const thumbs = opts.thumbs ? await thumbsFor(INSPECTION_BUCKET, shown.filter((x) => x.kind === "photo").map((x) => x.storage_path), 480) : new Map<string, string>();
  const videoById = new Map(reportVideos(bundle).map((v) => [v.id, v]));
  const media: Record<string, ReportPlace> = {};
  for (const x of shown) {
    const key = x.item_key as string;
    const place = (media[key] ??= { label: videoLabel(bundle, key), photos: [], videos: [] });
    const url = bundle.mediaUrls[x.storage_path];
    if (!url) continue;
    if (x.kind === "photo") place.photos.push({ id: x.id, url, thumb: thumbs.get(x.storage_path) ?? null });
    else place.videos.push({ id: x.id, url, poster: x.poster_path ? (bundle.mediaUrls[x.poster_path] ?? null) : null, duration_s: x.duration_s, label: videoById.get(x.id)?.label ?? place.label });
  }
  const placed = new Set(layout.placedKeys);
  const extraVideos = bundle.media
    .filter((x) => x.kind === "video" && !x.is_prescan && (!x.item_key || !placed.has(x.item_key)) && bundle.mediaUrls[x.storage_path])
    .map((x) => ({ id: x.id, url: bundle.mediaUrls[x.storage_path], poster: x.poster_path ? (bundle.mediaUrls[x.poster_path] ?? null) : null, duration_s: x.duration_s, label: videoById.get(x.id)?.label ?? "Inspection video" }));

  const v = card.vehicle;
  const c = card.customer;
  return {
    layout,
    head: {
      jobNumber: card.job.job_number,
      car: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ") || vehicleTitle(v),
      plate: formatPlate(v),
      mileage: mileageWords(card.gateIn),
      vin: v.vin ?? null,
      colour: v.colour ?? null,
      customer: c?.company_name ?? c?.full_name ?? "Customer",
      customerSub: c?.company_name ? contactNameOf(c.full_name, c.company_name) : null,
      phone: c?.phone ?? null,
      inspectedAt: insp.submitted_at,
      approvedAt: insp.approved_at,
      loose: v.kind === "loose",
    },
    media,
    extraVideos,
    dangerText: String(settings.dangerous_customer_text ?? ""),
  };
}
