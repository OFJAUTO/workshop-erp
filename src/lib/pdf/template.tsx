import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Document, Font, Image, Link, Page, Path, Polygon, StyleSheet, Svg, Text, View, type TextProps } from "@react-pdf/renderer";
import { DIRHAM_PATH, DIRHAM_RATIO, DIRHAM_VIEWBOX, moneyDigits, type Currency } from "@/lib/money";
import { cleanDocTitle } from "@/lib/quotes";
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
export const px = (n: number) => Math.round(n * 0.75 * 100) / 100;

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
  logoSmall: { height: px(34), width: px(90), objectFit: "contain", objectPosition: "left" },
  compact: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" },
  compactTitle: { fontSize: px(11), fontWeight: 700, color: GREY, letterSpacing: 0.6, textTransform: "uppercase" },
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
  boxStrong: { fontSize: px(14), fontWeight: 700, marginBottom: px(3), textTransform: "uppercase" },
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

export function PdfDocument({ title, company, logo, qr, footerLines = [], scanLabel = "Scan to view\nthis document online", uppercase = false, computerGenerated = false, children }: { uppercase?: boolean; /** The tax invoice carries the "computer generated document" line; nothing else does. */ computerGenerated?: boolean; title: string; company: Company; logo: Buffer | null; qr?: Buffer | null; footerLines?: string[]; scanLabel?: string; children: ReactNode }) {
  return (
    <Document title={title} author={company.tradingName} creator={company.tradingName} producer={company.tradingName}>
      <Page size="A4" style={styles.page}>
        <View
          style={styles.header}
          fixed
          render={({ pageNumber }) =>
            pageNumber > 1 ? (
              <View style={styles.compact}>
                {logo ? <Image src={{ data: logo, format: "png" }} style={styles.logoSmall} /> : <Text style={styles.legalName}>{company.tradingName}</Text>}
                <Text style={styles.compactTitle}>{title}</Text>
              </View>
            ) : (
              <>
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
              </>
            )
          }
        />
        {/* The footer sits before the content: react-pdf drops fixed elements placed after a block that wraps over pages. */}
        <View style={styles.footer} fixed>
          <View style={styles.footerMain}>
            <View style={{ flex: 1 }}>
              {computerGenerated ? <Text style={styles.footerText}>This is a computer generated document which requires no stamp and signature.</Text> : null}
              {footerLines.filter(Boolean).map((l, i) => (
                <Text key={i} style={styles.footerText}>{l}</Text>
              ))}
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
        <View style={uppercase ? { textTransform: "uppercase", flexGrow: 1 } : { flexGrow: 1 }}>{children}</View>
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
      <View style={styles.th} fixed>
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
              <Text style={styles.lineTitle}>{cleanDocTitle(l.description)}</Text>
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

export type PoDocRow = { partNumber: string | null; name: string; qty: string; list: number; disc: number; net: number; vat: number; total: number };

/** The supplier copy's lines: part number and name in full, list price, discount, net, VAT and total. Long part numbers wrap inside the row. */
export function PoLinesTable({ rows, vatPercent = 5 }: { rows: PoDocRow[]; vatPercent?: number }) {
  const cPn = { width: px(128), paddingRight: px(8), fontSize: px(10.5) };
  const cList = { width: px(64), textAlign: "right" as const };
  const cDisc = { width: px(46), textAlign: "right" as const };
  const cNet = { width: px(72), textAlign: "right" as const };
  const cVat = { width: px(60), textAlign: "right" as const };
  const cTot = { width: px(76), textAlign: "right" as const };
  const sum = (k: "net" | "vat" | "total") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <View style={{ marginBottom: px(18) }}>
      <View style={styles.th} fixed>
        <Text style={[styles.cNo, { color: GREY }]}>#</Text>
        <Text style={cPn}>Part number</Text>
        <Text style={styles.cDesc}>Part</Text>
        <Text style={styles.cQty}>Qty</Text>
        <Text style={cList}>List</Text>
        <Text style={cDisc}>Disc %</Text>
        <Text style={cNet}>Net</Text>
        <Text style={cVat}>VAT {vatPercent}%</Text>
        <Text style={cTot}>Total</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.tr} wrap={false}>
          <Text style={styles.cNo}>{i + 1}</Text>
          <Text style={cPn}>{r.partNumber ?? ""}</Text>
          <Text style={[styles.cDesc, styles.lineTitle]}>{r.name}</Text>
          <Text style={styles.cQty}>{r.qty}</Text>
          <Text style={cList}>{moneyDigits(r.list)}</Text>
          <Text style={cDisc}>{r.disc ? `${Math.round(r.disc * 100) / 100}%` : ""}</Text>
          <Text style={cNet}>{moneyDigits(r.net)}</Text>
          <Text style={cVat}>{moneyDigits(r.vat)}</Text>
          <Text style={[cTot, { fontWeight: 600 }]}>{moneyDigits(r.total)}</Text>
        </View>
      ))}
      <View style={styles.subtotal} wrap={false}>
        <Text style={[styles.cNo, { paddingLeft: px(8), color: INK }]}>{""}</Text>
        <Text style={cPn}>{""}</Text>
        <Text style={styles.cDesc}>Order subtotal</Text>
        <Text style={styles.cQty}>{""}</Text>
        <Text style={cList}>{""}</Text>
        <Text style={cDisc}>{""}</Text>
        <Text style={cNet}>{moneyDigits(sum("net"))}</Text>
        <Text style={cVat}>{moneyDigits(sum("vat"))}</Text>
        <Text style={[cTot, { paddingRight: px(8) }]}>{moneyDigits(sum("total"))}</Text>
      </View>
    </View>
  );
}

/** Kept for older callers: a bold discount line under a table. New documents put the discount inside the table. */
export function DiscountLine({ amount, currency, label = "Discount on labour and services" }: { amount: number; currency: Currency; label?: string }) {
  if (!amount) return null;
  return (
    <View style={styles.discountLine} wrap={false}>
      <Text style={[LABEL_CELL, { fontWeight: 800, color: GREEN }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
        <Text style={{ fontWeight: 800 }}>− </Text>
        <Amount value={amount} currency={currency} weight={800} />
      </View>
    </View>
  );
}

export type TotalRow = { label: string; value: number; bold?: boolean; negative?: boolean };
/**
 * Section 13 (21 October): a totals row never lets a long label run over its amount. The label takes the room left
 * and wraps onto a second line ("Labour and services discount (10%)"); the amount keeps its own space on the right.
 */
const LABEL_CELL = { flex: 1, paddingRight: px(8) } as const;
const AMOUNT_CELL = { flexShrink: 0, textAlign: "right" as const } as const;
export type StatusBox = { title: string; value?: number | null; note?: string | null };

/** The totals on the right: gross, discount in bold, taxable, VAT, "Total AED" on a thick rule, paid, then the outlined Balance due box. */
export function TotalsBlock({ rows, total, after = [], status, currency }: { rows: TotalRow[]; total: { label: string; value: number }; after?: TotalRow[]; status?: StatusBox | null; currency: Currency }) {
  const row = (r: TotalRow) => (
    <View key={r.label} style={styles.tRow}>
      <Text style={[r.bold ? styles.tBold : styles.tLabel, LABEL_CELL]}>{r.label}</Text>
      <Text style={[r.bold ? styles.tBold : {}, AMOUNT_CELL]}>{r.negative ? "−" : ""}{moneyDigits(r.value)}</Text>
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
          <Text style={styles.smallTitle}>Bank details</Text>
          <Text style={styles.bankLine}>{[bank.name, bank.accountName].filter(Boolean).join(" · ")}</Text>
          <Text style={styles.bankLine}>{[bank.accountNumber ? `Account ${bank.accountNumber}` : "", bank.swift ? `SWIFT ${bank.swift}` : ""].filter(Boolean).join(" · ")}</Text>
          {bank.iban ? <Text style={styles.bankLine}>IBAN {bank.iban}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The end of a money document in a fixed order: the totals (never split), the amount in words with any
 * payments received, the notes, then the bank details as one block at the bottom of the last page, directly
 * above the footer.
 */
export function DocumentTail({ totals, words, payments = [], notes = null, bank = null }: { totals: ReactNode; words: string; payments?: PaymentLine[]; notes?: ReactNode; bank?: Company["bank"] | null }) {
  return (
    <>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: px(4) }}>{totals}</View>
      <View style={{ marginTop: px(14) }} wrap={false}>
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
      </View>
      {notes}
      {bank && (bank.iban || bank.accountNumber) ? (
        <View style={[styles.bank, { marginTop: "auto", paddingTop: px(14) }]} wrap={false}>
          <Text style={styles.smallTitle}>Bank details</Text>
          <Text style={styles.bankLine}>{[bank.name, bank.accountName].filter(Boolean).join(" · ")}</Text>
          <Text style={styles.bankLine}>{[bank.accountNumber ? `Account ${bank.accountNumber}` : "", bank.swift ? `SWIFT ${bank.swift}` : ""].filter(Boolean).join(" · ")}</Text>
          {bank.iban ? <Text style={styles.bankLine}>IBAN {bank.iban}</Text> : null}
        </View>
      ) : null}
    </>
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

/** A video on a document (23 October 2026): its picture (or a dark card) with a play sign, the label and "Watch video", all one link to the video on the customer's page. */
export type PdfVideo = { id: string; label: string; poster: Buffer | null; url: string | null; duration_s: number | null };

export function VideoCards({ videos }: { videos: PdfVideo[] }) {
  if (!videos.length) return null;
  const card = (v: PdfVideo) => (
    <View style={{ width: 118 }}>
      <View style={{ width: 118, height: 88, borderRadius: 3, backgroundColor: "#111111", overflow: "hidden", position: "relative" }}>
        {v.poster ? <Image src={{ data: v.poster, format: "jpg" }} style={{ width: 118, height: 88, objectFit: "cover" }} /> : null}
        <View style={{ position: "absolute", top: 29, left: 44, width: 30, height: 30, borderRadius: 15, backgroundColor: "#FFFFFF", opacity: 0.92, alignItems: "center", justifyContent: "center" }}>
          <Svg width={12} height={12} viewBox="0 0 12 12">
            <Polygon points="3,1 11,6 3,11" fill="#111111" />
          </Svg>
        </View>
      </View>
      <Text style={{ fontSize: 8, fontWeight: 700, marginTop: 3, textDecoration: v.url ? "underline" : "none" }}>Watch video{v.duration_s ? ` · ${v.duration_s}s` : ""}</Text>
      <Text style={{ fontSize: 7, color: "#5F6368" }}>{v.label}</Text>
    </View>
  );
  return (
    <View style={styles.photoRow}>
      {videos.map((v) =>
        v.url ? (
          <Link key={v.id} src={v.url} style={{ textDecoration: "none", color: "#111111" }}>
            {card(v)}
          </Link>
        ) : (
          <View key={v.id}>{card(v)}</View>
        ),
      )}
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


/* ------------------------------------------------------------------------------------------------------------------
 * The 14 October layout: three bordered boxes (Labour and services, Parts, Other charges), each with a pale heading
 * bar (the title in small caps, the line count on the right, no icons), the columns #, Description, Qty, Rate, Amount
 * (no VAT or total per line), numbers that start at 1 in every box, and a pale subtotal row; then the totals box on
 * the right with the labour discount and the round-off in bold green. Used by the quotation, the estimate, the
 * proforma and the tax invoice: only the title and the numbers change between them.
 * ------------------------------------------------------------------------------------------------------------------ */

export type SectionLine = { description: string; details?: string | null; qty: string; rate: number; amount: number; complimentary?: boolean; /** "Complimentary" or "Included" (defaults to Complimentary). */ compWord?: string; /** The line's own discount: the green bold row under the description. */ discountPercent?: number; discountAmount?: number; tag?: string | null };

const sec = StyleSheet.create({
  box: { borderWidth: 1, borderColor: RULE, borderRadius: px(8), marginBottom: px(14), overflow: "hidden" },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: PALE, paddingVertical: px(7), paddingHorizontal: px(12) },
  barTitle: { fontSize: px(9.5), fontWeight: 700, color: INK, letterSpacing: 0.9, textTransform: "uppercase" },
  barCount: { fontSize: px(9.5), fontWeight: 600, color: GREY },
  head: { flexDirection: "row", paddingVertical: px(5), paddingHorizontal: px(12), borderBottomWidth: 1, borderBottomColor: LINE, fontSize: px(9), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", paddingVertical: px(7), paddingHorizontal: px(12), borderBottomWidth: 1, borderBottomColor: LINE },
  sub: { flexDirection: "row", backgroundColor: PALE, paddingVertical: px(7), paddingHorizontal: px(12), fontWeight: 700 },
  no: { width: px(22), color: GREY },
  desc: { flex: 1, paddingRight: px(8), textTransform: "uppercase" },
  qty: { width: px(54), textAlign: "right" },
  rate: { width: px(84), textAlign: "right" },
  amt: { width: px(96), textAlign: "right" },
  totals: { width: px(262), borderWidth: 1, borderColor: RULE, borderRadius: px(8), paddingVertical: px(10), paddingHorizontal: px(14) },
  tRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: px(3) },
  tLabel: { color: GREY },
  tGreen: { fontWeight: 800, color: GREEN },
  tRule: { borderTopWidth: 1, borderTopColor: RULE, marginTop: px(4), marginBottom: px(4) },
  tGrand: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: px(2), borderTopColor: INK, marginTop: px(4), paddingTop: px(8), fontSize: px(15), fontWeight: 800 },
});

/** One bordered box of lines with its heading bar and subtotal row. Lines are numbered from 1 inside the box. */
export function SectionBox({ title, lines, subtotalLabel }: { title: string; lines: SectionLine[]; subtotalLabel: string }) {
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  return (
    <View style={sec.box}>
      <View style={sec.bar} fixed>
        <Text style={sec.barTitle}>{title}</Text>
        <Text style={sec.barCount}>{lines.length} line{lines.length === 1 ? "" : "s"}</Text>
      </View>
      <View style={sec.head} fixed>
        <Text style={sec.no}>#</Text>
        <Text style={sec.desc}>Description</Text>
        <Text style={sec.qty}>Qty</Text>
        <Text style={sec.rate}>Rate</Text>
        <Text style={sec.amt}>Amount</Text>
      </View>
      {lines.length === 0 ? (
        <View style={sec.row}>
          <Text style={[sec.desc, { color: GREY }]}>None</Text>
        </View>
      ) : null}
      {lines.map((l, i) => (
        <View key={i} style={sec.row} wrap={false}>
          <Text style={sec.no}>{i + 1}</Text>
          <View style={sec.desc}>
            <Text style={styles.lineTitle}>{cleanDocTitle(l.description)}</Text>
            {l.tag ? <Text style={[styles.tag, { color: GREY }]}>{l.tag.toUpperCase()}</Text> : null}
            {l.details ? <Text style={[styles.lineDetails, { fontSize: px(10.5) }]}>{l.details}</Text> : null}
            {l.discountAmount && l.discountAmount > 0.004 ? (
              <Text style={{ color: GREEN, fontWeight: 800, fontSize: px(10.5), marginTop: px(2) }}>
                Discount{l.discountPercent ? ` ${moneyDigits(l.discountPercent).replace(/\.00$/, "")}%` : ""}: −AED {moneyDigits(l.discountAmount)}
              </Text>
            ) : null}
          </View>
          <Text style={sec.qty}>{l.qty}</Text>
          {l.complimentary ? (
            <Text style={[sec.rate, { width: px(84 + 96), color: GREEN, fontWeight: 700 }]}>{l.compWord ?? "Complimentary"}</Text>
          ) : (
            <>
              <Text style={sec.rate}>{moneyDigits(l.rate)}</Text>
              <Text style={[sec.amt, { fontWeight: 600 }]}>{moneyDigits(l.amount)}</Text>
            </>
          )}
        </View>
      ))}
      <View style={sec.sub} wrap={false}>
        <Text style={sec.no}>{""}</Text>
        <Text style={sec.desc}>{subtotalLabel}</Text>
        <Text style={sec.qty}>{""}</Text>
        <Text style={sec.rate}>{""}</Text>
        <Text style={sec.amt}>{moneyDigits(sum)}</Text>
      </View>
    </View>
  );
}

export type MoneyRow = { label: string; value: number };

/**
 * The totals box, aligned right: the three sections, then the labour discount and the round-off in bold green, a
 * thin line, the subtotal before VAT, VAT, and the grand total in bold and larger. Any rows after it (Paid, Balance)
 * and the status box follow.
 */
export function TotalsBox({ sections, green = [], net, vatPercent, vat, total, totalLabel = "Grand total", after = [], status, currency }: { sections: MoneyRow[]; green?: MoneyRow[]; net: number; vatPercent: number; vat: number; total: number; totalLabel?: string; after?: TotalRow[]; status?: StatusBox | null; currency: Currency }) {
  return (
    <View style={{ width: px(262) }} wrap={false}>
      <View style={sec.totals}>
        {sections.map((r) => (
          <View key={r.label} style={sec.tRow}>
            <Text style={[sec.tLabel, LABEL_CELL]}>{r.label}</Text>
            <Text style={AMOUNT_CELL}>{moneyDigits(r.value)}</Text>
          </View>
        ))}
        {green.filter((r) => r.value).map((r) => (
          <View key={r.label} style={sec.tRow}>
            <Text style={[sec.tGreen, LABEL_CELL]}>{r.label}</Text>
            <Text style={[sec.tGreen, AMOUNT_CELL]}>− {currency === "aed" ? "AED " : ""}{moneyDigits(r.value)}</Text>
          </View>
        ))}
        <View style={sec.tRule} />
        <View style={sec.tRow}>
          <Text style={[sec.tLabel, LABEL_CELL]}>Subtotal before VAT</Text>
          <Text style={AMOUNT_CELL}>{moneyDigits(net)}</Text>
        </View>
        <View style={sec.tRow}>
          <Text style={[sec.tLabel, LABEL_CELL]}>VAT {vatPercent}%</Text>
          <Text style={AMOUNT_CELL}>{moneyDigits(vat)}</Text>
        </View>
        <View style={sec.tGrand}>
          <Text>{totalLabel}{currency === "aed" ? " AED" : ""}</Text>
          {currency === "aed" ? <Text>{moneyDigits(total)}</Text> : <Amount value={total} currency={currency} size={px(15)} weight={800} />}
        </View>
        {after.map((r) => (
          <View key={r.label} style={sec.tRow}>
            <Text style={[r.bold ? styles.tBold : sec.tLabel, LABEL_CELL]}>{r.label}</Text>
            <Text style={[r.bold ? styles.tBold : {}, AMOUNT_CELL]}>{r.negative ? "−" : ""}{moneyDigits(r.value)}</Text>
          </View>
        ))}
      </View>
      {status ? (
        <View style={[styles.statusBox, { marginTop: px(10) }]}>
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

/* ------------------------------------------------------------------------------------------------
   Section 9 (21 October): the PROTECTION PACKAGE section, ONE component for the estimate, the
   quotation, the proforma and the tax invoice. Read from packageDocOf (src/lib/packages.ts), the same
   model the web card uses. A green tick is drawn (the document font has no tick glyph).
   ------------------------------------------------------------------------------------------------ */
const GREEN_SOFT = "#E8F5EC";

function Tick({ size = 9, color = GREEN }: { size?: number; color?: string }) {
  return (
    <Svg width={px(size)} height={px(size)} viewBox="0 0 12 12">
      <Path d="M2 6.5 L4.8 9.2 L10 3.2" stroke={color} strokeWidth={1.8} fill="none" />
    </Svg>
  );
}

const pkg = StyleSheet.create({
  box: { borderWidth: 1.5, borderColor: INK, borderRadius: px(8), marginBottom: px(14), overflow: "hidden" },
  bar: { backgroundColor: INK, paddingVertical: px(7), paddingHorizontal: px(12) },
  barTitle: { fontSize: px(9.5), fontWeight: 800, color: "#FFFFFF", letterSpacing: 1.2, textTransform: "uppercase" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingTop: px(12), paddingBottom: px(10), paddingHorizontal: px(14), gap: px(12) },
  title: { fontSize: px(17), fontWeight: 800, color: INK },
  subtitle: { fontSize: px(10.5), color: GREY, marginTop: px(3) },
  priceLabel: { fontSize: px(8.5), fontWeight: 700, color: GREY, letterSpacing: 0.8, textTransform: "uppercase", textAlign: "right" },
  price: { fontSize: px(15), fontWeight: 800, color: INK, textAlign: "right", marginTop: px(2) },
  listHead: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: px(14), paddingBottom: px(4), borderBottomWidth: 1, borderBottomColor: INK },
  listHeadText: { fontSize: px(8.5), fontWeight: 700, color: GREY, letterSpacing: 0.8, textTransform: "uppercase" },
  item: { flexDirection: "row", alignItems: "center", marginHorizontal: px(14), paddingVertical: px(6.5), borderBottomWidth: 0.75, borderBottomColor: LINE, gap: px(8) },
  itemText: { flex: 1, fontSize: px(11), color: INK },
  warranty: { width: px(150), fontSize: px(10), color: GREY, textAlign: "right" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: px(6), paddingHorizontal: px(14), paddingTop: px(10) },
  badge: { flexDirection: "row", alignItems: "center", gap: px(4), backgroundColor: GREEN_SOFT, borderRadius: px(10), paddingVertical: px(4), paddingHorizontal: px(9) },
  badgeText: { fontSize: px(9.5), fontWeight: 700, color: GREEN },
  completion: { fontSize: px(10.5), fontWeight: 700, color: INK, paddingHorizontal: px(14), paddingTop: px(10), paddingBottom: px(10) },
  sub: { flexDirection: "row", justifyContent: "space-between", backgroundColor: PALE, paddingVertical: px(8), paddingHorizontal: px(14) },
  subText: { fontSize: px(11), fontWeight: 800, color: INK },
});

export type PackageSectionDoc = { title: string; subtitle: string; items: { label: string; warranty: string | null; note?: string | null }[]; complimentary: string[]; completion: string | null; explain?: string | null };

/** A small drawn ⓘ (the document font has no such glyph). */
function InfoMark({ size = 9 }: { size?: number }) {
  return (
    <Svg width={px(size)} height={px(size)} viewBox="0 0 12 12">
      <Path d="M6 1.2 A4.8 4.8 0 1 1 5.99 1.2 Z" stroke={GREY} strokeWidth={1} fill="none" />
      <Path d="M6 5.3 L6 9" stroke={GREY} strokeWidth={1.3} />
      <Path d="M6 3.2 L6 3.9" stroke={GREY} strokeWidth={1.4} />
    </Svg>
  );
}

export function PackageSection({ doc, price, subtotal, discount = null }: { doc: PackageSectionDoc; price: number; subtotal: number; /** The line's own discount, in bold green under the price. */ discount?: { percent: number | null; amount: number } | null }) {
  return (
    <View style={pkg.box}>
      <View style={pkg.bar} wrap={false}>
        <Text style={pkg.barTitle}>Protection package</Text>
      </View>
      <View style={pkg.head} wrap={false}>
        <View style={{ flex: 1 }}>
          <Text style={pkg.title}>{doc.title}</Text>
          {doc.subtitle ? <Text style={pkg.subtitle}>{doc.subtitle}</Text> : null}
        </View>
        <View>
          <Text style={pkg.priceLabel}>Package price</Text>
          <Text style={pkg.price}>AED {moneyDigits(price)}</Text>
          {discount && discount.amount > 0.004 ? (
            <Text style={{ fontSize: px(10), fontWeight: 800, color: GREEN, textAlign: "right", marginTop: px(2) }}>
              Discount{discount.percent ? ` ${moneyDigits(discount.percent).replace(/\.00$/, "")}%` : ""}: −AED {moneyDigits(discount.amount)}
            </Text>
          ) : null}
        </View>
      </View>
      {doc.items.length ? (
        <>
          <View style={pkg.listHead} wrap={false}>
            <Text style={pkg.listHeadText}>What&apos;s included</Text>
            <Text style={pkg.listHeadText}>Warranty</Text>
          </View>
          {doc.items.map((i, k) => (
            <View key={k} style={pkg.item} wrap={false}>
              <Tick />
              <View style={{ flex: 1 }}>
                <Text style={pkg.itemText}>{i.label}</Text>
                {i.note ? <Text style={{ fontSize: px(9.5), fontWeight: 700, color: INK, marginTop: px(1.5) }}>{i.note}</Text> : null}
                {i.note && doc.explain && doc.items.findIndex((x) => !!x.note) === k ? (
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: px(4), marginTop: px(2) }}>
                    <InfoMark />
                    <Text style={{ flex: 1, fontSize: px(8.5), color: GREY }}>{doc.explain}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={pkg.warranty}>{i.warranty ?? ""}</Text>
            </View>
          ))}
        </>
      ) : null}
      {doc.complimentary.length ? (
        <View style={pkg.badges} wrap={false}>
          {doc.complimentary.map((c, k) => (
            <View key={k} style={pkg.badge}>
              <Tick size={8} />
              <Text style={pkg.badgeText}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {doc.completion ? <Text style={pkg.completion}>Estimated completion: {doc.completion}</Text> : <View style={{ height: px(10) }} />}
      <View style={pkg.sub} wrap={false}>
        <Text style={pkg.subText}>Package subtotal</Text>
        <Text style={pkg.subText}>AED {moneyDigits(subtotal)}</Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------
   Section 12 (21 October): the WARRANTY table and the framed "YOUR OFJ WARRANTY" panel, ONE pair for
   the tax invoice and the warranty certificate. Read from warrantyCardOf (src/lib/warranty-data.ts),
   the same model the customer's pages use.
   ------------------------------------------------------------------------------------------------ */
export type WarrantyDocRow = { product: string; coverage: string; rollBatch: string; cut: string; darkness: string; period: string; validUntil: string };

const war = StyleSheet.create({
  head: { flexDirection: "row", paddingVertical: px(5), paddingHorizontal: px(10), borderBottomWidth: 1, borderBottomColor: LINE, fontSize: px(8.5), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", paddingVertical: px(6), paddingHorizontal: px(10), borderBottomWidth: 1, borderBottomColor: LINE, fontSize: px(9.5) },
  product: { width: "17%", paddingRight: px(5), fontWeight: 700 },
  coverage: { width: "19%", paddingRight: px(5) },
  roll: { width: "12%", paddingRight: px(5) },
  cut: { width: "13%", paddingRight: px(5) },
  dark: { width: "17%", paddingRight: px(5) },
  period: { width: "9%", paddingRight: px(5) },
  until: { width: "13%", textAlign: "right" },
});

export function WarrantySection({ rows, vehicle, startNote }: { rows: WarrantyDocRow[]; vehicle: string; startNote: string }) {
  // A few rows only: the table keeps together, moving to the next page whole rather than losing its heading.
  return (
    <View style={[sec.box, { marginTop: px(14) }]} wrap={false}>
      <View style={sec.bar} wrap={false}>
        <Text style={sec.barTitle}>Warranty</Text>
        <Text style={sec.barCount}>{startNote}</Text>
      </View>
      <Text style={{ fontSize: px(9.5), color: INK, paddingHorizontal: px(10), paddingTop: px(6), paddingBottom: px(4) }}>{vehicle}</Text>
      <View style={war.head} wrap={false}>
        <Text style={war.product}>Product</Text>
        <Text style={war.coverage}>Coverage</Text>
        <Text style={war.roll}>Roll / batch</Text>
        <Text style={war.cut}>Cutting method</Text>
        <Text style={war.dark}>Darkness (tint)</Text>
        <Text style={war.period}>Warranty</Text>
        <Text style={war.until}>Valid until</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={war.row} wrap={false}>
          <Text style={war.product}>{r.product}</Text>
          <Text style={war.coverage}>{r.coverage}</Text>
          <Text style={war.roll}>{r.rollBatch}</Text>
          <Text style={war.cut}>{r.cut}</Text>
          <Text style={war.dark}>{r.darkness}</Text>
          <Text style={war.period}>{r.period}</Text>
          <Text style={war.until}>{r.validUntil}</Text>
        </View>
      ))}
    </View>
  );
}

/** The certificate-like framed panel: the OFJ logo, YOUR OFJ WARRANTY, a large QR to the warranty page. */
export function WarrantyPanel({ logo, qr, certificateNo, car, status }: { logo: Buffer | null; qr: Buffer | null; certificateNo: string; car: string; status: string }) {
  return (
    <View wrap={false} style={{ marginTop: px(14), borderWidth: 2, borderColor: INK, borderRadius: px(10), padding: px(4) }}>
      <View style={{ borderWidth: 0.75, borderColor: GREY, borderRadius: px(7), paddingVertical: px(16), paddingHorizontal: px(20), flexDirection: "row", alignItems: "center", gap: px(18) }}>
        <View style={{ flex: 1 }}>
          {logo ? <Image src={{ data: logo, format: "png" }} style={{ height: px(46), width: px(110), objectFit: "contain", objectPosition: "left" }} /> : null}
          <Text style={{ fontSize: px(22), fontWeight: 800, color: INK, letterSpacing: 2.4, marginTop: px(10) }}>YOUR OFJ WARRANTY</Text>
          <Text style={{ fontSize: px(11), color: GREY, marginTop: px(3) }}>Scan to view and verify your warranty</Text>
          <View style={{ borderTopWidth: 0.75, borderTopColor: RULE, marginTop: px(10), paddingTop: px(7) }}>
            <Text style={{ fontSize: px(10), color: INK }}>Certificate no. {certificateNo}</Text>
            <Text style={{ fontSize: px(10), color: INK, marginTop: px(1.5) }}>{car}</Text>
            <Text style={{ fontSize: px(10), fontWeight: 800, color: INK, marginTop: px(3) }}>{status}</Text>
          </View>
        </View>
        {qr ? <Image src={{ data: qr, format: "png" }} style={{ width: px(150), height: px(150) }} /> : null}
      </View>
    </View>
  );
}
