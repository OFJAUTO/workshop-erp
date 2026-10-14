import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";
import type { Settings } from "@/lib/settings";
import { loadLogo } from "./images";
import { qrPng } from "./qr";
import { GREY, INK, InfoBoxes, LINE, PdfDocument, TitleRow, companyOf, px, styles } from "./template";

export type WarrantyInput = {
  customerName: string;
  car: string;
  plate: string | null;
  vin: string | null;
  film: string;
  installDate: string;
  validUntil: string;
  certificateNo: string;
  verifyUrl: string | null;
};

/** The PPF warranty certificate: logo, "OFJ PPF", customer, car, VIN, film, install date, valid until. White, black, grey. */
export async function renderWarrantyPdf(input: WarrantyInput, settings: Settings): Promise<Buffer> {
  const company = companyOf(settings);
  const brand = String(settings.ppf_brand_name || "OFJ PPF");
  const years = Number(settings.ppf_warranty_years) || 10;
  const [logo, qr] = await Promise.all([loadLogo(), input.verifyUrl ? qrPng(input.verifyUrl) : Promise.resolve(null)]);
  const doc = (
    <PdfDocument title={`${brand} warranty ${input.certificateNo}`} company={company} logo={logo} qr={qr} scanLabel={"Scan to open\nyour handover page"} footerLines={[`${brand} · ${years}-year warranty · ${company.tradingName}`]}>
      <TitleRow title="WARRANTY CERTIFICATE" meta={[{ label: "Certificate no.", value: input.certificateNo }, { label: "Issued", value: formatDate(input.installDate) }]} />
      <View style={{ marginTop: px(6), marginBottom: px(18), alignItems: "center" }}>
        <Text style={{ fontSize: px(34), fontWeight: 800, letterSpacing: 2, color: INK }}>{brand.toUpperCase()}</Text>
        <Text style={{ fontSize: px(12), color: GREY, marginTop: px(4), letterSpacing: 1.2, textTransform: "uppercase" }}>{years}-year paint protection film warranty</Text>
      </View>
      <InfoBoxes
        boxes={[
          { title: "Customer", strong: input.customerName, lines: [] },
          { title: "Vehicle", strong: input.car, lines: [input.plate, input.vin ? `VIN ${input.vin}` : null].filter((x): x is string => !!x) },
        ]}
      />
      <View style={{ borderWidth: 1, borderColor: LINE, borderRadius: px(6), padding: px(14), marginTop: px(10), flexDirection: "row", gap: px(18) }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.smallTitle}>Film</Text>
          <Text style={{ fontSize: px(13), fontWeight: 700 }}>{input.film}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.smallTitle}>Installed</Text>
          <Text style={{ fontSize: px(13), fontWeight: 700 }}>{formatDate(input.installDate)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.smallTitle}>Valid until</Text>
          <Text style={{ fontSize: px(13), fontWeight: 700 }}>{formatDate(input.validUntil)}</Text>
        </View>
      </View>
      <View style={{ marginTop: px(18) }}>
        <Text style={styles.smallTitle}>Warranty terms</Text>
        <Text style={{ fontSize: px(10.5), lineHeight: 1.5, color: INK }}>{String(settings.ppf_warranty_text || "")}</Text>
      </View>
      <View style={{ marginTop: px(16) }}>
        <Text style={styles.smallTitle}>Care instructions</Text>
        <Text style={{ fontSize: px(10.5), lineHeight: 1.5, color: INK }}>{String(settings.ppf_care_text || "")}</Text>
      </View>
      <View style={{ marginTop: px(26), flexDirection: "row", justifyContent: "space-between" }}>
        <View style={{ width: "45%", borderTopWidth: 1, borderTopColor: INK, paddingTop: px(6) }}>
          <Text style={{ fontSize: px(9), color: GREY }}>{company.tradingName}</Text>
        </View>
        <View style={{ width: "45%", borderTopWidth: 1, borderTopColor: LINE, paddingTop: px(6) }}>
          <Text style={{ fontSize: px(9), color: GREY }}>Issued electronically on {formatDate(input.installDate)}</Text>
        </View>
      </View>
    </PdfDocument>
  );
  return Buffer.from(await renderToBuffer(doc));
}
