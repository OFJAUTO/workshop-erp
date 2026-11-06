/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import "server-only";
import { Document, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { PartLabel } from "../part-labels";
import { qrPng } from "./qr";

const MM = 72 / 25.4;

/**
 * THE part label PDF (6 November 2026, Section 8): every page exactly the label (50 × 25 mm by default, from Settings),
 * zero margins, one label per page, so the label printer feeds one label per page with nothing scaled. The QR on the
 * left (21 mm, readable from a phone at arm's length); on the right the job number, the plate (or STOCK), the part with
 * its side, the make and model, the LPO number with "1 OF 2", and the day it was received. `border` draws the label's
 * outline (the test label: it shows at once whether the label sits square on the roll).
 */
export async function renderPartLabelsPdf(labels: PartLabel[], size: { w: number; h: number }, opts: { border?: boolean } = {}): Promise<Buffer> {
  const w = size.w * MM;
  const h = size.h * MM;
  const u = (size.h / 25) * MM;
  const inset = 1.2 * u;
  const qrSide = Math.min(h - 2 * inset, 0.46 * w);
  const qrs = await Promise.all(labels.map((l) => qrPng(l.qr, 360)));
  const doc = (
    <Document title="Part labels" author="OFJ Automotive">
      {labels.map((l, i) => {
        const nameLine = [l.name.toUpperCase(), l.side].filter(Boolean).join(" · ");
        const nameSize = (nameLine.length > 48 ? 1.8 : nameLine.length > 30 ? 2.1 : 2.4) * u;
        return (
          <Page key={l.key} size={[w, h]} style={{ margin: 0, padding: 0, backgroundColor: "#fff", color: "#000", fontFamily: "Helvetica" }}>
            {opts.border ? <View fixed style={{ position: "absolute", left: 0.3 * MM, top: 0.3 * MM, width: w - 0.6 * MM, height: h - 0.6 * MM, borderWidth: 0.25 * MM, borderColor: "#000", borderStyle: "solid" }} /> : null}
            <View style={{ flexDirection: "row", width: w, height: h, padding: inset, alignItems: "center" }}>
              <Image src={{ data: qrs[i], format: "png" }} style={{ width: qrSide, height: qrSide }} />
              <View style={{ flex: 1, height: "100%", marginLeft: inset, justifyContent: "space-between" }}>
                <View>
                  <Text style={{ fontSize: 4.4 * u, fontFamily: "Helvetica-Bold", lineHeight: 1 }}>{l.jobNumber}</Text>
                  {l.plate && l.plate !== l.jobNumber ? <Text style={{ fontSize: 2.5 * u, fontFamily: "Helvetica-Bold", marginTop: 0.4 * u }}>{l.plate}</Text> : null}
                </View>
                <Text style={{ fontSize: nameSize, fontFamily: "Helvetica-Bold", lineHeight: 1.05, maxLines: 2, textOverflow: "ellipsis" }}>
                  {nameLine}
                </Text>
                <View>
                  {l.car ? <Text style={{ fontSize: 1.9 * u, maxLines: 1 }}>{l.car.toUpperCase()}</Text> : null}
                  <Text style={{ fontSize: 1.8 * u, marginTop: 0.2 * u, maxLines: 1 }}>
                    {[l.lpo, `${l.index} OF ${l.count}`].filter(Boolean).join(" · ")}
                  </Text>
                  {l.received ? <Text style={{ fontSize: 1.8 * u, marginTop: 0.2 * u }}>Received {l.received}</Text> : null}
                </View>
              </View>
            </View>
          </Page>
        );
      })}
    </Document>
  );
  return renderToBuffer(doc);
}
