/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import "server-only";
import { Document, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { PartLabel } from "../part-labels";
import { fitName, labelBoxes } from "../label-fit";
import { loadLogoMark } from "./images";
import { qrPng } from "./qr";

const MM = 72 / 25.4;

/**
 * THE part sticker (9 November 2026, Section 5; was the 6 November label): ONLY three things, nothing within 2.5 mm of
 * an edge. The QR on the left (19 mm, solid black) opens that part's page for signed-in staff; top right the OFJ mark
 * (no "AUTOMOTIVE" line, 14 mm wide, solid black); under it the PART NAME exactly as on the part line, large and bold,
 * shrinking or wrapping to fit and never cut. Every page is exactly the label (50 × 25 mm by default, from Settings),
 * one label per piece. `border` draws the label's outline (the test label).
 */
export async function renderPartLabelsPdf(labels: PartLabel[], size: { w: number; h: number }, opts: { border?: boolean } = {}): Promise<Buffer> {
  const w = size.w * MM;
  const h = size.h * MM;
  const box = labelBoxes(size.w, size.h);
  const [qrs, mark] = await Promise.all([Promise.all(labels.map((l) => qrPng(l.qr, 480))), loadLogoMark()]);
  const doc = (
    <Document title="Part labels" author="OFJ Automotive">
      {labels.map((l, i) => {
        const fit = fitName(l.name, box.rightW * MM, box.nameH * MM, 13, 4.5);
        return (
          <Page key={l.key} size={[w, h]} style={{ margin: 0, padding: 0, backgroundColor: "#fff", color: "#000", fontFamily: "Helvetica" }}>
            {opts.border ? <View fixed style={{ position: "absolute", left: 0.3 * MM, top: 0.3 * MM, width: w - 0.6 * MM, height: h - 0.6 * MM, borderWidth: 0.25 * MM, borderColor: "#000", borderStyle: "solid" }} /> : null}
            <Image src={{ data: qrs[i], format: "png" }} style={{ position: "absolute", left: box.edge * MM, top: ((size.h - box.qr) / 2) * MM, width: box.qr * MM, height: box.qr * MM }} />
            {mark ? <Image src={{ data: mark, format: "png" }} style={{ position: "absolute", left: (box.rightX + box.rightW - box.logoW) * MM, top: box.edge * MM, width: box.logoW * MM, height: box.logoH * MM }} /> : <Text style={{ position: "absolute", right: box.edge * MM, top: box.edge * MM, fontSize: 4 * MM, fontFamily: "Helvetica-Bold" }}>OFJ</Text>}
            <View style={{ position: "absolute", left: box.rightX * MM, top: box.nameTop * MM, width: box.rightW * MM, height: box.nameH * MM, justifyContent: "center" }}>
              {fit.lines.map((line, k) => (
                <Text key={k} style={{ fontSize: fit.size, fontFamily: "Helvetica-Bold", lineHeight: 1.08, textAlign: "left" }}>{line}</Text>
              ))}
            </View>
          </Page>
        );
      })}
    </Document>
  );
  return renderToBuffer(doc);
}
