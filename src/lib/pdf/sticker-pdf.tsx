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
  | { kind: "part"; w: number; h: number; date: string; vin8: string; qr: string }
  | { kind: "battery"; size: number; installed: string; until: string; vin: string; title: string; valid: string; qr: string }
  | { kind: "service"; size: number; servicedOn: string; mileage: string; nextDate: string; nextMileage: string; vin: string; title: string; band: string; phone: string | null; qr: string };

/** The same stickers as the print pages, as a PDF for the printers that want one. One sticker per page. */
export async function renderStickersPdf(stickers: PdfSticker[]): Promise<Buffer> {
  const logo = await loadLogo();
  const qrs = await Promise.all(stickers.map((s) => qrPng(s.qr, 300)));
  const doc = (
    <Document title="Stickers">
      {stickers.map((s, i) => {
        const qr = qrs[i];
        if (s.kind === "part") {
          const pad = Math.min(s.w, s.h) * 0.05 * MM;
          return (
            <Page key={i} size={[s.w * MM, s.h * MM]} style={[styles.page, { padding: pad }]}>
              {logo ? <Image src={{ data: logo, format: "png" }} style={{ height: s.h * 0.16 * MM, width: s.w * 0.8 * MM, objectFit: "contain" }} /> : null}
              <Image src={{ data: qr, format: "png" }} style={{ width: Math.min(s.w, s.h) * 0.5 * MM, height: Math.min(s.w, s.h) * 0.5 * MM }} />
              <View style={{ alignItems: "center" }}>
                <Text style={{ fontSize: Math.max(4.5, s.h * 0.09 * MM), fontFamily: "Helvetica-Bold" }}>{s.date}</Text>
                <Text style={{ fontSize: Math.max(4.5, s.h * 0.09 * MM), fontFamily: "Helvetica-Bold" }}>{s.vin8}</Text>
              </View>
            </Page>
          );
        }
        const f = (s.size / 60) * MM;
        if (s.kind === "battery") {
          return (
            <Page key={i} size={[s.size * MM, s.size * MM]} style={[styles.page, { padding: 2 * f, justifyContent: "flex-start" }]}>
              {logo ? <Image src={{ data: logo, format: "png" }} style={{ height: 8 * f, width: 44 * f, objectFit: "contain" }} /> : null}
              <Text style={{ fontSize: 4.2 * f, fontFamily: "Helvetica-Bold", marginTop: 1.2 * f }}>{s.title.toUpperCase()}</Text>
              <View style={{ flexDirection: "row", width: "100%", marginTop: 1.5 * f, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 3 * f }}>Installed</Text>
                  <Text style={{ fontSize: 3 * f, fontFamily: "Helvetica-Bold" }}>{s.installed}</Text>
                  <Text style={{ fontSize: 3 * f, marginTop: 1 * f }}>Warranty until</Text>
                  <Text style={{ fontSize: 3 * f, fontFamily: "Helvetica-Bold" }}>{s.until}</Text>
                </View>
                <Image src={{ data: qr, format: "png" }} style={{ width: 22 * f, height: 22 * f }} />
              </View>
              <Text style={{ fontSize: 2.6 * f, fontFamily: "Helvetica-Bold", marginTop: 1.5 * f }}>{s.vin}</Text>
              <Text style={{ fontSize: 2.4 * f, marginTop: "auto" }}>{s.valid}</Text>
            </Page>
          );
        }
        return (
          <Page key={i} size={[s.size * MM, s.size * MM]} style={[styles.page, { padding: 2 * f, justifyContent: "flex-start" }]}>
            {logo ? <Image src={{ data: logo, format: "png" }} style={{ height: 7 * f, width: 44 * f, objectFit: "contain" }} /> : null}
            <Text style={{ fontSize: 4 * f, fontFamily: "Helvetica-Bold", marginTop: 1 * f }}>{s.title.toUpperCase()}</Text>
            <Text style={{ fontSize: 2.8 * f, marginTop: 1 * f }}>Serviced on {s.servicedOn}{s.mileage ? ` at ${s.mileage}` : ""}</Text>
            <View style={{ width: "100%", backgroundColor: "#000", padding: 1.2 * f, marginTop: 1 * f, alignItems: "center" }}>
              <Text style={{ color: "#fff", fontSize: 2.3 * f }}>{s.band.toUpperCase()}</Text>
              <Text style={{ color: "#fff", fontSize: 3.4 * f, fontFamily: "Helvetica-Bold", marginTop: 0.5 * f }}>{s.nextDate}{s.nextMileage ? `  ·  ${s.nextMileage}` : ""}</Text>
            </View>
            <View style={{ flexDirection: "row", width: "100%", marginTop: "auto", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 2.3 * f, fontFamily: "Helvetica-Bold" }}>{s.vin}</Text>
                {s.phone ? <Text style={{ fontSize: 2.3 * f, marginTop: 0.8 * f }}>{s.phone}</Text> : null}
              </View>
              <Image src={{ data: qr, format: "png" }} style={{ width: 17 * f, height: 17 * f }} />
            </View>
          </Page>
        );
      })}
    </Document>
  );
  return renderToBuffer(doc);
}
