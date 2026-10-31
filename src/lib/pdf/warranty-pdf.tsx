import "server-only";
import { customerWarrantyTitle } from "@/lib/warranty";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";
import type { Settings } from "@/lib/settings";
import { TERMS_LABELS, type TermsKey } from "@/lib/warranty";
import type { WarrantyCard } from "@/lib/warranty-data";
import { loadLogo } from "./images";
import { qrPng } from "./qr";
import { INK, InfoBoxes, PdfDocument, TitleRow, WarrantyPanel, WarrantySection, companyOf, px, styles } from "./template";

/**
 * The warranty certificate (Section 12): the same card as the tax invoice - the WARRANTY table per product and the
 * framed "YOUR OFJ WARRANTY" panel with its QR - then the short terms per product and the PPF care instructions.
 * No prices. White, black, grey.
 */
export async function renderWarrantyPdf(card: WarrantyCard, verifyUrl: string, settings: Settings): Promise<Buffer> {
  const company = companyOf(settings);
  const [logo, qr, panelQr] = await Promise.all([loadLogo(), qrPng(verifyUrl), qrPng(verifyUrl, 420)]);
  const termKeys = Array.from(new Set<TermsKey>([...card.rows.map((r) => r.product), ...(card.mechanical ? (["mechanical"] as TermsKey[]) : [])]));
  const doc = (
    <PdfDocument title={`OFJ warranty ${card.certificateNo}`} company={company} logo={logo} qr={qr} scanLabel={"Scan to view and\nverify your warranty"} footerLines={[`Warranty ${card.certificateNo} · ${company.tradingName}`]}>
      <TitleRow title="WARRANTY CERTIFICATE" meta={[{ label: "Certificate no.", value: card.certificateNo }, { label: "Reference", value: card.jobNumber }, card.handoverDay ? { label: "Handed over", value: formatDate(card.handoverDay) } : null]} />
      <InfoBoxes boxes={[{ title: "Vehicle", strong: [card.car, card.colour].filter(Boolean).join(" · "), lines: [card.plate, card.vin ? `VIN ${card.vin}` : null] }, { title: "Status", strong: card.status.title, lines: [card.status.checkDate ? `10-day check completed ${formatDate(card.status.checkDate)}` : card.status.manual ? `Activated by OFJ Automotive ${formatDate(card.status.manual.at)}` : null] }]} />
      <WarrantySection
        vehicle={[card.car, card.plate, card.vin ? `VIN ${card.vin}` : null].filter(Boolean).join(" · ")}
        startNote={card.handoverDay ? `From the handover on ${formatDate(card.handoverDay)}` : "Starts on the handover day"}
        rows={card.rows.map((r) => ({ product: r.name, coverage: r.coverage, rollBatch: r.rollBatch ?? "—", cut: r.cut ?? "—", darkness: r.darkness ?? "—", period: r.period, validUntil: r.validUntil ? formatDate(r.validUntil) : "From handover" }))}
      />
      <WarrantyPanel logo={logo} qr={panelQr} certificateNo={card.certificateNo} car={[card.car, card.plate].filter(Boolean).join(" · ")} status={customerWarrantyTitle(card.status)} />
      <View style={{ marginTop: px(16) }}>
        {termKeys.map((k) => (
          <View key={k} style={{ marginBottom: px(10) }} wrap={false}>
            <Text style={styles.smallTitle}>{TERMS_LABELS[k]}</Text>
            <Text style={{ fontSize: px(10.5), lineHeight: 1.5, color: INK }}>{card.terms[k].short}</Text>
          </View>
        ))}
        {card.rows.some((r) => r.product === "ppf") && settings.ppf_care_text ? (
          <View style={{ marginBottom: px(10) }} wrap={false}>
            <Text style={styles.smallTitle}>Care instructions</Text>
            <Text style={{ fontSize: px(10.5), lineHeight: 1.5, color: INK }}>{String(settings.ppf_care_text)}</Text>
          </View>
        ) : null}
      </View>
    </PdfDocument>
  );
  return Buffer.from(await renderToBuffer(doc));
}
