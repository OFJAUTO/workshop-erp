import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDateTime } from "@/lib/format";
import { ITEM_STATUS_LABELS, MEASUREMENTS, ROAD_TEST_SECTION_KEY, TYRE_ACTIONS, TYRE_CONDITIONS, TYRE_POSITIONS, TYRE_REPLACE_REASONS, itemStatusLabel, type ItemStatus } from "@/lib/inspection";
import type { InspectionBundle, InspectionMediaRow } from "@/lib/inspection-data";
import { vehicleTitle, type JobCard } from "@/lib/job-data";
import { feeNotice } from "@/lib/jobs";
import { ROAD_TEST_ITEMS, type RoadTestRow } from "@/lib/road-test";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { fetchPhoto, loadLogo } from "./images";
import { qrPng } from "./qr";
import { AMBER, GREEN, GREY, InfoBoxes, PdfDocument, Photos, RED, Tag, TitleRow, companyOf, styles } from "./template";

const COLOR: Record<ItemStatus, string> = { good: GREEN, average: AMBER, bad: RED, na: GREY };
const PHOTOS_PER_ITEM = 3;

/**
 * The customer's inspection report on the document template, in the order of the online page: anything
 * dangerous first, then what needs attention (Bad, then Average, the tyres, the battery), what passed in
 * one line per section, the measurements, the workshop's note and the inspection fee note. No requests, no
 * staff names, no parts, no costs.
 */
export async function renderReportPdf(card: JobCard, bundle: InspectionBundle, roadTest: RoadTestRow | null, settings: Settings, token?: string | null): Promise<Buffer> {
  const insp = bundle.inspection;
  // N/A items do not apply to this car and are left out, as on the online report.
  const items = bundle.items.filter((i) => i.section_key !== ROAD_TEST_SECTION_KEY && i.status !== "na");
  const attention = items.filter((i) => i.status === "bad" || (i.status === "average" && i.style !== "job")).sort((a, b) => (a.status === "bad" ? 0 : 1) - (b.status === "bad" ? 0 : 1));
  const passed = items.filter((i) => i.status === "good");
  const sections = Array.from(new Map(items.map((i) => [i.section_key, i.section_title])).entries());
  const m = (insp.measurements ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const tyres = TYRE_POSITIONS.filter((p) => ["replace_now", "replace_soon"].includes(text(m[`tyre_${p.key}_action`]))).map((p) => ({
    ...p,
    now: text(m[`tyre_${p.key}_action`]) === "replace_now",
    tread: text(m[`tyre_${p.key}_tread`]),
    year: text(m[`tyre_${p.key}_year`]),
    reason: TYRE_REPLACE_REASONS.find((r) => r.value === text(m[`tyre_${p.key}_reason`]))?.label ?? null,
    danger: text(m[`tyre_${p.key}_danger`]) === "1",
    dangerReason: text(m[`tyre_${p.key}_danger_reason`]),
  }));
  const batteryReplace = text(m.battery_health) === "replace";
  const dangers = [
    ...attention.filter((i) => i.dangerous).map((i) => `${i.item_label}${i.dangerous_reason ? `: ${i.dangerous_reason}` : ""}`),
    ...tyres.filter((t) => t.danger).map((t) => `${t.label} tyre${t.dangerReason ? `: ${t.dangerReason}` : ""}`),
  ];
  const roadFlagged = roadTest?.status === "done" ? ROAD_TEST_ITEMS.filter((it) => roadTest.items[it.key]?.status && roadTest.items[it.key]?.status !== "good") : [];

  // Photos for the items needing attention, shrunk for the PDF.
  const photosFor = (rows: InspectionMediaRow[]) => rows.filter((x) => x.kind === "photo").slice(0, PHOTOS_PER_ITEM);
  const wanted: InspectionMediaRow[] = [];
  for (const i of attention) wanted.push(...photosFor(bundle.media.filter((x) => x.item_key === i.item_key)));
  if (batteryReplace) wanted.push(...photosFor(bundle.media.filter((x) => x.item_key === "measure.battery")));
  const buffers = new Map<string, Buffer>();
  await Promise.all(
    Array.from(new Set(wanted.map((w) => w.storage_path))).map(async (p) => {
      const b = await fetchPhoto(bundle.mediaUrls[p]);
      if (b) buffers.set(p, b);
    }),
  );
  const photoBuffers = (rows: InspectionMediaRow[]) => photosFor(rows).map((x) => buffers.get(x.storage_path)).filter((b): b is Buffer => !!b);

  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), token ? qrPng(`${PRODUCTION_SITE_URL}/report/${token}`) : Promise.resolve(null)]);
  const tyreRows = [...TYRE_POSITIONS, { key: "spare", label: "Spare" }].filter((p) => m[`tyre_${p.key}_tread`] || m[`tyre_${p.key}_action`]);
  const measures = MEASUREMENTS.filter((x) => !x.key.startsWith("tyre_") && m[x.key] != null && String(m[x.key]) !== "");
  const fee = feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed);
  const attentionCount = attention.length + tyres.length + (batteryReplace ? 1 : 0);

  const doc = (
    <PdfDocument title={`Inspection report ${card.job.job_number}`} company={company} logo={logo} qr={qr} uppercase={false} footerLines={["This report describes the condition found at inspection. A quotation for any work follows separately."]}>
      <TitleRow
        title="INSPECTION REPORT"
        meta={[
          { label: "Job card", value: card.job.job_number },
          { label: "Inspected", value: formatDateTime(insp.submitted_at) },
          { label: "Approved", value: formatDateTime(insp.approved_at) },
        ]}
      />
      <InfoBoxes
        boxes={[
          { title: "Vehicle", strong: vehicleTitle(card.vehicle), rows: [["Plate", formatPlate(card.vehicle)], ["VIN", card.vehicle.vin], ["Colour", card.vehicle.colour]] },
          { title: "Customer", strong: card.customer?.company_name ?? card.customer?.full_name ?? "Customer", rows: [["Name", card.customer?.company_name ? card.customer.full_name : null], ["Mobile", card.customer?.phone ?? null]] },
        ]}
      />

      {dangers.length ? (
        <View style={{ borderWidth: 1.5, borderColor: RED, borderRadius: 4, padding: 8, marginBottom: 6 }} wrap={false}>
          <Text style={[styles.smallTitle, { color: RED }]}>DANGEROUS TO DRIVE</Text>
          {dangers.map((d) => (
            <Text key={d} style={styles.lineTitle}>{d}</Text>
          ))}
          <Text style={{ marginTop: 4 }}>{settings.dangerous_customer_text}</Text>
        </View>
      ) : null}

      <View>
        <Text style={styles.sectionTitle}>Needs attention   ·   {attentionCount}</Text>
        {attentionCount === 0 ? <Text style={styles.small}>Nothing needs attention. The items checked are listed below.</Text> : null}
        {attention.map((i) => (
          <View key={i.id} style={[styles.item, { borderColor: i.status === "bad" ? RED : AMBER }]} wrap={false}>
            <View style={styles.itemHead}>
              <Tag text={itemStatusLabel(i.status, i.style)} color={i.style === "job" ? GREY : COLOR[i.status as ItemStatus]} />
              <Text style={styles.lineTitle}>{i.item_label}</Text>
              <Text style={styles.small}>{i.section_title}</Text>
              {i.dangerous ? <Tag text="Dangerous" color={RED} /> : null}
            </View>
            {i.remarks ? <Text>{i.remarks}</Text> : null}
            <Photos photos={photoBuffers(bundle.media.filter((x) => x.item_key === i.item_key))} />
          </View>
        ))}
        {tyres.map((t) => (
          <View key={t.key} style={[styles.item, { borderColor: t.now ? RED : AMBER }]} wrap={false}>
            <View style={styles.itemHead}>
              <Tag text={t.now ? "Replace now" : "Replace soon"} color={t.now ? RED : AMBER} />
              <Text style={styles.lineTitle}>{t.label} tyre</Text>
              <Text style={styles.small}>Tyres</Text>
              {t.danger ? <Tag text="Dangerous" color={RED} /> : null}
            </View>
            <Text>{[t.tread ? `${t.tread} mm tread` : "", t.year ? `year ${t.year}` : "", t.reason ? `reason: ${t.reason.toLowerCase()}` : ""].filter(Boolean).join("   ·   ")}</Text>
          </View>
        ))}
        {batteryReplace ? (
          <View style={[styles.item, { borderColor: RED }]} wrap={false}>
            <View style={styles.itemHead}>
              <Tag text="Replace" color={RED} />
              <Text style={styles.lineTitle}>Battery</Text>
              <Text style={styles.small}>Battery test</Text>
            </View>
            {m.battery_voltage ? <Text>{text(m.battery_voltage)} V measured.</Text> : null}
            <Photos photos={photoBuffers(bundle.media.filter((x) => x.item_key === "measure.battery"))} />
          </View>
        ) : null}
        {roadFlagged.length && roadTest ? (
          <View style={[styles.item, { borderColor: AMBER }]} wrap={false}>
            <View style={styles.itemHead}>
              <Tag text="Road test" color={AMBER} />
              <Text style={styles.lineTitle}>Noted on the road test</Text>
            </View>
            {roadFlagged.map((it) => {
              const v = roadTest.items[it.key];
              return (
                <Text key={it.key}>
                  {it.label}
                  {v?.status ? `   ·   ${ITEM_STATUS_LABELS[v.status]}` : ""}
                  {v?.remarks ? `   ·   ${v.remarks}` : ""}
                </Text>
              );
            })}
          </View>
        ) : null}
      </View>

      <View>
        <Text style={styles.sectionTitle}>Checked and passed   ·   {passed.length}</Text>
        {sections.map(([key, title]) => {
          const ok = passed.filter((i) => i.section_key === key);
          if (!ok.length) return null;
          return (
            <View key={key} style={{ marginTop: 3 }}>
              <Text style={styles.groupTitle}>{title}</Text>
              <Text style={styles.small}>{ok.map((i) => i.item_label).join("   ·   ")}</Text>
            </View>
          );
        })}
        {roadTest?.status === "done" && !roadFlagged.length ? (
          <View style={{ marginTop: 3 }}>
            <Text style={styles.groupTitle}>Road test</Text>
            <Text style={styles.small}>Nothing noted on the road test.</Text>
          </View>
        ) : null}
        {roadTest?.status === "not_possible" ? (
          <View style={{ marginTop: 3 }}>
            <Text style={styles.groupTitle}>Road test</Text>
            <Text style={styles.small}>Road test not possible: {roadTest.not_possible_reason}</Text>
          </View>
        ) : null}
      </View>

      {tyreRows.length || measures.length ? (
        <View>
          <Text style={styles.sectionTitle}>Measurements</Text>
          {m.tyre_size_front || m.tyre_size_rear ? (
            <View style={styles.checkRow}>
              <Text style={[styles.lineTitle, { width: 90 }]}>Tyre size</Text>
              <Text>Front {text(m.tyre_size_front) || "—"}   ·   Rear {text(m.tyre_size_rear) || "—"}</Text>
            </View>
          ) : null}
          {tyreRows.map((p) => (
            <View key={p.key} style={styles.checkRow}>
              <Text style={[styles.lineTitle, { width: 90 }]}>{p.label}</Text>
              <Text style={{ width: 90 }}>
                {m[`tyre_${p.key}_tread`] ? `${text(m[`tyre_${p.key}_tread`])} mm` : ""}
                {m[`tyre_${p.key}_year`] ? `   ·   ${text(m[`tyre_${p.key}_year`])}` : ""}
              </Text>
              <Text style={[styles.small, { flex: 1 }]}>{text(m[`tyre_${p.key}_cond`]).split(",").filter(Boolean).map((c) => TYRE_CONDITIONS.find((x) => x.value === c)?.label ?? c).join(", ")}</Text>
              <Text style={styles.lineTitle}>{TYRE_ACTIONS.find((a) => a.value === m[`tyre_${p.key}_action`])?.label ?? ""}</Text>
            </View>
          ))}
          {measures.map((x) => (
            <View key={x.key} style={styles.checkRow}>
              <Text style={[styles.lineTitle, { width: 180 }]}>{x.label}</Text>
              <Text>
                {x.kind === "choice" ? (x.choices?.find((c) => c.value === String(m[x.key]))?.label ?? text(m[x.key])) : text(m[x.key])}
                {x.unit ? ` ${x.unit}` : ""}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {insp.manager_note ? (
        <View style={styles.note} wrap={false}>
          <Text style={styles.smallTitle}>Workshop note</Text>
          <Text>{insp.manager_note}</Text>
        </View>
      ) : null}
      {fee ? <Text style={[styles.lineTitle, { marginTop: 10 }]}>{fee}</Text> : null}
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
