import "server-only";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Image, Path, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { InspectionBundle } from "@/lib/inspection-data";
import type { JobCard } from "@/lib/job-data";
import { pdfLastPageFill } from "@/lib/pdf-read";
import { loadReportData, type ReportData, type ReportPlace } from "@/lib/report-data";
import { TONE_COLOURS, type Chip, type Finding, type Section } from "@/lib/report-layout";
import type { RoadTestRow } from "@/lib/road-test";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatDate } from "@/lib/format";
import { fetchPhoto, loadLogo } from "./images";
import { qrPng } from "./qr";
import { CarOutlinePdf } from "./car-outline-pdf";
import { GREEN, GREY, INK, InfoBoxes, LINE, PALE, PdfDocument, TitleRow, VideoCards, companyOf, px, styles, type PdfVideo } from "./template";

/**
 * The customer's inspection report as a PDF (29 October 2026, section 8), drawn from THE layout the customer's link
 * and the staff preview use (`buildReportLayout` through `loadReportData`): the three boxes, Needs attention (worst
 * first), the workshop's note, one block per part (brakes, tyres, battery, then the rest in checklist order) with its
 * numbers, findings, photos and videos together, and Checked and passed last in three columns.
 *
 * Page breaks: a part's block never splits when it fits on a page; a long block keeps its title, numbers and first
 * finding together and every finding whole; no title sits alone at the foot of a page; the footer counts "Page X of
 * Y". When the last page would be nearly empty, the report is drawn again a little tighter so it ends on the page
 * before. No inspection fee, part numbers, prices, staff names or internal notes.
 */

const PHOTOS_PER_PLACE = 4;
/** The usable height of a page between the compact header and the footer, in points. */
const PAGE_BODY = 640;
/**
 * A part's block up to this height (about half a page) is kept whole and moved to the next page rather than split;
 * a taller one (many photos) continues on the next page, but only between findings or rows of photos, never with
 * its title or its table left alone, so no page is left half empty.
 */
const KEEP_WHOLE = 320;

type Look = { photo: { w: number; h: number }; gap: number; passedCols: number; passedSize: number };
const ROOMY: Look = { photo: { w: 118, h: 88 }, gap: 8, passedCols: 3, passedSize: px(10.5) };
const TIGHT: Look = { photo: { w: 96, h: 72 }, gap: 6, passedCols: 4, passedSize: px(9.5) };

function PdfChip({ chip, big = false }: { chip: Chip; big?: boolean }) {
  const c = TONE_COLOURS[chip.tone];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 7, paddingHorizontal: big ? 6 : 4.5, paddingVertical: big ? 2.2 : 1.6, alignSelf: "flex-start" }}>
      <Text style={{ color: c.fg, fontSize: big ? px(9.5) : px(8.5), fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase" }}>{chip.text}</Text>
    </View>
  );
}

function Tick({ size = 7, color = GREEN }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" style={{ marginRight: 3, marginTop: 1.5 }}>
      <Path d="M1.5 6.5 L4.8 9.8 L10.5 2.5" stroke={color} strokeWidth={2.4} fill="none" />
    </Svg>
  );
}

/** Rough heights, in points, so a block is kept whole only when it can fit on a page. */
const textLines = (s: string, perLine = 110) => Math.max(1, Math.ceil(s.length / perLine));
function mediaRows(keys: string[], data: ReportData, look: Look) {
  const places = keys.map((k) => data.media[k]).filter(Boolean) as ReportPlace[];
  const photos = places.reduce((n, p) => n + Math.min(PHOTOS_PER_PLACE, p.photos.length), 0);
  const videos = places.reduce((n, p) => n + p.videos.length, 0);
  const perRow = Math.max(1, Math.floor(520 / (look.photo.w + look.gap)));
  return Math.ceil(photos / perRow) * (look.photo.h + 8) + Math.ceil(videos / perRow) * (88 + 24);
}
function findingHeight(f: Finding, data: ReportData, look: Look) {
  return 8 + 12 * textLines(`${f.title} ${f.reason}`) + 11 * f.extra.length + mediaRows(f.mediaKeys, data, look);
}
function sectionHeight(s: Section, data: ReportData, look: Look) {
  let h = 34 + s.lines.length * 15 + s.tables.reduce((n, t) => n + 16 + t.rows.length * 16, 0) + (s.body ? 160 : 0);
  for (const f of s.findings) h += findingHeight(f, data, look);
  for (const g of s.good) h += 12 * textLines(`${g.title} ${g.note}`) + mediaRows(g.mediaKeys, data, look);
  return h + mediaRows(s.mediaKeys, data, look);
}

type Pics = Map<string, Buffer>;

/** A passed group's height in lines: its heading and its items (long names take two lines in a column). */
const groupWeight = (g: { items: string[] }) => 1.5 + g.items.reduce((n, i) => n + (i.length > 34 ? 2 : 1), 0);
/** The passed groups in reading order, cut into columns of the most even height (the longest column as short as it can be). */
function balancedColumns<G extends { items: string[] }>(groups: G[], n: number): G[][] {
  const w = groups.map(groupWeight);
  const sum = (a: number, b: number) => w.slice(a, b).reduce((t, x) => t + x, 0);
  let best: number[] = [];
  let bestMax = Infinity;
  const tryCuts = (cuts: number[]) => {
    const bounds = [0, ...cuts, groups.length];
    const max = Math.max(...bounds.slice(1).map((b, k) => sum(bounds[k], b)));
    if (max < bestMax) {
      bestMax = max;
      best = cuts;
    }
  };
  const walk = (from: number, left: number, cuts: number[]) => {
    if (left === 0) return tryCuts(cuts);
    for (let c = from; c <= groups.length; c++) walk(c, left - 1, [...cuts, c]);
  };
  walk(0, n - 1, []);
  const bounds = [0, ...best, groups.length];
  return bounds.slice(1).map((b, k) => groups.slice(bounds[k], b));
}

function MediaPdf({ keys, data, pics, look, token }: { keys: string[]; data: ReportData; pics: Pics; look: Look; token: string | null }) {
  const places = keys.map((k) => data.media[k]).filter((p): p is ReportPlace => !!p && p.photos.length + p.videos.length > 0);
  if (!places.length) return null;
  const photos = places.flatMap((p) => p.photos.slice(0, PHOTOS_PER_PLACE).map((ph) => pics.get(ph.id)).filter((b): b is Buffer => !!b));
  const more = places.reduce((n, p) => n + Math.max(0, p.photos.length - PHOTOS_PER_PLACE), 0);
  const videos: PdfVideo[] = places.flatMap((p) => p.videos.map((v) => ({ id: v.id, label: v.label, poster: pics.get(`poster:${v.id}`) ?? null, url: token ? `${PRODUCTION_SITE_URL}/report/${token}#v-${v.id}` : null, duration_s: v.duration_s })));
  const perRow = Math.max(1, Math.floor(520 / (look.photo.w + look.gap)));
  const rows: Buffer[][] = [];
  for (let i = 0; i < photos.length; i += perRow) rows.push(photos.slice(i, i + perRow));
  return (
    <View style={{ marginTop: 2 }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: look.gap, marginTop: r ? look.gap : 0 }} wrap={false}>
          {row.map((b, i) => (
            <PdfImage key={i} data={b} w={look.photo.w} h={look.photo.h} />
          ))}
        </View>
      ))}
      {more ? <Text style={[styles.small, { marginTop: 2 }]}>+{more} more photo{more === 1 ? "" : "s"} on the online report</Text> : null}
      <VideoCards videos={videos} />
    </View>
  );
}

function PdfImage({ data, w, h }: { data: Buffer; w: number; h: number }) {
  return <Image src={{ data, format: "jpg" }} style={{ width: w, height: h, objectFit: "cover", borderRadius: 3, backgroundColor: PALE }} />;
}

function FindingPdf({ f, children }: { f: Finding; children?: ReactNode }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: LINE, paddingTop: 5, marginTop: 5 }}>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
        <PdfChip chip={f.chip} />
        <View style={{ flex: 1 }}>
          <Text>
            <Text style={{ fontWeight: 700 }}>{f.title}</Text>
            {f.reason ? <Text style={{ color: "#3F3F46" }}>{`  ·  ${f.reason}`}</Text> : null}
          </Text>
        </View>
      </View>
      {f.extra.map((w) => (
        <Text key={w} style={{ fontWeight: 600, marginTop: 1 }}>{w}</Text>
      ))}
      {children}
    </View>
  );
}

function SectionPdf({ s, data, pics, look, token }: { s: Section; data: ReportData; pics: Pics; look: Look; token: string | null }) {
  const whole = sectionHeight(s, data, look) <= KEEP_WHOLE;
  const head = (
    <>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: px(2), borderBottomColor: INK, paddingBottom: 4, marginBottom: 4 }}>
        <Text style={{ fontSize: px(13), fontWeight: 800, letterSpacing: 0.6 }}>{s.title}</Text>
        <PdfChip chip={s.chip} big />
      </View>
      {s.lines.map((l) => (
        <View key={l.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 3 }}>
          <Text style={{ color: GREY }}>{l.label}</Text>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Text style={{ fontWeight: 600 }}>{l.value}</Text>
            {l.chip ? <PdfChip chip={l.chip} /> : null}
          </View>
        </View>
      ))}
      {s.tables.map((t) => {
        const widths = t.head.length === 5 ? [62, 58, 46, 0, 78] : [62, 110, 0, 78];
        const cell = (k: number) => (widths[k] ? { width: widths[k] } : { flex: 1 });
        return (
          <View key={t.head.join("|")} style={{ marginTop: 2 }}>
            <View style={[styles.th, { paddingBottom: 3 }]}>
              {t.head.map((h, k) => (
                <Text key={k} style={[cell(k), k === t.head.length - 1 ? { textAlign: "right" } : {}]}>{h}</Text>
              ))}
            </View>
            {t.rows.map((r) => (
              <View key={r.label} style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 3.5 }}>
                <Text style={[cell(0), { fontWeight: 700 }]}>{r.label}</Text>
                {r.cells.map((c, k) => (
                  <Text key={k} style={[cell(k + 1), { paddingRight: 6 }]}>{c}</Text>
                ))}
                <View style={[cell(t.head.length - 1), { alignItems: "flex-end" }]}>{r.chip ? <PdfChip chip={r.chip} /> : null}</View>
              </View>
            ))}
          </View>
        );
      })}
      {s.body ? (
        <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
          <CarOutlinePdf tones={Object.fromEntries(s.body.findings.map((f) => [f.panel, f.red ? "red" : "amber"]))} width={70} />
          <Text style={[styles.small, { flex: 1 }]}>Seen from above, front at the top. Amber: minor. Red: moderate or severe.</Text>
        </View>
      ) : null}
    </>
  );
  const finding = (f: Finding) => (
    <FindingPdf f={f}>
      <MediaPdf keys={f.mediaKeys} data={data} pics={pics} look={look} token={token} />
    </FindingPdf>
  );
  const rest = (
    <>
      {s.good.map((g) => (
        <View key={g.key} style={{ marginTop: 5 }} wrap={false}>
          <View style={{ flexDirection: "row" }}>
            <Tick />
            <View style={{ flex: 1 }}>
              <Text>
                <Text style={{ fontWeight: 600 }}>{g.title}</Text>
                {g.note ? <Text style={{ color: "#3F3F46" }}>{`  ·  ${g.note}`}</Text> : null}
              </Text>
            </View>
          </View>
          <MediaPdf keys={g.mediaKeys} data={data} pics={pics} look={look} token={token} />
        </View>
      ))}
      {s.mediaKeys.length ? (
        <View style={{ marginTop: 5 }}>
          <MediaPdf keys={s.mediaKeys} data={data} pics={pics} look={look} token={token} />
        </View>
      ) : null}
    </>
  );
  const box = { borderWidth: 1, borderColor: LINE, borderRadius: px(8), paddingHorizontal: 9, paddingVertical: 7, marginTop: 9 };
  if (whole) {
    return (
      <View style={box} wrap={false}>
        {head}
        {s.findings.map((f) => <View key={f.key}>{finding(f)}</View>)}
        {rest}
      </View>
    );
  }
  // Too tall for one page: the title, the numbers and the first finding stay together; every finding stays whole.
  const [first, ...others] = s.findings;
  return (
    <View style={box}>
      <View wrap={false}>
        {head}
        {first ? finding(first) : null}
      </View>
      {others.map((f) => (
        <View key={f.key} wrap={false}>{finding(f)}</View>
      ))}
      {rest}
    </View>
  );
}

function ReportDoc({ data, pics, look, token, company, logo, qr }: { data: ReportData; pics: Pics; look: Look; token: string | null; company: ReturnType<typeof companyOf>; logo: Buffer | null; qr: Buffer | null }) {
  const { layout, head } = data;
  const n = layout.attention.length;
  const attentionHead = (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
      {layout.noIssues ? (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Tick size={10} />
          <Text style={{ fontSize: px(14), fontWeight: 800, letterSpacing: 0.6, color: GREEN }}>NO ISSUES FOUND</Text>
        </View>
      ) : (
        <Text style={{ fontSize: px(14), fontWeight: 800, letterSpacing: 0.6 }}>NEEDS ATTENTION · {n}</Text>
      )}
      {layout.passedCount ? (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Tick />
          <Text style={{ fontSize: px(10), fontWeight: 600, color: GREEN }}>{layout.passedCount} items checked and passed (last page)</Text>
        </View>
      ) : null}
    </View>
  );
  const attentionLine = (f: Finding) => (
    <View key={f.key} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", borderTopWidth: 1, borderTopColor: LINE, paddingVertical: 3.5 }} wrap={false}>
      <PdfChip chip={f.chip} />
      <View style={{ flex: 1 }}>
        <Text>
          <Text style={{ fontWeight: 700 }}>{f.title}</Text>
          {f.reason ? <Text style={{ color: "#3F3F46" }}>{`  ·  ${f.reason}`}</Text> : null}
        </Text>
      </View>
      <View style={{ width: 92 }}>
        <Text style={{ fontSize: px(8.5), fontWeight: 700, color: GREY, letterSpacing: 0.5, textAlign: "right" }}>{f.section}</Text>
      </View>
    </View>
  );
  const danger = layout.dangers.length ? (
    <View style={{ backgroundColor: TONE_COLOURS.red.bg, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 5 }}>
      <Text style={{ color: "#FFFFFF", fontWeight: 800, letterSpacing: 0.5 }}>DANGEROUS TO DRIVE</Text>
      {data.dangerText ? <Text style={{ color: "#FFFFFF", marginTop: 1 }}>{data.dangerText}</Text> : null}
    </View>
  ) : null;
  // The passed list in balanced columns (category headings, a green tick per line).
  const cols = balancedColumns(layout.passed, look.passedCols);
  const weights = cols.map((c) => c.reduce((t, g) => t + groupWeight(g), 0));
  const passedHeight = 26 + Math.max(...weights) * (look.passedSize + 3.5);
  const passedBody = (
    <View style={{ flexDirection: "row", gap: 12 }}>
      {cols.map((groups, k) => (
        <View key={k} style={{ flex: 1 }}>
          {groups.map((g) => (
            <View key={g.title} style={{ marginBottom: 5 }} wrap={false}>
              <Text style={[styles.smallTitle, { marginBottom: 1.5 }]}>{g.title}</Text>
              {g.items.map((i) => (
                <View key={i} style={{ flexDirection: "row" }}>
                  <Tick size={6.5} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: look.passedSize }}>{i}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
  return (
    <PdfDocument title={`Inspection report ${head.jobNumber}`} company={company} logo={logo} qr={qr} uppercase={false} footerLines={["This report describes the condition found at inspection. A quotation for any work follows separately."]}>
      <TitleRow title="INSPECTION REPORT" meta={[{ label: "Reference", value: head.jobNumber }]} />
      <InfoBoxes
        boxes={[
          head.loose ? { title: "Items", strong: head.car } : { title: "Vehicle", strong: head.car, rows: [["Plate", head.plate], ["Mileage", head.mileage], ["VIN", head.vin]] },
          { title: "Customer", strong: head.customer, lines: [head.customerSub, head.phone] },
          { title: "Inspected", strong: head.inspectedAt ? formatDate(head.inspectedAt) : "—", rows: [["Reference", head.jobNumber], ["Approved", head.approvedAt ? formatDate(head.approvedAt) : null]] },
        ]}
      />

      <View style={{ borderWidth: layout.noIssues ? 0 : px(2), borderColor: INK, backgroundColor: layout.noIssues ? TONE_COLOURS.green.bg : "#FFFFFF", borderRadius: px(8), paddingHorizontal: 9, paddingVertical: 7 }}>
        <View wrap={false}>
          {attentionHead}
          {danger}
          {layout.attention.slice(0, 3).map(attentionLine)}
        </View>
        {layout.attention.slice(3).map(attentionLine)}
      </View>

      {layout.note ? (
        <View style={{ backgroundColor: PALE, borderRadius: px(8), paddingHorizontal: 10, paddingVertical: 7, marginTop: 9 }} wrap={false}>
          <Text style={styles.smallTitle}>Note from the workshop</Text>
          <Text>{layout.note}</Text>
        </View>
      ) : null}

      {layout.sections.map((s) => (
        <SectionPdf key={s.key} s={s} data={data} pics={pics} look={look} token={token} />
      ))}

      {data.extraVideos.length ? (
        <View style={{ borderWidth: 1, borderColor: LINE, borderRadius: px(8), paddingHorizontal: 9, paddingVertical: 7, marginTop: 9 }} wrap={false}>
          <Text style={{ fontSize: px(13), fontWeight: 800, letterSpacing: 0.6, borderBottomWidth: px(2), borderBottomColor: INK, paddingBottom: 4 }}>VIDEOS</Text>
          <VideoCards videos={data.extraVideos.map((v) => ({ id: v.id, label: v.label, poster: pics.get(`poster:${v.id}`) ?? null, url: token ? `${PRODUCTION_SITE_URL}/report/${token}#v-${v.id}` : null, duration_s: v.duration_s }))} />
        </View>
      ) : null}

      {layout.passed.length ? (
        <View style={{ borderWidth: 1, borderColor: LINE, borderRadius: px(8), paddingHorizontal: 9, paddingVertical: 7, marginTop: 9 }} wrap={passedHeight > PAGE_BODY}>
          <View wrap={false}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", borderBottomWidth: px(2), borderBottomColor: INK, paddingBottom: 4, marginBottom: 5 }}>
              <Text style={{ fontSize: px(13), fontWeight: 800, letterSpacing: 0.6 }}>CHECKED AND PASSED · {layout.passedCount}</Text>
            </View>
            {passedHeight <= PAGE_BODY ? passedBody : null}
          </View>
          {passedHeight > PAGE_BODY ? passedBody : null}
        </View>
      ) : null}
    </PdfDocument>
  );
}

export async function renderReportPdf(card: JobCard, bundle: InspectionBundle, roadTest: RoadTestRow | null, settings: Settings, token?: string | null): Promise<Buffer> {
  const data = await loadReportData(card, bundle, roadTest, settings);
  // The photos shown (up to four a place) and the videos' pictures, shrunk for the PDF.
  const pics: Pics = new Map();
  const wanted: { key: string; url: string | null }[] = [];
  for (const place of Object.values(data.media)) {
    for (const ph of place.photos.slice(0, PHOTOS_PER_PLACE)) wanted.push({ key: ph.id, url: ph.url });
    for (const v of place.videos) wanted.push({ key: `poster:${v.id}`, url: v.poster });
  }
  for (const v of data.extraVideos) wanted.push({ key: `poster:${v.id}`, url: v.poster });
  await Promise.all(
    wanted.map(async (w) => {
      if (!w.url || w.url.startsWith("data:")) return;
      const b = await fetchPhoto(w.url);
      if (b) pics.set(w.key, b);
    }),
  );
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), token ? qrPng(`${PRODUCTION_SITE_URL}/report/${token}`) : Promise.resolve(null)]);
  const draw = (look: Look) => renderToBuffer(<ReportDoc data={data} pics={pics} look={look} token={token ?? null} company={company} logo={logo} qr={qr} />);
  const first = await draw(ROOMY);
  // A nearly empty last page: drawn again a little tighter, kept when it really ends a page earlier.
  const fill = await pdfLastPageFill(first);
  if (fill.pages > 1 && fill.fill < 0.2) {
    const second = await draw(TIGHT);
    const again = await pdfLastPageFill(second);
    if (again.pages < fill.pages || again.fill >= 0.2) return second;
  }
  return first;
}
