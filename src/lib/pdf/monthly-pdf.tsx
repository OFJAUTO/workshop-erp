import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";
import { VERDICT_LABELS } from "@/lib/job-summary";
import type { MonthlySummary } from "@/lib/owner-report";
import type { Settings } from "@/lib/settings";
import { loadLogo } from "./images";
import { GREY, INK, LINE, PALE, PdfDocument, RED, TitleRow, companyOf, styles } from "./template";

const aed = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `AED ${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
const px = (n: number) => n * 0.75;

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <View style={[styles.box, { paddingVertical: px(10) }]}>
      <Text style={styles.boxTitle}>{label}</Text>
      <Text style={[styles.boxStrong, { fontSize: px(18) }]}>{value}</Text>
      {note ? <Text style={styles.boxMuted}>{note}</Text> : null}
    </View>
  );
}

function Row({ cells, head = false, tone }: { cells: { text: string; w: number; right?: boolean }[]; head?: boolean; tone?: string }) {
  return (
    <View style={head ? styles.th : [styles.tr, { paddingVertical: px(5) }]}>
      {cells.map((c, i) => <Text key={i} style={{ width: px(c.w), textAlign: c.right ? "right" : "left", paddingRight: px(6), color: tone && !head ? tone : head ? GREY : INK }}>{c.text}</Text>)}
    </View>
  );
}

/** The month on two or three pages: the numbers, the verdicts and flags, the jobs, the people. */
export async function renderMonthlyPdf(s: MonthlySummary, settings: Settings): Promise<Buffer> {
  const logo = await loadLogo();
  const company = companyOf(settings);
  const doc = (
    <PdfDocument title={`Monthly summary ${s.label}`} company={company} logo={logo} footerLines={["For the owner only. Written by the system from the jobs gated out in the month."]} scanLabel="">
      <TitleRow title="MONTHLY SUMMARY" meta={[{ label: "Month", value: s.label }, { label: "Gated out", value: `${s.count}` }]} />
      <View style={styles.boxes}>
        <Stat label="Invoiced before VAT" value={aed(s.invoiced)} />
        <Stat label="Profit" value={aed(s.profit)} note={s.marginPercent !== null ? `${s.marginPercent}% margin` : null} />
        <Stat label="On time" value={s.count ? `${Math.round((s.onTime / s.count) * 100)}%` : "–"} note={s.count ? `${s.late} late, ${s.avgDays} days on average` : null} />
        <Stat label="Verdicts" value={`${s.verdicts.good} / ${s.verdicts.acceptable} / ${s.verdicts.talk}`} note="good / acceptable / needs a talk" />
      </View>
      {s.flags.length ? (
        <View style={{ marginBottom: px(14) }}>
          <Text style={styles.sectionTitle}>Things that came up</Text>
          {s.flags.map((f) => <Text key={f.text} style={{ paddingVertical: px(1.5) }}>{f.count} × {f.text.replace(/\bn\b/g, "…")}</Text>)}
        </View>
      ) : null}
      <Text style={styles.sectionTitle}>Jobs gated out</Text>
      <Row head cells={[{ text: "Date", w: 60 }, { text: "Job", w: 70 }, { text: "Car", w: 150 }, { text: "Verdict", w: 80 }, { text: "Invoiced", w: 90, right: true }, { text: "Profit", w: 90, right: true }, { text: "Days", w: 40, right: true }]} />
      {s.jobs.map((j) => <Row key={j.id} tone={j.profit !== null && j.profit < 0 ? RED : undefined} cells={[{ text: formatDate(j.gatedOutAt), w: 60 }, { text: j.jobNumber, w: 70 }, { text: `${j.plate}${j.loose ? " (loose)" : ""}`, w: 150 }, { text: VERDICT_LABELS[j.verdict], w: 80 }, { text: aed(j.invoiced), w: 90, right: true }, { text: `${aed(j.profit)}${j.marginPercent !== null ? ` (${j.marginPercent}%)` : ""}`, w: 90, right: true }, { text: `${j.days}`, w: 40, right: true }]} />)}
      {s.jobs.length === 0 ? <Text style={{ color: GREY, paddingVertical: px(6) }}>Nothing gated out in this month.</Text> : null}
      <View break>
        <Text style={styles.sectionTitle}>Technicians</Text>
        <Row head cells={[{ text: "Name", w: 140 }, { text: "Jobs", w: 50, right: true }, { text: "On the clock", w: 90, right: true }, { text: "Charged", w: 70, right: true }, { text: "Efficiency", w: 70, right: true }, { text: "QC send-backs", w: 90, right: true }, { text: "Needs a talk", w: 80, right: true }]} />
        {s.technicians.map((t) => <Row key={t.name} cells={[{ text: t.name, w: 140 }, { text: `${t.jobs}`, w: 50, right: true }, { text: `${Math.floor(t.minutes / 60)} h ${String(Math.round(t.minutes % 60)).padStart(2, "0")}`, w: 90, right: true }, { text: `${t.hoursCharged.toFixed(1)} h`, w: 70, right: true }, { text: t.efficiencyPercent === null ? "–" : `${t.efficiencyPercent}%`, w: 70, right: true }, { text: `${t.qcSendbacks}`, w: 90, right: true }, { text: `${t.talk}`, w: 80, right: true }]} />)}
        <Text style={[styles.sectionTitle, { marginTop: px(16) }]}>Service advisors</Text>
        <Row head cells={[{ text: "Name", w: 140 }, { text: "Jobs", w: 50, right: true }, { text: "Invoiced", w: 100, right: true }, { text: "Profit", w: 100, right: true }, { text: "Discounts", w: 90, right: true }, { text: "Needs a talk", w: 80, right: true }]} />
        {s.advisors.map((t) => <Row key={t.name} cells={[{ text: t.name, w: 140 }, { text: `${t.jobs}`, w: 50, right: true }, { text: aed(t.invoiced), w: 100, right: true }, { text: aed(t.profit), w: 100, right: true }, { text: aed(t.discount), w: 90, right: true }, { text: `${t.talk}`, w: 80, right: true }]} />)}
        {s.managers.length ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: px(16) }]}>Workshop managers</Text>
            <Row head cells={[{ text: "Name", w: 140 }, { text: "Jobs", w: 50, right: true }, { text: "Send-backs given", w: 110, right: true }, { text: "QC fails on their jobs", w: 130, right: true }]} />
            {s.managers.map((t) => <Row key={t.name} cells={[{ text: t.name, w: 140 }, { text: `${t.jobs}`, w: 50, right: true }, { text: `${t.managerSendbacks}`, w: 110, right: true }, { text: `${t.qcSendbacks}`, w: 130, right: true }]} />)}
          </>
        ) : null}
        <View style={{ marginTop: px(16), padding: px(10), backgroundColor: PALE, borderRadius: px(8), borderWidth: 1, borderColor: LINE }}>
          <Text style={{ color: GREY }}>Efficiency: hours charged against hours on the clock; 100% means the time matched the quotation. Profit before VAT after parts, technician time at the cost rate, other costs and bank charges; provisional while a supplier invoice is to follow.</Text>
        </View>
      </View>
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
