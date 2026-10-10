import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Document, Font, Image, Page, Path, StyleSheet, Svg, Text, View, type TextProps } from "@react-pdf/renderer";
import { DIRHAM_PATH, DIRHAM_RATIO, DIRHAM_VIEWBOX, moneyDigits, type Currency } from "@/lib/money";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";

// Long words (part numbers, VINs) stay whole instead of being split with hyphens.
Font.registerHyphenationCallback((word) => [word]);

/** The document font, the same as the screens (docs/ofj-invoice-design.html): from the public folder, or the live site when the files are not beside the server. */
const FONT = "Plus Jakarta Sans";
const fontSrc = (file: string) => {
  const local = path.join(process.cwd(), "public", "fonts", file);
  return existsSync(local) ? local : `${PRODUCTION_SITE_URL}/fonts/${file}`;
};
Font.register({
  family: FONT,
  fonts: [
    { src: fontSrc("plus-jakarta-sans-400-normal.woff"), fontWeight: 400 },
    { src: fontSrc("plus-jakarta-sans-400-italic.woff"), fontWeight: 400, fontStyle: "italic" },
    { src: fontSrc("plus-jakarta-sans-600-normal.woff"), fontWeight: 600 },
    { src: fontSrc("plus-jakarta-sans-700-normal.woff"), fontWeight: 700 },
    { src: fontSrc("plus-jakarta-sans-800-normal.woff"), fontWeight: 800 },
  ],
});

// The design's colours: ink, grey text, two rule greys, the pale box grey.
export const INK = "#111113";
export const GREY = "#5F6368";
export const LINE = "#E4E4E7";
export const RULE = "#D4D4D8";
export const PALE = "#F4F4F5";
export const RED = "#b3261e";
export const AMBER = "#8a5a00";
export const GREEN = "#1b6b2f";

// The design is 794 px wide at 96 dpi; a point is 0.75 of a px.
const px = (n: number) => Math.round(n * 0.75 * 100) / 100;

/**
 * One template for every document the workshop sends, following docs/ofj-invoice-design.html: white
 * header with the logo on the left and the legal name, address and large TRN on the right over a thick
 * rule; the title with its numbers; two pale boxes; the Services and Spare parts tables with VAT columns
 * and a pale subtotal row; amount in words, payments and bank details on the left with the totals and
 * the Balance due box on the right; the footer row and the contact row on every page.
 */
export const styles = StyleSheet.create({
  page: { paddingTop: px(30), paddingBottom: px(150), paddingHorizontal: px(44), fontFamily: FONT, fontSize: px(12), color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: px(3), borderBottomColor: INK, paddingBottom: px(18), marginBottom: px(26) },
  logo: { height: px(80), width: px(155), objectFit: "contain", objectPosition: "left" },
  headerRight: { flexDirection: "row", alignItems: "stretch" },
  headerCol: { justifyContent: "center" },
  headerDivider: { borderLeftWidth: 1, borderLeftColor: RULE, paddingLeft: px(22), marginLeft: px(22) },
  legalName: { fontSize: px(12), fontWeight: 700, letterSpacing: 0.2 },
  addressLine: { fontSize: px(10.5), color: GREY, marginTop: px(2) },
  trnLabel: { fontSize: px(9), fontWeight: 700, color: GREY, letterSpacing: 0.9, textTransform: "uppercase", marginBottom: px(3) },
  trn: { fontSize: px(15), fontWeight: 800, letterSpacing: 0.4 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: px(18) },
  title: { fontSize: px(30), fontWeight: 800, letterSpacing: 0.6 },
  metaRow: { flexDirection: "row", gap: px(22) },
  metaLabel: { fontSize: px(9.5), fontWeight: 600, color: GREY, letterSpacing: 0.7, textTransform: "uppercase", marginBottom: px(4), textAlign: "right" },
  metaValue: { fontSize: px(13), fontWeight: 700, textAlign: "right" },
  boxes: { flexDirection: "row", gap: px(12), marginBottom: px(18) },
  box: { flex: 1, backgroundColor: PALE, borderRadius: px(8), paddingVertical: px(14), paddingHorizontal: px(16) },
  boxTitle: { fontSize: px(9.5), fontWeight: 700, color: GREY, letterSpacing: 0.9, textTransform: "uppercase", marginBottom: px(3) },
  boxStrong: { fontSize: px(14), fontWeight: 700, marginBottom: px(3) },
  boxLine: { fontSize: px(12), marginTop: px(1) },
  boxMuted: { fontSize: px(12), color: GREY, marginTop: px(1) },
  th: { flexDirection: "row", borderBottomWidth: px(2), borderBottomColor: INK, paddingBottom: px(6), fontWeight: 700, fontSize: px(9.5), color: GREY, textTransform: "uppercase", letterSpacing: 0.7 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: px(7) },
  subtotal: { flexDirection: "row", backgroundColor: PALE, paddingVertical: px(7), fontWeight: 700 },
  cNo: { width: px(24), color: GREY },
  cDesc: { flex: 1, paddingRight: px(8) },
  cQty: { width: px(54), textAlign: "right" },
  cRate: { width: px(76), textAlign: "right" },
  cAmt: { width: px(84), textAlign: "right" },
  cVat: { width: px(70), textAlign: "right" },
  cTot: { width: px(88), textAlign: "right" },
  lineTitle: { fontWeight: 600 },
  lineDetails: { color: GREY },
  bottom: { flexDirection: "row", gap: px(32), marginTop: px(18) },
  leftCol: { flex: 1 },
  rightCol: { width: px(262) },
  tRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: px(3) },
  tLabel: { color: GREY },
  tBold: { fontWeight: 800, color: INK },
  tTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: px(2), borderTopColor: INK, marginTop: px(3), paddingTop: px(8), paddingBottom: px(3), fontSize: px(15), fontWeight: 800 },
  statusBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: px(2), borderColor: INK, borderRadius: px(8), paddingVertical: px(9), paddingHorizontal: px(12), marginTop: px(6) },
  statusTitle: { fontSize: px(11), fontWeight: 800, letterSpacing: 0.9, textTransform: "uppercase" },
  statusNote: { fontSize: px(10), color: GREY, marginTop: px(2) },
  smallTitle: { fontSize: px(9.5), fontWeight: 700, color: GREY, letterSpacing: 0.9, textTransform: "uppercase", marginBottom: px(2) },
  words: { fontWeight: 600, marginBottom: px(12) },
  payRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: px(1.5) },
  bank: { marginTop: px(18) },
  bankLine: { marginTop: px(1) },
  note: { marginTop: px(14), padding: px(10), borderWidth: 1, borderColor: LINE, borderRadius: px(8) },
  footer: { position: "absolute", left: px(44), right: px(44), bottom: px(20) },
  footerMain: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderTopWidth: 1, borderTopColor: RULE, paddingTop: px(14), paddingBottom: px(12), gap: px(24) },
  footerText: { fontSize: px(10), color: GREY, marginTop: px(3) },
  footerStrong: { fontSize: px(10), color: INK, fontWeight: 600 },
  qr: { width: px(58), height: px(58) },
  contact: { borderTopWidth: px(3), borderTopColor: INK, paddingTop: px(10), flexDirection: "row", justifyContent: "center", alignItems: "baseline", gap: px(34), fontSize: px(10.5) },
  contactLabel: { fontSize: px(9), fontWeight: 700, color: GREY, letterSpacing: 0.9, textTransform: "uppercase", marginRight: px(8) },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 },
  photo: { width: 118, height: 88, objectFit: "cover", borderRadius: 3, backgroundColor: PALE },
  tag: { fontSize: px(9.5), fontWeight: 700, letterSpacing: 0.7 },
  item: { borderWidth: 1, borderColor: LINE, borderRadius: px(8), padding: 8, marginTop: 6 },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  small: { fontSize: px(10.5), color: GREY },
  checkRow: { flexDirection: "row", gap: 6, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: LINE },
  groupTitle: { fontSize: px(9.5), fontWeight: 700, color: GREY, letterSpacing: 0.9, textTransform: "uppercase", marginTop: 8, marginBottom: 2 },
  sectionTitle: { fontSize: px(9.5), fontWeight: 700, color: GREY, letterSpacing: 0.9, textTransform: "uppercase", marginTop: 8, marginBottom: 4 },
  discountLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: px(7), borderBottomWidth: 1, borderBottomColor: LINE, fontWeight: 800 },
});

export type Company = {
  tradingName: string;
  legalName: string;
  legalNameAr: string;
  address: string[];
  phone: string;
  email: string;
  website: string;
  trn: string;
  bank: { name: string; accountName: string; accountNumber: string; iban: string; swift: string };
};

/** The company details from Settings, for the header, footer and bank block of every document. */
export function companyOf(s: Settings): Company {
  return {
    tradingName: String(s.company_name || "OFJ Automotive"),
    legalName: String(s.company_legal_name || s.company_name || ""),
    legalNameAr: String(s.company_legal_name_ar ?? ""),
    address: [s.company_address_1, s.company_address_2, s.company_address_3].map((x) => String(x ?? "").trim()).filter(Boolean),
    phone: String(s.company_phone ?? ""),
    email: String(s.company_email ?? ""),
    website: String(s.company_website ?? ""),
    trn: String(s.company_trn ?? ""),
    bank: { name: String(s.bank_name ?? ""), accountName: String(s.bank_account_name ?? ""), accountNumber: String(s.bank_account_number ?? ""), iban: String(s.bank_iban ?? ""), swift: String(s.bank_swift ?? "") },
  };
}

export const SITE_HOST = PRODUCTION_SITE_URL.replace(/^https?:\/\//, "");
export const currencyOf = (s: Settings): Currency => (String(s.document_currency) === "aed" ? "aed" : "symbol");

/** The dirham symbol drawn at the size of the text beside it. */
export function DirhamMark({ size = 9, color = INK }: { size?: number; color?: string }) {
  const h = size * 0.82;
  return (
    <Svg viewBox={DIRHAM_VIEWBOX} width={h * DIRHAM_RATIO} height={h} style={{ marginRight: size * 0.18 }}>
      <Path d={DIRHAM_PATH} fill={color} />
    </Svg>
  );
}

/** An amount with the symbol before it (or "AED" when the setting says so), right-aligned inside its cell. */
export function Amount({ value, currency, size = px(12), bold = false, color = INK, align = "flex-end", style, weight }: { value: number | null | undefined; currency: Currency; size?: number; bold?: boolean; color?: string; align?: "flex-start" | "flex-end"; style?: TextProps["style"]; weight?: number }) {
  const text = moneyDigits(value);
  const textStyle = { fontSize: size, fontWeight: weight ?? (bold ? 700 : 400), color };
  const extra = style ? (Array.isArray(style) ? style : [style]) : [];
  if (currency === "aed") return <Text style={[textStyle, ...extra]}>AED {text}</Text>;
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: align }, ...extra]}>
      <DirhamMark size={size} color={color} />
      <Text style={textStyle}>{text}</Text>
    </View>
  );
}

export function PdfDocument({ title, company, logo, qr, preparedBy, footerLines = [], scanLabel = "Scan to view\nthis document online", children }: { title: string; company: Company; logo: Buffer | null; qr?: Buffer | null; preparedBy?: string | null; footerLines?: string[]; scanLabel?: string; children: ReactNode }) {
  return (
    <Document title={title} author={company.tradingName} creator={company.tradingName} producer={company.tradingName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {logo ? <Image src={{ data: logo, format: "png" }} style={styles.logo} /> : <Text style={styles.legalName}>{company.tradingName}</Text>}
          <View style={styles.headerRight}>
            <View style={styles.headerCol}>
              <Text style={styles.legalName}>{company.legalName}</Text>
              {company.address.map((l, i) => (
                <Text key={i} style={styles.addressLine}>{l}</Text>
              ))}
            </View>
            {company.trn ? (
              <View style={[styles.headerCol, styles.headerDivider]}>
                <Text style={styles.trnLabel}>Tax registration no.</Text>
                <Text style={styles.trn}>{company.trn}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {/* The footer sits before the content: react-pdf drops fixed elements placed after a block that wraps over pages. */}
        <View style={styles.footer} fixed>
          <View style={styles.footerMain}>
            <View style={{ flex: 1 }}>
              {preparedBy ? <Text style={styles.footerStrong}>Prepared by {preparedBy}</Text> : null}
              <Text style={styles.footerText}>This is a computer generated document which requires no stamp and signature.</Text>
              {footerLines.filter(Boolean).map((l, i) => (
                <Text key={i} style={styles.footerText}>{l}</Text>
              ))}
              <Text style={styles.footerText}>Terms and conditions apply · {SITE_HOST}/terms</Text>
              <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>
            {qr ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: px(10) }}>
                <Text style={[styles.footerText, { textAlign: "right", marginTop: 0 }]}>{scanLabel}</Text>
                <Image src={{ data: qr, format: "png" }} style={styles.qr} />
              </View>
            ) : null}
          </View>
          <View style={styles.contact}>
            {company.phone ? <Text><Text style={styles.contactLabel}>Tel   </Text>{company.phone}</Text> : null}
            {company.website ? <Text><Text style={styles.contactLabel}>Web   </Text>{company.website}</Text> : null}
            {company.email ? <Text><Text style={styles.contactLabel}>Email   </Text>{company.email}</Text> : null}
          </View>
        </View>
        {children}
      </Page>
    </Document>
  );
}

export type Meta = { label: string; value: string } | null;

/** The big title with the document's numbers in one row beside it: labels above, values below, right-aligned. */
export function TitleRow({ title, meta }: { title: string; meta: Meta[] }) {
  const long = title.length > 14;
  return (
    <View style={styles.titleRow}>
      <Text style={[styles.title, { flexShrink: 1, maxWidth: long ? 260 : 320, fontSize: long ? px(24) : px(30) }]}>{title}</Text>
      <View style={[styles.metaRow, { flexShrink: 0 }]}>
        {meta
          .filter((m): m is { label: string; value: string } => !!m && !!m.value)
          .map((m) => (
            <View key={m.label}>
              <Text style={styles.metaLabel}>{m.label}</Text>
              <Text style={styles.metaValue}>{m.value}</Text>
            </View>
          ))}
      </View>
    </View>
  );
}

export type Box = { title: string; strong?: string | null; rows?: [string, string | null | undefined][]; lines?: (string | null | undefined)[]; muted?: (string | null | undefined)[] };

/** Two pale boxes: "Billed to" (or Customer) and Vehicle. The name in bold, the details under it, grey notes last. */
export function InfoBoxes({ boxes }: { boxes: Box[] }) {
  return (
    <View style={styles.boxes}>
      {boxes.map((b) => (
        <View key={b.title} style={styles.box}>
          <Text style={styles.boxTitle}>{b.title}</Text>
          {b.strong ? <Text style={styles.boxStrong}>{b.strong}</Text> : null}
          {(b.lines ?? [])
            .filter((l): l is string => !!l)
            .map((l, i) => (
              <Text key={i} style={styles.boxLine}>{l}</Text>
            ))}
          {(b.rows ?? [])
            .filter((r) => !!r[1])
            .map(([label, value]) => (
              <Text key={label} style={styles.boxLine}><Text style={{ color: GREY }}>{label} </Text>{value}</Text>
            ))}
          {(b.muted ?? [])
            .filter((l): l is string => !!l)
            .map((l, i) => (
              <Text key={i} style={styles.boxMuted}>{l}</Text>
            ))}
        </View>
      ))}
    </View>
  );
}

export type DocLine = { description: string; details?: string | null; partNumber?: string | null; qty: string; rate: number; amount: number; vat: number; total: number; complimentary?: boolean; tag?: string | null };

/**
 * A lines table in the design's shape: the section name sits in the header row (#, Services, Qty, Rate,
 * Amount, VAT 5%, Total AED), a bold discount row when there is one, then the pale subtotal row.
 */
export function LinesTable({ title, lines, currency, vatPercent = 5, subtotalLabel, startAt = 1, discount = null }: { title: string; lines: DocLine[]; currency: Currency; vatPercent?: number; subtotalLabel: string; startAt?: number; discount?: { label: string; amount: number } | null }) {
  const sum = (k: "amount" | "vat" | "total") => lines.reduce((a, l) => a + l[k], 0);
  const dVat = discount ? Math.round(discount.amount * vatPercent) / 100 : 0;
  const money = currency === "aed" ? "AED" : "";
  return (
    <View style={{ marginBottom: px(18) }}>
      <View style={styles.th}>
        <Text style={[styles.cNo, { color: GREY }]}>#</Text>
        <Text style={styles.cDesc}>{title}</Text>
        <Text style={styles.cQty}>Qty</Text>
        <Text style={styles.cRate}>Rate</Text>
        <Text style={styles.cAmt}>Amount</Text>
        <Text style={styles.cVat}>VAT {vatPercent}%</Text>
        <Text style={styles.cTot}>Total {money}</Text>
      </View>
      {lines.length === 0 ? (
        <View style={styles.tr}>
          <Text style={[styles.cDesc, { color: GREY }]}>None</Text>
        </View>
      ) : null}
      {lines.map((l, i) => (
        <View key={i} style={styles.tr} wrap={false}>
          <Text style={styles.cNo}>{startAt + i}</Text>
          <View style={styles.cDesc}>
            <Text>
              <Text style={styles.lineTitle}>{l.description}</Text>
              {l.partNumber ? <Text style={styles.lineDetails}> · {l.partNumber}</Text> : null}
            </Text>
            {l.tag ? <Text style={[styles.tag, { color: GREY }]}>{l.tag.toUpperCase()}</Text> : null}
            {l.details ? <Text style={[styles.lineDetails, { fontSize: px(10.5) }]}>{l.details}</Text> : null}
          </View>
          <Text style={styles.cQty}>{l.qty}</Text>
          {l.complimentary ? (
            <Text style={[styles.cRate, { width: px(76 + 84 + 70 + 88), color: GREY }]}>Complimentary</Text>
          ) : (
            <>
              <Text style={styles.cRate}>{moneyDigits(l.rate)}</Text>
              <Text style={styles.cAmt}>{moneyDigits(l.amount)}</Text>
              <Text style={styles.cVat}>{moneyDigits(l.vat)}</Text>
              <Text style={[styles.cTot, { fontWeight: 600 }]}>{moneyDigits(l.total)}</Text>
            </>
          )}
        </View>
      ))}
      {discount && discount.amount ? (
        <View style={[styles.tr, { fontWeight: 800 }]} wrap={false}>
          <Text style={styles.cNo}>{""}</Text>
          <Text style={[styles.cDesc, { width: px(24) }]}>{discount.label}</Text>
          <Text style={styles.cAmt}>−{moneyDigits(discount.amount)}</Text>
          <Text style={styles.cVat}>−{moneyDigits(dVat)}</Text>
          <Text style={[styles.cTot, { fontWeight: 600 }]}>−{moneyDigits(discount.amount + dVat)}</Text>
        </View>
      ) : null}
      <View style={styles.subtotal} wrap={false}>
        <Text style={[styles.cNo, { paddingLeft: px(8), color: INK }]}>{""}</Text>
        <Text style={styles.cDesc}>{subtotalLabel}</Text>
        <Text style={styles.cQty}>{""}</Text>
        <Text style={styles.cRate}>{""}</Text>
        <Text style={styles.cAmt}>{moneyDigits(sum("amount") - (discount?.amount ?? 0))}</Text>
        <Text style={styles.cVat}>{moneyDigits(sum("vat") - dVat)}</Text>
        <Text style={[styles.cTot, { paddingRight: px(8) }]}>{moneyDigits(sum("total") - (discount?.amount ?? 0) - dVat)}</Text>
      </View>
    </View>
  );
}

/** Kept for older callers: a bold discount line under a table. New documents put the discount inside the table. */
export function DiscountLine({ amount, currency, label = "Discount on labour and services" }: { amount: number; currency: Currency; label?: string }) {
  if (!amount) return null;
  return (
    <View style={styles.discountLine} wrap={false}>
      <Text>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ fontWeight: 800 }}>− </Text>
        <Amount value={amount} currency={currency} weight={800} />
      </View>
    </View>
  );
}

export type TotalRow = { label: string; value: number; bold?: boolean; negative?: boolean };
export type StatusBox = { title: string; value?: number | null; note?: string | null };

/** The totals on the right: gross, discount in bold, taxable, VAT, "Total AED" on a thick rule, paid, then the outlined Balance due box. */
export function TotalsBlock({ rows, total, after = [], status, currency }: { rows: TotalRow[]; total: { label: string; value: number }; after?: TotalRow[]; status?: StatusBox | null; currency: Currency }) {
  const row = (r: TotalRow) => (
    <View key={r.label} style={styles.tRow}>
      <Text style={r.bold ? styles.tBold : styles.tLabel}>{r.label}</Text>
      <Text style={r.bold ? styles.tBold : {}}>{r.negative ? "−" : ""}{moneyDigits(r.value)}</Text>
    </View>
  );
  return (
    <View style={styles.rightCol} wrap={false}>
      {rows.map(row)}
      <View style={styles.tTotal}>
        <Text>{total.label}{currency === "aed" ? " AED" : ""}</Text>
        {currency === "aed" ? <Text>{moneyDigits(total.value)}</Text> : <Amount value={total.value} currency={currency} size={px(15)} weight={800} />}
      </View>
      {after.map(row)}
      {status ? (
        <View style={styles.statusBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{status.title}</Text>
            {status.note ? <Text style={styles.statusNote}>{status.note}</Text> : null}
          </View>
          {status.value !== null && status.value !== undefined ? <Amount value={status.value} currency={currency === "symbol" ? "symbol" : "aed"} size={px(16)} weight={800} /> : null}
        </View>
      ) : null}
    </View>
  );
}

export type PaymentLine = { date: string; method: string; amount: number; note?: string | null };

/** Left of the totals: the amount in words, the payments received, and the bank transfer details with clear space above. */
export function WordsAndPayments({ words, payments, bank, currency, showBank = true }: { words: string; payments: PaymentLine[]; bank: Company["bank"]; currency: Currency; showBank?: boolean }) {
  void currency;
  return (
    <View style={styles.leftCol}>
      <Text style={styles.smallTitle}>Amount in words</Text>
      <Text style={styles.words}>{words}</Text>
      {payments.length ? (
        <View>
          <Text style={styles.smallTitle}>Payments received</Text>
          {payments.map((p, i) => (
            <Text key={i} style={styles.bankLine}>{p.date} · {p.method}{p.note ? ` · ${p.note}` : ""} · AED {moneyDigits(p.amount)}</Text>
          ))}
        </View>
      ) : null}
      {showBank && (bank.iban || bank.accountNumber) ? (
        <View style={styles.bank}>
          <Text style={styles.smallTitle}>Bank transfer</Text>
          <Text style={styles.bankLine}>{[bank.name, bank.accountName].filter(Boolean).join(" · ")}</Text>
          <Text style={styles.bankLine}>{[bank.accountNumber ? `Account ${bank.accountNumber}` : "", bank.swift ? `SWIFT ${bank.swift}` : ""].filter(Boolean).join(" · ")}</Text>
          {bank.iban ? <Text style={styles.bankLine}>IBAN {bank.iban}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export function Photos({ photos }: { photos: Buffer[] }) {
  if (!photos.length) return null;
  return (
    <View style={styles.photoRow}>
      {photos.map((p, i) => (
        <Image key={i} src={{ data: p, format: "jpg" }} style={styles.photo} />
      ))}
    </View>
  );
}

export function Tag({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.tag, { color }]}>{text}</Text>;
}

/** The line's quantity text: "1.5 h" for labour, otherwise the number. */
export function qtyText(quantity: number, hours?: number | null) {
  if (hours !== null && hours !== undefined) return `${(Math.round(hours * 10) / 10).toFixed(1)} h`;
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}
