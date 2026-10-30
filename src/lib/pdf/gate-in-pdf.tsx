import "server-only";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Document, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { loadLogo } from "./images";
import { DamagePdf, type DamagePdfData } from "./damage-pdf";
import { GREY, INK, LINE, PALE, px, styles } from "./template";

/**
 * "GATE-IN RECORD - INTERNAL": everything recorded when the car arrived, on paper. The customer and the
 * car, the gate-in answers, the customer's requests, the approval name and time, the inspection fee, and
 * every photo with its label. Videos cannot print, so their count is stated. Never for a customer.
 */

export type GateInPdfData = {
  jobNumber: string;
  plate: string;
  car: string;
  vin: string | null;
  colour: string | null;
  customerName: string;
  customerPhone: string | null;
  customerNumber: string | null;
  gatedIn: string;
  gatedInBy: string;
  details: [string, string][];
  requests: string[];
  approval: string;
  feeLine: string;
  gateOut: [string, string][] | null;
  /** Fetched ahead of the render so one missing file never breaks the whole PDF. */
  photos: { data: Buffer; format: "jpg" | "png"; label: string }[];
  videoCount: number;
  printedBy: string;
  printedAt: string;
  /** Section 4 (30 October 2026): the damage already on the car, with each panel's photos. */
  damage?: DamagePdfData | null;
  /** The customer's copy of the job card (from their link): no staff names, nothing internal. */
  customer?: boolean;
};

const row = (label: string, value: string, i: number) => (
  <View key={`${label}-${i}`} style={{ flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: LINE, paddingVertical: px(4) }}>
    <Text style={{ width: px(150), fontSize: px(9.5), color: GREY }}>{label}</Text>
    <Text style={{ flex: 1, fontSize: px(10.5) }}>{value}</Text>
  </View>
);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: px(14) }}>
      <Text style={{ fontSize: px(9.5), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.4, borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: px(3), marginBottom: px(2) }}>{title}</Text>
      {children}
    </View>
  );
}

export async function renderGateInPdf(d: GateInPdfData): Promise<Buffer> {
  const logo = await loadLogo();
  const doc = (
    <Document title={d.customer ? `Job card ${d.jobNumber}` : `Gate-in record ${d.jobNumber}`}>
      <Page size="A4" style={[styles.page, { paddingTop: px(28), paddingBottom: px(56), paddingHorizontal: px(42) }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: px(3), borderBottomColor: INK, paddingBottom: px(10), marginBottom: px(14) }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: px(14) }}>
            {logo ? <Image src={logo} style={{ height: px(40), width: px(80), objectFit: "contain", objectPosition: "left" }} /> : null}
            <Text style={{ fontSize: px(15), fontWeight: 800, letterSpacing: 0.5 }}>{d.customer ? "JOB CARD" : "GATE-IN RECORD – INTERNAL"}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: px(12), fontWeight: 800 }}>{d.jobNumber} · {d.plate}</Text>
            <Text style={{ fontSize: px(9.5), color: GREY }}>{d.car}{d.vin ? ` · VIN ${d.vin}` : ""}</Text>
            <Text style={{ fontSize: px(9.5), color: GREY }}>{d.customer ? `Received ${d.gatedIn}` : `Printed ${d.printedAt} by ${d.printedBy}`}</Text>
          </View>
        </View>

        <Section title="Vehicle and customer">
          {row("Customer", [d.customerName, d.customerPhone, d.customerNumber].filter(Boolean).join(" · "), 0)}
          {row("Car", d.car || d.plate, 1)}
          {row("Plate", d.plate, 2)}
          {d.vin ? row("VIN", d.vin, 3) : null}
          {d.colour ? row("Colour", d.colour, 4) : null}
        </Section>

        <Section title={d.customer ? "Check-in" : "Gate-in"}>
          {row(d.customer ? "Received" : "Gated in", d.customer ? d.gatedIn : `${d.gatedIn} by ${d.gatedInBy}`, 0)}
          {d.details.map(([k, v], i) => row(k, v, i + 1))}
        </Section>

        {d.damage ? <DamagePdf d={d.damage} /> : null}

        {d.requests.length ? (
          <Section title={d.customer ? "Your requests" : "Customer requests"}>
            {d.requests.map((r, i) => (
              <Text key={i} style={{ fontSize: px(10.5), paddingVertical: px(2) }}>{i + 1}. {r}</Text>
            ))}
          </Section>
        ) : null}

        <Section title="Job card approval">
          <Text style={{ fontSize: px(10.5), paddingVertical: px(2) }}>{d.approval}</Text>
          <Text style={{ fontSize: px(10.5), paddingVertical: px(2), fontWeight: 700 }}>{d.feeLine}</Text>
        </Section>

        {d.gateOut ? <Section title="Gate-out">{d.gateOut.map(([k, v], i) => row(k, v, i))}</Section> : null}

        {d.photos.length || d.videoCount ? (
          <Section title={`Photos (${d.photos.length})${d.videoCount ? ` · ${d.videoCount} video${d.videoCount === 1 ? "" : "s"} on the job card` : ""}`}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: px(8), paddingTop: px(6) }}>
              {d.photos.map((p, i) => (
                <View key={i} wrap={false} style={{ width: px(154) }}>
                  <Image src={{ data: p.data, format: p.format }} style={{ width: px(154), height: px(110), objectFit: "cover", backgroundColor: PALE }} />
                  <Text style={{ fontSize: px(8.5), color: GREY, paddingTop: px(2) }}>{p.label}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        <Text
          fixed
          style={{ position: "absolute", bottom: px(24), left: px(42), right: px(42), fontSize: px(9), color: GREY, textAlign: "center" }}
          render={({ pageNumber, totalPages }) => (d.customer ? `Page ${pageNumber} of ${totalPages}` : `INTERNAL – NOT FOR THE CUSTOMER · Page ${pageNumber} of ${totalPages}`)}
        />
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
