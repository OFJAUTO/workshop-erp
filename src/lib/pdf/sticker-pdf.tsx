/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { loadLogo } from "./images";
import { qrPng } from "./qr";

const MM = 72 / 25.4;
const styles = StyleSheet.create({
  page: { backgroundColor: "#fff", color: "#000", fontFamily: "Helvetica", flexDirection: "column", alignItems: "center", justifyContent: "space-between" },
});

export type PdfSticker =
  | { kind: "part"; w: number; h: number; qr: string; jobNumber: string; name: string; index: number; count: number; date?: string | null }
  | { kind: "battery"; w: number; h: number; installed: string; until: string; months: number; vin: string; title: string; valid: string; qr: string; line: string }
  | { kind: "service"; w: number; h: number; servicedOn: string; mileage: string; nextDate: string; nextMileage: string; vin: string; plate: string; title: string; band: string; scanLine: string; phone: string | null; qr: string };

/** The same stickers as the print pages, as a PDF for the printers that want one. One sticker per page. */
export async function renderStickersPdf(stickers: PdfSticker[]): Promise<Buffer> {
  const logo = await loadLogo();
  const qrs = await Promise.all(stickers.map((s) => qrPng(s.qr, 300)));
  const doc = (
    <Document title="Stickers">
      {stickers.map((s, i) => {
        const qr = qrs[i];
        if (s.kind === "part") {
          const u = (s.h / 30) * MM;
          const qrSize = Math.min(s.h * 0.68, s.w * 0.48) * MM;
          return (
            <Page key={i} size={[s.w * MM, s.h * MM]} style={[styles.page, { padding: 1.5 * u }]}>
              <View style={{ flexDirection: "row", width: "100%", flex: 1, alignItems: "center" }}>
                <Image src={{ data: qr, format: "png" }} style={{ width: qrSize, height: qrSize }} />
                <View style={{ flex: 1, height: "100%", alignItems: "flex-end", justifyContent: "space-between", marginLeft: 2 * u }}>
                  {logo ? <Image src={{ data: logo, format: "png" }} style={{ height: 6 * u, width: "100%", objectFit: "contain" }} /> : null}
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 4.2 * u, fontFamily: "Helvetica-Bold" }}>{s.jobNumber}</Text>
                    {s.date ? <Text style={{ fontSize: 2.2 * u, marginTop: 0.6 * u }}>{s.date}</Text> : null}
                  </View>
                </View>
              </View>
              <View style={{ width: "100%", backgroundColor: "#000", padding: `${1 * u} ${1.5 * u}`, flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: "#fff", fontSize: (s.name.length > 80 ? 1.6 : s.name.length > 40 ? 2.1 : 2.7) * u, fontFamily: "Helvetica-Bold", flex: 1, marginRight: 2 * u }}>{s.name.toUpperCase()}</Text>
                <Text style={{ color: "#fff", fontSize: 2.7 * u, fontFamily: "Helvetica-Bold" }}>{s.index} OF {s.count}</Text>
              </View>
            </Page>
          );
        }
        const u = (s.w / 50) * MM;
        if (s.kind === "battery") {
          return (
            <Page key={i} size={[s.w * MM, s.h * MM]} style={[styles.page, { padding: 3 * u }]}>
              {logo ? <Image src={{ data: logo, format: "png" }} style={{ height: 8 * u, width: 42 * u, objectFit: "contain" }} /> : null}
              <Text style={{ fontSize: 4.2 * u, fontFamily: "Helvetica-Bold", textAlign: "center" }}>{s.title.toUpperCase()}</Text>
              <Text style={{ fontSize: 3 * u, fontFamily: "Helvetica-Bold", textAlign: "center" }}>{s.line}</Text>
              <Text style={{ fontSize: 3 * u }}>Installed {s.installed}</Text>
              <View style={{ width: "100%", backgroundColor: "#000", padding: 2 * u, alignItems: "center" }}>
                <Text style={{ color: "#fff", fontSize: 2.6 * u }}>WARRANTY UNTIL</Text>
                <Text style={{ color: "#fff", fontSize: 5.4 * u, fontFamily: "Helvetica-Bold", marginTop: 0.6 * u }}>{s.until}</Text>
                <Text style={{ color: "#fff", fontSize: 2.6 * u, marginTop: 0.6 * u }}>{s.months} months</Text>
              </View>
              <Image src={{ data: qr, format: "png" }} style={{ width: 22 * u, height: 22 * u }} />
              <Text style={{ fontSize: 3.4 * u, fontFamily: "Helvetica-Bold", letterSpacing: 0.6, textAlign: "center" }}>{s.vin}</Text>
              <Text style={{ fontSize: 2.6 * u, textAlign: "center" }}>{s.valid}</Text>
            </Page>
          );
        }
        return (
          <Page key={i} size={[s.w * MM, s.h * MM]} style={[styles.page, { padding: 3 * u }]}>
            {logo ? <Image src={{ data: logo, format: "png" }} style={{ height: 8 * u, width: 42 * u, objectFit: "contain" }} /> : null}
            <Text style={{ fontSize: 4.6 * u, fontFamily: "Helvetica-Bold", textAlign: "center" }}>{s.title.toUpperCase()}</Text>
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 3 * u }}>Serviced on {s.servicedOn}</Text>
              {s.mileage ? <Text style={{ fontSize: 3 * u }}>at {s.mileage}</Text> : null}
            </View>
            <View style={{ width: "100%", backgroundColor: "#000", padding: 2 * u, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 2.4 * u, textAlign: "center" }}>{s.band.toUpperCase()}</Text>
              <Text style={{ color: "#fff", fontSize: 4.6 * u, fontFamily: "Helvetica-Bold", marginTop: 0.8 * u }}>{s.nextDate}</Text>
              {s.nextMileage ? <Text style={{ color: "#fff", fontSize: 3.4 * u, fontFamily: "Helvetica-Bold", marginTop: 0.5 * u }}>{s.nextMileage}</Text> : null}
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 4 * u, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 }}>{s.plate}</Text>
              <Text style={{ fontSize: 2.6 * u, marginTop: 0.6 * u }}>{s.vin}</Text>
            </View>
            <Image src={{ data: qr, format: "png" }} style={{ width: 22 * u, height: 22 * u }} />
            <Text style={{ fontSize: 2.6 * u, fontFamily: "Helvetica-Bold", textAlign: "center" }}>{s.scanLine}</Text>
            {s.phone ? <Text style={{ fontSize: 2.8 * u }}>{s.phone}</Text> : null}
          </Page>
        );
      })}
    </Document>
  );
  return renderToBuffer(doc);
}
