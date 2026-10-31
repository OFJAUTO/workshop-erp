import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import type { MoneyRow as DocMoneyRow } from "@/lib/doc-totals";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Document, Font, Image, Link, Page, Path, Polygon, StyleSheet, Svg, Text, View, type TextProps } from "@react-pdf/renderer";
import { DIRHAM_PATH, DIRHAM_RATIO, DIRHAM_VIEWBOX, moneyDigits, type Currency } from "@/lib/money";
import { hoursQty } from "@/lib/format";
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

// Tight spacing (31 October 2026): a document that overflows a page by a little is drawn again with less air before a
// second page is used - every part takes a `tight` flag (React context is not allowed in a server module). Fonts never shrink.

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
  headerDivider: { paddingLeft: px(22), marginLeft: px(22) },
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
  contact: { borderTopWidth: px(3), borderTopColor: INK, paddingTop: px(9), flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: px(20), fontSize: px(10.5) },
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
/** "AED" on every document and screen, always two decimals (31 October 2026): the dirham symbol is no longer used. */
export const currencyOf = (s: Settings): Currency => { void s; return "aed"; };

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

export function PdfDocument({ title, company, logo, qr, footerLines = [], scanLabel = "Scan to view\nthis document online", uppercase = false, computerGenerated = false, tight = false, children }: { uppercase?: boolean; /** The tax invoice carries the "computer generated document" line; nothing else does. */ computerGenerated?: boolean; title: string; company: Company; logo: Buffer | null; qr?: Buffer | null; footerLines?: string[]; scanLabel?: string; /** 31 October 2026: drawn again with less air when it overflows a page by a little (fonts never shrink). */ tight?: boolean; children: ReactNode }) {
  // The owner's mockup (31 October 2026): ONE footer row under a thick rule - Tel, Web, Email and "Page X of Y". Lines
  // a document must carry (the tax invoice's computer-generated line, an LPO's instruction) and a QR sit just above it.
  const extra = [computerGenerated ? "This is a computer generated document which requires no stamp and signature." : null, ...footerLines].filter((x): x is string => !!x);
  const footerRoom = px(62) + extra.length * px(15) + (qr ? px(48) : 0);
  return (
    <Document title={title} author={company.tradingName} creator={company.tradingName} producer={company.tradingName}>
      <Page size="A4" style={[styles.page, { paddingTop: tight ? px(20) : px(30), paddingBottom: footerRoom }]}>
        <View
          style={[styles.header, tight ? { paddingBottom: px(12), marginBottom: px(14) } : {}]}
          fixed
          render={({ pageNumber }) =>
            pageNumber > 1 ? (
              <View style={styles.compact}>
                {logo ? <Image src={{ data: logo, format: "png" }} style={styles.logoSmall} /> : <Text style={styles.legalName}>{company.tradingName}</Text>}
                <Text style={styles.compactTitle}>{title}</Text>
              </View>
            ) : (
              <>
                {logo ? <Image src={{ data: logo, format: "png" }} style={[styles.logo, tight ? { height: px(64) } : {}]} /> : <Text style={styles.legalName}>{company.tradingName}</Text>}
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
          {extra.length || qr ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: px(20), marginBottom: px(8) }}>
              <View style={{ flex: 1 }}>
                {extra.map((l, i) => (
                  <Text key={i} style={styles.footerText}>{l}</Text>
                ))}
              </View>
              {qr ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: px(8) }}>
                  <Text style={[styles.footerText, { textAlign: "right", marginTop: 0 }]}>{scanLabel}</Text>
                  <Image src={{ data: qr, format: "png" }} style={{ width: px(48), height: px(48) }} />
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.contact}>
            {company.phone ? <Text><Text style={styles.contactLabel}>Tel   </Text>{company.phone}</Text> : null}
            {company.website ? <Text><Text style={styles.contactLabel}>Web   </Text>{company.website}</Text> : null}
            {company.email ? <Text><Text style={styles.contactLabel}>Email   </Text>{company.email}</Text> : null}
            <Text style={{ color: GREY }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </View>
        <View style={uppercase ? { textTransform: "uppercase" } : {}}>{children}</View>
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
        <View key={i} style={styles.tr} wrap={l.description.length + (l.details?.length ?? 0) > 600}>
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

export type PoDocRow = { partNumber: string | null; name: string; /** The positions on their own small line (ALL 4, FRONT PAIR…). */ sub?: string | null; qty: string; list: number; disc: number; net: number; vat: number; total: number };

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
        <View key={i} style={styles.tr} wrap={r.name.length + (r.sub?.length ?? 0) > 600}>
          <Text style={styles.cNo}>{i + 1}</Text>
          <Text style={cPn}>{r.partNumber ?? ""}</Text>
          <View style={styles.cDesc}>
            <Text style={styles.lineTitle}>{r.name}</Text>
            {r.sub ? <Text style={{ fontSize: 7, color: GREY, marginTop: 1 }}>{r.sub}</Text> : null}
          </View>
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
 * The end of a money document, as ONE block that never splits (the owner's mockup of 31 October 2026): the amount in
 * words on the left beside the totals box, then under a thin rule the bank details on the left and the note on the
 * right. It always follows the last lines on the same page - never alone on a page of its own. `before` (the customer
 * note, the safety warning) comes just above it; `after` (the warranty table) follows it.
 */
export function DocumentTail({ rows, words, bank = null, note = null, before = null, after = null, lead = null, tight = false }: { rows: DocMoneyRow[]; words: string; bank?: Company["bank"] | null; note?: string | null; before?: ReactNode; after?: ReactNode; /** The last lines held back by boxesWithTail: drawn first inside the block that never splits. */ lead?: ReactNode; tight?: boolean }) {
  const hasBank = !!bank && !!(bank.iban || bank.accountNumber);
  return (
    <>
      {before}
      <View wrap={false} style={{ marginTop: tight ? px(4) : px(10) }}>
        {lead}
        <View style={{ flexDirection: "row", gap: px(28), alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.smallTitle}>Amount in words</Text>
            <Text style={styles.words}>{words}</Text>
          </View>
          <View style={{ width: px(300) }}>
            <DocTotalsBox rows={rows} tight={tight} />
          </View>
        </View>
        {hasBank || note ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: px(28), marginTop: tight ? px(10) : px(20), paddingTop: tight ? px(9) : px(14), borderTopWidth: 1, borderTopColor: LINE }}>
            <View style={{ flex: 1 }}>
              {hasBank ? (
                <>
                  <Text style={styles.smallTitle}>Bank details</Text>
                  <Text style={styles.bankLine}>{[bank!.name, bank!.accountName].filter(Boolean).join(" · ")}</Text>
                  <Text style={styles.bankLine}>{[bank!.accountNumber ? `Account ${bank!.accountNumber}` : "", bank!.swift ? `SWIFT ${bank!.swift}` : ""].filter(Boolean).join(" · ")}</Text>
                  {bank!.iban ? <Text style={styles.bankLine}>IBAN {bank!.iban}</Text> : null}
                </>
              ) : null}
            </View>
            {note ? (
              <View style={{ flex: 1 }}>
                <Text style={[styles.smallTitle, { textAlign: "right" }]}>Note</Text>
                <Text style={{ textAlign: "right", color: GREY, fontSize: px(10.5) }}>{note}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {after}
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
  if (hours !== null && hours !== undefined) return hoursQty(hours);
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}


/* ------------------------------------------------------------------------------------------------------------------
 * The 14 October layout: three bordered boxes (Labour and services, Parts, Other charges), each with a pale heading
 * bar (the title in small caps, the line count on the right, no icons), the columns #, Description, Qty, Rate, Amount
 * (no VAT or total per line), numbers that start at 1 in every box, and a pale subtotal row; then the totals box on
 * the right with the labour discount and the round-off in bold green. Used by the quotation, the estimate, the
 * proforma and the tax invoice: only the title and the numbers change between them.
 * ------------------------------------------------------------------------------------------------------------------ */

export type SectionLine = { /** The line's quantity: QTY and PRICE print only when a line in the box has more than 1. */ quantity?: number; description: string; /** The short form (ALL 4, FRONT PAIR): its own small line under the name. */ positions?: string | null; details?: string | null; qty: string; rate: number; amount: number; complimentary?: boolean; /** "Complimentary" or "Included" (defaults to Complimentary). */ compWord?: string; /** The line's own discount: the green bold row under the description. */ discountPercent?: number; discountAmount?: number; tag?: string | null };

const sec = StyleSheet.create({
  box: { borderWidth: 1, borderColor: RULE, borderRadius: px(8), marginBottom: px(14), overflow: "hidden" },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: PALE, paddingVertical: px(7), paddingHorizontal: px(12) },
  barTitle: { fontSize: px(9.5), fontWeight: 700, color: INK, letterSpacing: 0.9, textTransform: "uppercase" },
  barCount: { fontSize: px(9.5), fontWeight: 600, color: GREY },
  head: { flexDirection: "row", paddingVertical: px(5), paddingHorizontal: px(12), borderBottomWidth: 1, borderBottomColor: LINE, fontSize: px(9), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", paddingVertical: px(6), paddingHorizontal: px(12) },
  sub: { flexDirection: "row", backgroundColor: PALE, paddingVertical: px(7), paddingHorizontal: px(12), fontWeight: 700 },
  no: { width: px(30), color: GREY },
  desc: { flex: 1, paddingRight: px(8) },
  qty: { width: px(54), textAlign: "right" },
  rate: { width: px(84), textAlign: "right" },
  amt: { width: px(96), textAlign: "right" },
  totals: { borderWidth: 1, borderColor: RULE, borderRadius: px(8), paddingVertical: px(10), paddingHorizontal: px(14) },
  tRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: px(3) },
  tLabel: { color: GREY },
  tGreen: { fontWeight: 800, color: GREEN },
  tRule: { borderTopWidth: 1, borderTopColor: RULE, marginTop: px(4), marginBottom: px(4) },
  tGrand: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: px(2), borderTopColor: INK, marginTop: px(4), paddingTop: px(8), fontSize: px(15), fontWeight: 800 },
});

/**
 * One bordered box of lines with its heading bar (the owner's mockup of 31 October 2026). Lines are numbered from 1
 * inside the box; QTY and PRICE only when a line in the box has a quantity above 1 (otherwise just AMOUNT); the pale
 * subtotal row only when the document's money rule says so (docMoneyRows / sectionSubtotalShown in src/lib/doc-totals.ts).
 * A box split by boxesWithTail keeps its numbering (`startAt`), the whole box's subtotal (`subtotalValue`) and the
 * whole box's columns (`showQtyFrom`).
 */
export function SectionBox({ title, lines, subtotalLabel, showSubtotal = false, descLabel = "Description", tight = false, startAt = 1, subtotalValue = null, showQtyFrom = null }: { title: string; lines: SectionLine[]; subtotalLabel: string; showSubtotal?: boolean; descLabel?: string; tight?: boolean; startAt?: number; subtotalValue?: number | null; showQtyFrom?: SectionLine[] | null }) {
  const sum = subtotalValue ?? lines.reduce((a, l) => a + l.amount, 0);
  const showQty = (showQtyFrom ?? lines).some((l) => (l.quantity ?? 1) > 1);
  const compWidth = showQty ? px(84 + 96) : px(160);
  const pad = tight ? px(4) : px(6);
  return (
    <View style={[sec.box, tight ? { marginBottom: px(9) } : {}]}>
      <View style={sec.bar} fixed>
        <Text style={sec.barTitle}>{title}</Text>
      </View>
      <View style={sec.head} fixed>
        <Text style={sec.no}>#</Text>
        <Text style={sec.desc}>{descLabel}</Text>
        {showQty ? <Text style={sec.qty}>Qty</Text> : null}
        {showQty ? <Text style={sec.rate}>Price</Text> : null}
        <Text style={sec.amt}>Amount</Text>
      </View>
      {lines.length === 0 ? (
        <View style={[sec.row, { paddingVertical: pad }]}>
          <Text style={[sec.desc, { color: GREY }]}>None</Text>
        </View>
      ) : null}
      {lines.map((l, i) => (
        // A short row stays in one piece; a very long description may continue on the next page (never clipped).
        <View key={i} style={[sec.row, { paddingVertical: pad }]} wrap={l.description.length + (l.details?.length ?? 0) > 600}>
          <Text style={sec.no}>{startAt + i}</Text>
          <View style={sec.desc}>
            <Text style={styles.lineTitle}>{cleanDocTitle(l.description)}</Text>
            {l.positions ? <Text style={{ fontSize: px(10), fontWeight: 700, color: GREY, letterSpacing: 0.3, marginTop: px(1) }}>{l.positions}</Text> : null}
            {l.tag ? <Text style={[styles.tag, { color: GREY }]}>{l.tag.toUpperCase()}</Text> : null}
            {l.details ? <Text style={[styles.lineDetails, { fontSize: px(10.5) }]}>{l.details}</Text> : null}
            {l.discountAmount && l.discountAmount > 0.004 ? (
              <Text style={{ color: GREEN, fontWeight: 800, fontSize: px(10.5), marginTop: px(2) }}>
                Discount{l.discountPercent ? ` ${moneyDigits(l.discountPercent).replace(/\.00$/, "")}%` : ""}: −AED {moneyDigits(l.discountAmount)}
              </Text>
            ) : null}
          </View>
          {showQty ? <Text style={sec.qty}>{l.qty}</Text> : null}
          {l.complimentary ? (
            // "COMPLIMENTARY (value AED 12,350.00)": the word, then the value on its own line - an amount never splits.
            <View style={{ width: compWidth }}>
              {(l.compWord ?? "Complimentary").split(/\s+(?=\(value )/).map((w, k) => (
                <Text key={k} style={[sec.rate, { width: compWidth, color: GREEN, fontWeight: 700 }, k ? { fontSize: px(10), fontWeight: 600 } : {}]}>{w}</Text>
              ))}
            </View>
          ) : (
            <>
              {showQty ? <Text style={sec.rate}>{moneyDigits(l.rate)}</Text> : null}
              <Text style={sec.amt}>{moneyDigits(l.amount)}</Text>
            </>
          )}
        </View>
      ))}
      {showSubtotal ? (
        <View style={[sec.sub, { paddingVertical: pad }]} wrap={false}>
          <Text style={sec.no}>{""}</Text>
          <Text style={sec.desc}>{subtotalLabel}</Text>
          <Text style={sec.amt}>{moneyDigits(sum)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** One box of lines as a document describes it; `boxesWithTail` draws them. */
export type BoxSpec = { key: string; title: string; descLabel?: string; lines: SectionLine[]; subtotalLabel: string; showSubtotal: boolean };

/**
 * The boxes of lines, and - when `keepLast` is on - the last two lines held back to travel with the totals (31 October
 * 2026: the totals never start a page alone). The held-back lines keep their numbers and their box's subtotal (the
 * whole box's sum); they go in DocumentTail's `lead`, inside the block that never splits. react-pdf ignores `break`
 * inside a box, so this is how the last lines move over.
 */
export function boxesWithTail(boxes: BoxSpec[], keepLast: boolean, tight: boolean): { body: ReactNode[]; lead: ReactNode[] } {
  const cut = new Map<string, number>();
  let need = keepLast ? 2 : 0;
  for (let i = boxes.length - 1; i >= 0 && need > 0; i--) {
    const n = boxes[i].lines.length;
    if (!n) continue;
    // A box with a subtotal moves at least two lines: its subtotal never sits under a single line on the new page.
    const take = Math.min(n, Math.max(need, boxes[i].showSubtotal ? 2 : 1));
    cut.set(boxes[i].key, n - take);
    need -= take;
  }
  const body: ReactNode[] = [];
  const lead: ReactNode[] = [];
  for (const b of boxes) {
    const c = cut.get(b.key);
    const sum = b.lines.reduce((a, l) => a + l.amount, 0);
    if (c === undefined) {
      body.push(<SectionBox key={b.key} tight={tight} title={b.title} descLabel={b.descLabel} lines={b.lines} subtotalLabel={b.subtotalLabel} showSubtotal={b.showSubtotal} />);
      continue;
    }
    if (c > 0) body.push(<SectionBox key={`${b.key}-a`} tight={tight} title={b.title} descLabel={b.descLabel} lines={b.lines.slice(0, c)} subtotalLabel={b.subtotalLabel} showSubtotal={false} />);
    lead.push(<SectionBox key={`${b.key}-b`} tight={tight} title={b.title} descLabel={b.descLabel} lines={b.lines.slice(c)} startAt={c + 1} subtotalLabel={b.subtotalLabel} showSubtotal={b.showSubtotal} subtotalValue={sum} showQtyFrom={b.lines} />);
  }
  return { body, lead };
}

/**
 * The totals box on the right (the owner's mockup): the rows from docMoneyRows - each amount once - with "AED" and two
 * decimals, the discounts in bold green, and TOTAL INCL. VAT large under a thick rule; payments and the balance due
 * follow inside the same box.
 */
export function DocTotalsBox({ rows, tight = false }: { rows: DocMoneyRow[]; tight?: boolean }) {
  const money = (v: number) => `AED ${moneyDigits(v)}`;
  return (
    <View style={[sec.totals, tight ? { paddingVertical: px(6) } : {}]} wrap={false}>
      {rows.map((r, i) => {
        if (r.kind === "total" || r.kind === "balance") {
          return (
            <View key={i} style={[sec.tGrand, i === 0 ? { borderTopWidth: 0, marginTop: 0, paddingTop: 0 } : {}]}>
              <Text style={[LABEL_CELL, { fontSize: px(10.5), fontWeight: 800, letterSpacing: 1.1, textTransform: "uppercase", color: r.kind === "balance" && r.value <= 0.004 ? GREEN : INK }]}>{r.label}</Text>
              <Text style={[AMOUNT_CELL, { fontSize: px(r.kind === "total" ? 18 : 15), fontWeight: 800 }]}>{money(r.value)}</Text>
            </View>
          );
        }
        const green = r.kind === "green";
        const minus = green || r.kind === "paid";
        return (
          <View key={i} style={sec.tRow}>
            <Text style={[green ? sec.tGreen : sec.tLabel, LABEL_CELL]}>{r.label}</Text>
            <Text style={[green ? sec.tGreen : {}, AMOUNT_CELL]}>{minus ? "− " : ""}{money(r.value)}</Text>
          </View>
        );
      })}
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
  box: { borderWidth: 1, borderColor: RULE, borderRadius: px(8), marginBottom: px(14), overflow: "hidden" },
  bar: { backgroundColor: INK, paddingVertical: px(7), paddingHorizontal: px(12) },
  barTitle: { fontSize: px(9.5), fontWeight: 800, color: "#FFFFFF", letterSpacing: 1.2, textTransform: "uppercase" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingTop: px(12), paddingBottom: px(10), paddingHorizontal: px(14), gap: px(12) },
  title: { fontSize: px(17), fontWeight: 800, color: INK },
  subtitle: { fontSize: px(10.5), color: GREY, marginTop: px(3) },
  priceLabel: { fontSize: px(8.5), fontWeight: 700, color: GREY, letterSpacing: 0.8, textTransform: "uppercase", textAlign: "right" },
  price: { fontSize: px(15), fontWeight: 800, color: INK, textAlign: "right", marginTop: px(2) },
  listHead: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: px(14), paddingBottom: px(4), borderBottomWidth: 1, borderBottomColor: INK },
  listHeadText: { fontSize: px(8.5), fontWeight: 700, color: GREY, letterSpacing: 0.8, textTransform: "uppercase" },
  item: { flexDirection: "row", alignItems: "flex-start", marginHorizontal: px(14), paddingVertical: px(6.5), borderBottomWidth: 0.75, borderBottomColor: LINE, gap: px(8) },
  // No flex on a Text inside a column: react-pdf then mis-measures it and the next line is drawn on top (30 Oct 2026).
  itemText: { fontSize: px(11), color: INK },
  warranty: { fontSize: px(10), color: GREY, textAlign: "right" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: px(6), paddingHorizontal: px(14), paddingTop: px(10) },
  badge: { flexDirection: "row", alignItems: "center", gap: px(4), backgroundColor: GREEN_SOFT, borderRadius: px(10), paddingVertical: px(4), paddingHorizontal: px(9) },
  badgeText: { fontSize: px(9.5), fontWeight: 700, color: GREEN },
  completion: { fontSize: px(10.5), fontWeight: 700, color: INK, paddingHorizontal: px(14), paddingTop: px(10), paddingBottom: px(10) },
  sub: { flexDirection: "row", justifyContent: "space-between", backgroundColor: PALE, paddingVertical: px(8), paddingHorizontal: px(14) },
  subText: { fontSize: px(11), fontWeight: 800, color: INK },
});

export type PackageSectionDoc = { title: string; subtitle: string; items: { label: string; warranty: string | null; note?: string | null }[]; complimentary: string[]; completion: string | null; explain?: string | null };

export function PackageSection({ doc, price, tight = false }: { doc: PackageSectionDoc; price: number; tight?: boolean }) {
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
        </View>
      </View>
      {doc.items.length ? (
        <>
          <View style={pkg.listHead} wrap={false}>
            <Text style={pkg.listHeadText}>What&apos;s included</Text>
            <Text style={pkg.listHeadText}>Warranty</Text>
          </View>
          {doc.items.map((i, k) => (
            <View key={k} style={[pkg.item, tight ? { paddingVertical: px(4) } : {}]} wrap={false}>
              <View style={{ paddingTop: px(1.6) }}><Tick /></View>
              <View style={{ flex: 1 }}>
                <Text style={pkg.itemText}>{i.label}</Text>
                {/* The cutting method in small grey under the PPF item (the owner's mockup); the ⓘ sentence stays on the web page. */}
                {i.note ? <Text style={{ fontSize: px(9.5), color: GREY, marginTop: px(1.5) }}>{i.note}</Text> : null}
              </View>
              <View style={{ width: px(150), paddingTop: px(1) }}><Text style={pkg.warranty}>{i.warranty ?? ""}</Text></View>
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
      {doc.completion ? <Text style={[pkg.completion, tight ? { paddingTop: px(6), paddingBottom: px(8) } : {}]}>Estimated completion: <Text style={{ fontWeight: 800 }}>{doc.completion}</Text></Text> : <View style={{ height: px(10) }} />}
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
