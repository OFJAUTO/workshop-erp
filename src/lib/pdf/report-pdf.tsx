import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDateTime } from "@/lib/format";
import { ITEM_STATUS_LABELS, MEASUREMENTS, ROAD_TEST_SECTION_KEY, TYRE_ACTIONS, TYRE_CONDITIONS, TYRE_POSITIONS, type ItemStatus } from "@/lib/inspection";
import type { InspectionBundle, InspectionMediaRow } from "@/lib/inspection-data";
import { vehicleTitle, type JobCard } from "@/lib/job-data";
import { ROAD_TEST_ITEMS, type RoadTestRow } from "@/lib/road-test";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { fetchPhoto, loadLogo } from "./images";
import { qrPng } from "./qr";
import { AMBER, GREEN, GREY, InfoBoxes, PdfDocument, Photos, RED, Tag, TitleRow, companyOf, styles } from "./template";

const COLOR: Record<ItemStatus, string> = { good: GREEN, average: AMBER, bad: RED, na: GREY };
const PHOTOS_PER_ITEM = 3;

/** The customer's inspection report on the document template: findings with photos, BAD and AVERAGE first. Parts and costs are never shown. */
export async function renderReportPdf(card: JobCard, bundle: InspectionBundle, roadTest: RoadTestRow | null, settings: Settings, token?: string | null): Promise<Buffer> {
  const insp = bundle.inspection;
  // N/A items do not apply to this car and are left out, as on the online report.
  const items = bundle.items.filter((i) => i.section_key !== ROAD_TEST_SECTION_KEY && i.status !== "na");
  const flagged = items.filter((i) => i.status === "bad" || i.status === "average").sort((a, b) => (a.status === "bad" ? 0 : 1) - (b.status === "bad" ? 0 : 1));
  const sections = Array.from(new Map(items.map((i) => [i.section_key, i.section_title])).entries());
  const m = (insp.measurements ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

  // Photos for the requests and the flagged items, shrunk for the PDF.
  const photosFor = (rows: InspectionMediaRow[]) => rows.filter((x) => x.kind === "photo").slice(0, PHOTOS_PER_ITEM);
  const wanted: InspectionMediaRow[] = [];
  for (const r of card.requests) wanted.push(...photosFor(bundle.media.filter((x) => x.job_request_id === r.id)));
  for (const i of flagged) wanted.push(...photosFor(bundle.media.filter((x) => x.item_key === i.item_key)));
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
  const tyres = [...TYRE_POSITIONS, { key: "spare", label: "Spare" }].filter((p) => m[`tyre_${p.key}_tread`] || m[`tyre_${p.key}_action`]);
  const measures = MEASUREMENTS.filter((x) => !x.key.startsWith("tyre_") && m[x.key] != null && String(m[x.key]) !== "");
  const prescans = insp.show_prescan_to_customer ? bundle.media.filter((x) => x.is_prescan) : [];

  const doc = (
    <PdfDocument title={`Inspection report ${card.job.job_number}`} company={company} logo={logo} qr={qr} uppercase={settings.customer_documents_uppercase === true} footerLines={["This report describes the condition found at inspection. A quotation for any work follows separately."]}>
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
          { title: "Customer", strong: card.customer?.company_name ?? card.customer?.full_name ?? "Customer", rows: [["Name", card.customer?.company_name ? card.customer.full_name : null], ["Mobile", card.customer?.phone ?? null]] },
          { title: "Vehicle", strong: vehicleTitle(card.vehicle), rows: [["Plate", formatPlate(card.vehicle)], ["VIN", card.vehicle.vin], ["Colour", card.vehicle.colour]] },
        ]}
      />

      <View>
        <Text style={styles.sectionTitle}>Your requests</Text>
        {card.requests.length === 0 ? <Text style={styles.small}>No requests were noted at gate-in.</Text> : null}
        {card.requests.map((r, i) => {
          const f = bundle.findings.find((x) => x.job_request_id === r.id);
          return (
            <View key={r.id} style={styles.item} wrap={false}>
              <View style={styles.itemHead}>
                <Text style={styles.lineTitle}>{i + 1}. {r.text}</Text>
                {f?.status ? <Tag text={ITEM_STATUS_LABELS[f.status]} color={COLOR[f.status]} /> : null}
              </View>
              {f?.found ? (
                <Text>
                  <Text style={styles.small}>Found: </Text>
                  {f.found}
                </Text>
              ) : null}
              <Photos photos={photoBuffers(bundle.media.filter((x) => x.job_request_id === r.id))} />
            </View>
          );
        })}
      </View>

      <View>
        <Text style={styles.sectionTitle}>Items needing attention   ·   {flagged.length}</Text>
        {flagged.length === 0 ? <Text style={styles.small}>Nothing was marked average or bad.</Text> : null}
        {flagged.map((i) => (
          <View key={i.id} style={[styles.item, { borderColor: i.status === "bad" ? RED : AMBER }]} wrap={false}>
            <View style={styles.itemHead}>
              <Tag text={ITEM_STATUS_LABELS[i.status as ItemStatus]} color={COLOR[i.status as ItemStatus]} />
              <Text style={styles.lineTitle}>{i.item_label}</Text>
              <Text style={styles.small}>{i.section_title}</Text>
            </View>
            {i.remarks ? <Text>{i.remarks}</Text> : null}
            <Photos photos={photoBuffers(bundle.media.filter((x) => x.item_key === i.item_key))} />
          </View>
        ))}
      </View>

      <View>
        <Text style={styles.sectionTitle}>Full checklist</Text>
        {sections.map(([key, title]) => (
          <View key={key} style={{ marginTop: 4 }}>
            <Text style={styles.groupTitle}>{title}</Text>
            {items
              .filter((i) => i.section_key === key)
              .map((i) => (
                <View key={i.id} style={styles.checkRow}>
                  <Text style={[styles.tag, { width: 58, color: i.status ? COLOR[i.status] : GREY }]}>{i.status ? ITEM_STATUS_LABELS[i.status] : ""}</Text>
                  <Text>{i.item_label}</Text>
                </View>
              ))}
          </View>
        ))}
      </View>

      {tyres.length || measures.length ? (
        <View>
          <Text style={styles.sectionTitle}>Tyres and brakes</Text>
          {m.tyre_size_front || m.tyre_size_rear ? (
            <View style={styles.checkRow}>
              <Text style={[styles.lineTitle, { width: 90 }]}>Tyre size</Text>
              <Text>Front {text(m.tyre_size_front) || "—"}   ·   Rear {text(m.tyre_size_rear) || "—"}</Text>
            </View>
          ) : null}
          {tyres.map((p) => (
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

      {roadTest && roadTest.status !== "not_started" && roadTest.decision !== "not_needed" ? (
        <View>
          <Text style={styles.sectionTitle}>Road test</Text>
          {roadTest.status === "not_possible" ? (
            <Text>Road test not possible: {roadTest.not_possible_reason}</Text>
          ) : (
            ROAD_TEST_ITEMS.map((it) => {
              const v = roadTest.items[it.key];
              return (
                <View key={it.key} style={styles.checkRow}>
                  <Text style={[styles.tag, { width: 58, color: v?.status ? COLOR[v.status] : GREY }]}>{v?.status ? ITEM_STATUS_LABELS[v.status] : ""}</Text>
                  <Text style={styles.lineTitle}>{it.label}</Text>
                  {v?.remarks ? <Text style={styles.small}>{v.remarks}</Text> : null}
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {insp.manager_note ? (
        <View style={styles.note} wrap={false}>
          <Text style={styles.smallTitle}>Workshop manager&apos;s note</Text>
          <Text>{insp.manager_note}</Text>
        </View>
      ) : null}
      {insp.technician_notes ? (
        <View style={styles.note} wrap={false}>
          <Text style={styles.smallTitle}>Workshop notes</Text>
          <Text>{insp.technician_notes}</Text>
        </View>
      ) : null}
      {prescans.length ? <Text style={[styles.small, { marginTop: 10 }]}>The fault code scan report is attached to the online report.</Text> : null}
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
