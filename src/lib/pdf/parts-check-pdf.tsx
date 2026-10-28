import "server-only";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Document, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { loadLogo } from "./images";
import { GREY, INK, LINE, PALE, px, styles } from "./template";

/**
 * "PARTS PRICE CHECK - INTERNAL": the parts page on paper, for checking prices with a pen. Black and
 * white, A4 landscape, a tick box per line, qty × net each = line total, the technician's note in small
 * grey under the part, subtotals per supplier and the grand total in bold. The column titles repeat on
 * every page and every page's footer says INTERNAL - NOT FOR THE CUSTOMER. Never for a customer.
 */

export type CheckRow = {
  description: string;
  /** The short form (ALL 4, FRONT PAIR) on its own small line under the name. */
  positions?: string | null;
  note: string | null;
  part_number: string | null;
  part_type: string | null;
  qty: number;
  list: number | null;
  discount: number | null;
  net: number;
  supplier: string;
  availability: string;
};
export type PartsCheckData = {
  jobNumber: string;
  plate: string;
  car: string;
  vin: string | null;
  printedBy: string;
  printedAt: string;
  rows: CheckRow[];
  leftOut: number;
};

const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/* Column widths in pt (landscape A4 is 842pt wide; margins take 56). The Part column flexes. */
const W = { tick: 20, no: 22, pn: 92, type: 54, qty: 30, list: 52, disc: 34, net: 54, total: 58, supplier: 86, avail: 72 };

function HeaderRow() {
  return (
    <View fixed style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: px(5), marginBottom: px(3), alignItems: "flex-end" }}>
      <Text style={{ width: W.tick }} />
      <Text style={cellH(W.no)}>No.</Text>
      <Text style={[cellH(0), { flex: 1 }]}>Part</Text>
      <Text style={cellH(W.pn)}>Part number</Text>
      <Text style={cellH(W.type)}>Type</Text>
      <Text style={[cellH(W.qty), right]}>Qty</Text>
      <Text style={[cellH(W.list), right]}>List</Text>
      <Text style={[cellH(W.disc), right]}>Disc %</Text>
      <Text style={[cellH(W.net), right]}>Net each</Text>
      <Text style={[cellH(W.total), right]}>Line total</Text>
      <Text style={[cellH(W.supplier), { paddingLeft: px(8) }]}>Supplier</Text>
      <Text style={cellH(W.avail)}>Availability</Text>
    </View>
  );
}

const right = { textAlign: "right" as const };
const cellH = (w: number) => ({ ...(w ? { width: w } : {}), fontSize: px(9.5), fontWeight: 700, color: GREY, textTransform: "uppercase" as const, letterSpacing: 0.3, paddingRight: px(4) });
const cell = (w: number) => ({ ...(w ? { width: w } : {}), fontSize: px(10.5), paddingRight: px(4) });

export async function renderPartsCheckPdf(d: PartsCheckData): Promise<Buffer> {
  const logo = await loadLogo();
  const bySupplier = new Map<string, number>();
  let total = 0;
  for (const r of d.rows) {
    const line = r.qty * r.net;
    total += line;
    const s = r.supplier || "No supplier yet";
    bySupplier.set(s, (bySupplier.get(s) ?? 0) + line);
  }
  const vat = Math.round(total * 5) / 100;
  const doc = (
    <Document title={`Parts price check ${d.jobNumber}`}>
      <Page size="A4" orientation="landscape" style={[styles.page, { paddingTop: px(28), paddingBottom: px(56), paddingHorizontal: px(38) }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: px(3), borderBottomColor: INK, paddingBottom: px(10), marginBottom: px(12) }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: px(16) }}>
            {logo ? <Image src={logo} style={{ height: px(44), width: px(86), objectFit: "contain", objectPosition: "left" }} /> : null}
            <Text style={{ fontSize: px(16), fontWeight: 800, letterSpacing: 0.5 }}>PARTS PRICE CHECK – INTERNAL</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: px(12), fontWeight: 800 }}>{d.jobNumber} · {d.plate}</Text>
            <Text style={{ fontSize: px(10), color: GREY }}>{d.car}{d.vin ? ` · VIN ${d.vin}` : ""}</Text>
            <Text style={{ fontSize: px(10), color: GREY }}>Printed {d.printedAt} by {d.printedBy}</Text>
          </View>
        </View>
        <HeaderRow />
        {d.rows.map((r, i) => (
          <View key={i} wrap={r.description.length + (r.note?.length ?? 0) > 600} style={{ flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: LINE, paddingVertical: px(5), alignItems: "flex-start" }}>
            <View style={{ width: W.tick, paddingTop: px(1) }}><View style={{ width: px(13), height: px(13), borderWidth: 1, borderColor: INK }} /></View>
            <Text style={cell(W.no)}>{i + 1}</Text>
            <View style={{ flex: 1, paddingRight: px(4) }}>
              <Text style={{ fontSize: px(10.5), fontWeight: 700, textTransform: "uppercase" }}>{r.description}</Text>
              {r.positions ? <Text style={{ fontSize: px(9), fontWeight: 700, color: GREY }}>{r.positions}</Text> : null}
              {r.note ? <Text style={{ fontSize: px(9), color: GREY }}>{r.note}</Text> : null}
            </View>
            <Text style={cell(W.pn)}>{r.part_number ?? ""}</Text>
            <Text style={[cell(W.type), { textTransform: "capitalize" }]}>{r.part_type ?? ""}</Text>
            <Text style={[cell(W.qty), right]}>{r.qty}</Text>
            <Text style={[cell(W.list), right]}>{money(r.list)}</Text>
            <Text style={[cell(W.disc), right]}>{r.discount ? `${r.discount}%` : ""}</Text>
            <Text style={[cell(W.net), right]}>{money(r.net)}</Text>
            <Text style={[cell(W.total), right, { fontWeight: 700 }]}>{money(r.qty * r.net)}</Text>
            <Text style={[cell(W.supplier), { paddingLeft: px(8) }]}>{r.supplier}</Text>
            <Text style={cell(W.avail)}>{r.availability}</Text>
          </View>
        ))}
        {d.leftOut ? <Text style={{ fontSize: px(9.5), color: GREY, marginTop: px(6) }}>{d.leftOut} removed or not-needed line{d.leftOut === 1 ? " is" : "s are"} left out.</Text> : null}
        <View wrap={false} style={{ marginTop: px(14), flexDirection: "row", justifyContent: "flex-end" }}>
          <View style={{ width: px(300), backgroundColor: PALE, padding: px(12), gap: px(3) }}>
            {[...bySupplier.entries()].sort((a, b) => b[1] - a[1]).map(([s, v]) => (
              <View key={s} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: px(10), color: GREY }}>{s}</Text>
                <Text style={{ fontSize: px(10) }}>AED {money(v)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.75, borderTopColor: INK, paddingTop: px(4), marginTop: px(3) }}>
              <Text style={{ fontSize: px(10.5) }}>Total our cost</Text>
              <Text style={{ fontSize: px(10.5) }}>AED {money(total)}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: px(10.5) }}>VAT 5%</Text>
              <Text style={{ fontSize: px(10.5) }}>AED {money(vat)}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: px(12), fontWeight: 800 }}>GRAND TOTAL</Text>
              <Text style={{ fontSize: px(12), fontWeight: 800 }}>AED {money(total + vat)}</Text>
            </View>
          </View>
        </View>
        <Text
          fixed
          style={{ position: "absolute", bottom: px(24), left: px(38), right: px(38), fontSize: px(9), color: GREY, textAlign: "center" }}
          render={({ pageNumber, totalPages }) => `INTERNAL – NOT FOR THE CUSTOMER · Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
