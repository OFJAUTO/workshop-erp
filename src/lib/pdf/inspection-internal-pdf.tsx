import "server-only";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Document, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { InspectionBundle } from "@/lib/inspection-data";
import { itemStatusLabel, type ChecklistSection } from "@/lib/inspection";
import type { JobCard } from "@/lib/job-data";
import { loadReportData, type ReportData } from "@/lib/report-data";
import type { RoadTestRow } from "@/lib/road-test";
import type { Settings } from "@/lib/settings";
import { formatPlate } from "@/lib/types";
import { loadLogo } from "./images";
import { GREY, INK, LINE, PALE, px, styles } from "./template";

const hcell = (w: number) => ({ ...(w ? { width: w } : {}), fontSize: px(9), fontWeight: 700, color: GREY, textTransform: "uppercase" as const, letterSpacing: 0.3, paddingRight: px(4) });
const cell = (w: number) => ({ ...(w ? { width: w } : {}), fontSize: px(10), paddingRight: px(4) });

/**
 * Fix 5 (4 November 2026): "PRINT (INTERNAL)" on the inspection report - the workshop's own paper copy.
 * A4 portrait, black and white, never for a customer (no name, no phone, no prices). FIRST the findings
 * that need work or parts (Replace now / Replace / Advisory), grouped by part, each with its measurements
 * and notes, an empty "Part ordered" tick box and a line for handwritten notes; THEN the full checklist,
 * compact. Options: with or without photos; findings only; and a BLANK checklist (header filled, empty
 * boxes) for when a tablet is not available. Every page's footer says INTERNAL - NOT FOR THE CUSTOMER.
 */

export type InternalPdfMode = "full" | "findings" | "blank";
export type InternalPdfOpts = { mode: InternalPdfMode; photos: boolean; printedBy: string; printedAt: string };

const GRADE: Record<number, string> = { 0: "REPLACE NOW", 1: "REPLACE", 2: "ADVISORY" };
type Pics = Map<string, Buffer>;

async function fetchPhoto(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

function Head({ logo, title, facts }: { logo: string | Buffer | null; title: string; facts: string[] }) {
  return (
    <View style={{ borderBottomWidth: px(3), borderBottomColor: INK, paddingBottom: px(10), marginBottom: px(10), gap: px(6) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: px(14) }}>
          {logo ? <Image src={logo} style={{ height: px(40), width: px(80), objectFit: "contain", objectPosition: "left" }} /> : null}
          <Text style={{ fontSize: px(15), fontWeight: 800, letterSpacing: 0.5 }}>{title}</Text>
        </View>
        <Text style={{ fontSize: px(10), fontWeight: 800, borderWidth: 1, borderColor: INK, paddingVertical: px(3), paddingHorizontal: px(8) }}>INTERNAL – NOT FOR THE CUSTOMER</Text>
      </View>
      <Text style={{ fontSize: px(10.5), fontWeight: 700 }}>{facts.filter(Boolean).join("  ·  ")}</Text>
    </View>
  );
}

const Footer = () => (
  <Text
    fixed
    style={{ position: "absolute", bottom: px(22), left: px(36), right: px(36), fontSize: px(9), color: GREY, textAlign: "center" }}
    render={({ pageNumber, totalPages }) => `INTERNAL – NOT FOR THE CUSTOMER · Page ${pageNumber} of ${totalPages}`}
  />
);

const Box = ({ size = 13 }: { size?: number }) => <View style={{ width: px(size), height: px(size), borderWidth: 1, borderColor: INK }} />;

/** The findings table: # | finding with its words | grade | Part ordered box | a line for notes. */
function Findings({ data, pics, photos }: { data: ReportData; pics: Pics; photos: boolean }) {
  const list = data.layout.attention;
  return (
    <View style={{ marginBottom: px(14) }}>
      <Text style={{ fontSize: px(12), fontWeight: 800, letterSpacing: 0.4, marginBottom: px(4) }}>WORK NEEDED ({list.length})</Text>
      <View fixed={false} style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: px(4), marginBottom: px(2) }}>
        <Text style={hcell(20)}>No.</Text>
        <Text style={[hcell(0), { flex: 1 }]}>Finding</Text>
        <Text style={hcell(76)}>Grade</Text>
        <Text style={hcell(62)}>Part ordered</Text>
        <Text style={hcell(120)}>Notes</Text>
      </View>
      {list.length === 0 ? <Text style={{ fontSize: px(10.5), paddingVertical: px(6) }}>Nothing needs work: every checked item passed.</Text> : null}
      {list.map((f, i) => {
        const shots = photos ? f.mediaKeys.flatMap((k) => (data.media[k]?.photos ?? []).slice(0, 3)).slice(0, 4).map((p) => pics.get(p.id)).filter((b): b is Buffer => !!b) : [];
        return (
          <View key={f.key} wrap={false} style={{ flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: LINE, paddingVertical: px(5), alignItems: "flex-start" }}>
            <Text style={cell(20)}>{i + 1}</Text>
            <View style={{ flex: 1, paddingRight: px(6), gap: px(2) }}>
              <Text style={{ fontSize: px(10.5), fontWeight: 700, textTransform: "uppercase" }}>{f.title}</Text>
              {f.reason ? <Text style={{ fontSize: px(9.5), color: GREY }}>{f.reason}</Text> : null}
              {f.extra.map((x) => <Text key={x} style={{ fontSize: px(9), color: GREY }}>{x}</Text>)}
              <Text style={{ fontSize: px(8.5), color: GREY }}>{f.section}</Text>
              {shots.length ? (
                <View style={{ flexDirection: "row", gap: px(4), marginTop: px(2) }}>
                  {shots.map((b, k) => <Image key={k} src={b} style={{ width: px(64), height: px(48), objectFit: "cover", borderWidth: 0.5, borderColor: LINE }} />)}
                </View>
              ) : null}
            </View>
            <View style={{ width: 76, paddingRight: px(4) }}>
              <Text style={{ fontSize: px(9.5), fontWeight: 800 }}>{GRADE[f.rank] ?? "ADVISORY"}</Text>
              <Text style={{ fontSize: px(8.5), color: GREY }}>{f.chip.text}</Text>
            </View>
            <View style={{ width: 62, alignItems: "center", paddingTop: px(1) }}><Box /></View>
            <View style={{ width: 120, paddingTop: px(10) }}><View style={{ borderBottomWidth: 0.75, borderBottomColor: GREY, borderStyle: "dotted" }} /></View>
          </View>
        );
      })}
    </View>
  );
}

/** The measured parts (brakes, tyres, battery): their tables, compact, right under the findings. */
function PartTables({ data }: { data: ReportData }) {
  const parts = data.layout.sections.filter((s) => ["BRAKES", "TYRES", "BATTERY"].includes(s.title) && (s.tables.length || s.lines.length));
  if (!parts.length) return null;
  return (
    <View style={{ marginBottom: px(12), gap: px(8) }}>
      {parts.map((s) => (
        <View key={s.key} wrap={false} style={{ gap: px(2) }}>
          <Text style={{ fontSize: px(10.5), fontWeight: 800 }}>{s.title}</Text>
          {s.tables.map((t, ti) => (
            <View key={ti} style={{ borderWidth: 0.75, borderColor: LINE }}>
              <View style={{ flexDirection: "row", backgroundColor: PALE, paddingVertical: px(2.5), paddingHorizontal: px(4) }}>
                {t.head.map((h, hi) => <Text key={hi} style={{ flex: hi === 0 ? 1.2 : 1, fontSize: px(8.5), fontWeight: 700, color: GREY, textTransform: "uppercase" }}>{h}</Text>)}
              </View>
              {t.rows.map((r, ri) => (
                <View key={ri} style={{ flexDirection: "row", paddingVertical: px(2.5), paddingHorizontal: px(4), borderTopWidth: 0.5, borderTopColor: LINE }}>
                  <Text style={{ flex: 1.2, fontSize: px(9.5), fontWeight: 700 }}>{r.label}</Text>
                  {r.cells.map((c, ci) => <Text key={ci} style={{ flex: 1, fontSize: px(9.5) }}>{c}</Text>)}
                </View>
              ))}
            </View>
          ))}
          {s.lines.map((l, li) => <Text key={li} style={{ fontSize: px(9.5) }}>{l.label}: {l.value}{l.chip ? ` · ${l.chip.text}` : ""}</Text>)}
        </View>
      ))}
    </View>
  );
}

/** The whole checklist, compact: every item with its answer (or an empty box on the blank sheet). */
function Checklist({ sections, answers, blank }: { sections: ChecklistSection[]; answers: Map<string, string>; blank: boolean }) {
  return (
    <View style={{ gap: px(8) }}>
      <Text style={{ fontSize: px(12), fontWeight: 800, letterSpacing: 0.4 }}>{blank ? "CHECKLIST (fill by hand)" : "FULL CHECKLIST"}</Text>
      {sections.map((s) => (
        <View key={s.key} wrap={s.items.length > 18} style={{ gap: px(1) }}>
          <Text style={{ fontSize: px(10), fontWeight: 800, backgroundColor: PALE, paddingVertical: px(2.5), paddingHorizontal: px(4) }}>{s.title.toUpperCase()}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {s.items.map((it) => (
              <View key={it.key} style={{ width: "50%", flexDirection: "row", alignItems: "center", gap: px(4), paddingVertical: px(2), paddingRight: px(8), borderBottomWidth: 0.5, borderBottomColor: LINE }}>
                {blank ? <Box size={10} /> : null}
                <Text style={{ flex: 1, fontSize: px(9.5) }}>{it.label}</Text>
                {!blank ? <Text style={{ fontSize: px(9.5), fontWeight: 700 }}>{answers.get(it.key) ?? "—"}</Text> : <View style={{ width: px(70), borderBottomWidth: 0.5, borderBottomColor: GREY, borderStyle: "dotted", height: px(9) }} />}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function NotesLines({ n }: { n: number }) {
  return (
    <View wrap={false} style={{ marginTop: px(12), gap: px(13) }}>
      <Text style={{ fontSize: px(10.5), fontWeight: 800 }}>NOTES</Text>
      {Array.from({ length: n }).map((_, i) => <View key={i} style={{ borderBottomWidth: 0.6, borderBottomColor: GREY, borderStyle: "dotted" }} />)}
    </View>
  );
}

export async function renderInspectionInternalPdf(
  card: JobCard,
  bundle: InspectionBundle | null,
  roadTest: RoadTestRow | null,
  settings: Settings,
  opts: InternalPdfOpts,
): Promise<Buffer> {
  const logo = await loadLogo();
  const v = card.vehicle;
  const plate = v ? formatPlate(v) : "";
  const carWords = [v?.make?.name, v?.model?.name, v?.variant, v?.model_year].filter(Boolean).join(" ");
  const g = card.gateIn;
  const km = g && g.mileage !== null && g.mileage !== undefined ? (g.mileage_unit === "mi" ? `${Number(g.mileage_miles ?? Math.round(Number(g.mileage) / 1.609344)).toLocaleString("en-GB")} miles` : `${Number(g.mileage).toLocaleString("en-GB")} km`) : null;

  if (opts.mode === "blank" || !bundle) {
    const sections = ((bundle?.inspection.checklist ?? settings.inspection_checklist ?? []) as ChecklistSection[]).filter((s) => s.key !== "diagnostics_and_road_test");
    const doc = (
      <Document title={`Inspection checklist ${card.job.job_number}`}>
        <Page size="A4" style={[styles.page, { paddingTop: px(28), paddingBottom: px(52), paddingHorizontal: px(36) }]}>
          <Head logo={logo} title="VEHICLE INSPECTION – BLANK CHECKLIST" facts={[card.job.job_number, plate, carWords, v?.vin ? `VIN ${v.vin}` : "", km ?? "", `Technician: ____________________`, `Date: ____________`]} />
          <Checklist sections={sections} answers={new Map()} blank />
          <NotesLines n={5} />
          <Footer />
        </Page>
      </Document>
    );
    return renderToBuffer(doc);
  }

  const data = await loadReportData(card, bundle, roadTest, settings);
  const pics: Pics = new Map();
  if (opts.photos) {
    const wanted = data.layout.attention.flatMap((f) => f.mediaKeys.flatMap((k) => (data.media[k]?.photos ?? []).slice(0, 3)));
    await Promise.all(
      wanted.map(async (p) => {
        if (!p.url || p.url.startsWith("data:")) return;
        const b = await fetchPhoto(p.url);
        if (b) pics.set(p.id, b);
      }),
    );
  }
  const answers = new Map<string, string>();
  for (const it of bundle.items) {
    if ((it as { merged_into?: string | null }).merged_into) continue;
    answers.set(it.item_key, it.status === "na" ? "N/A" : itemStatusLabel(it.status, it.style) || "—");
  }
  const sections = ((bundle.inspection.checklist ?? []) as ChecklistSection[]).filter((s) => s.key !== "diagnostics_and_road_test");
  const inspectedAt = data.head.inspectedAt;
  const doc = (
    <Document title={`Inspection internal ${card.job.job_number}`}>
      <Page size="A4" style={[styles.page, { paddingTop: px(28), paddingBottom: px(52), paddingHorizontal: px(36) }]}>
        <Head
          logo={logo}
          title="VEHICLE INSPECTION – INTERNAL"
          facts={[card.job.job_number, plate, carWords, v?.vin ? `VIN ${v.vin}` : "", km ?? "", inspectedAt ? `Inspected ${inspectedAt}` : "", bundle.technician ? `Technician ${bundle.technician.display_name}` : ""]}
        />
        <Findings data={data} pics={pics} photos={opts.photos} />
        <PartTables data={data} />
        {opts.mode === "full" ? <Checklist sections={sections} answers={answers} blank={false} /> : null}
        {opts.mode === "full" && data.layout.note ? <Text style={{ fontSize: px(9.5), color: GREY, marginTop: px(8) }}>Workshop note: {data.layout.note}</Text> : null}
        <NotesLines n={3} />
        <Text style={{ fontSize: px(8.5), color: GREY, marginTop: px(8) }}>Printed {opts.printedAt} by {opts.printedBy}</Text>
        <Footer />
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
