import "server-only";
import type { ReactNode } from "react";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Document, Font, Image, Page, Path, StyleSheet, Svg, Text, View, type TextProps } from "@react-pdf/renderer";
import { DIRHAM_PATH, DIRHAM_RATIO, DIRHAM_VIEWBOX, moneyDigits, type Currency } from "@/lib/money";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";

// Long words (part numbers, VINs) stay whole instead of being split with hyphens.
Font.registerHyphenationCallback((word) => [word]);

export const INK = "#111111";
export const GREY = "#6a6a6a";
export const LINE = "#d9d9d9";
export const PALE = "#f3f3f3";
export const RED = "#b3261e";
export const AMBER = "#8a5a00";
export const GREEN = "#1b6b2f";

/**
 * One template for every document the workshop sends: logo left, legal name and address beside the
 * TRN on the right, a thick rule, the title with its numbers in one row, pale grey boxes, tables with
 * VAT columns, totals and a status box, amount in words with payments and bank details, and a footer
 * on every page. White and black with thin rules; printer friendly. No lineHeight anywhere above the
 * footer: react-pdf drops a fixed footer whose page-number Text inherits one.
 */
export const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 112, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9, color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2.2, borderBottomColor: INK, paddingBottom: 10, marginBottom: 14 },
  logo: { width: 118, height: 54, objectFit: "contain", objectPosition: "left" },
  headerRight: { flexDirection: "row", alignItems: "stretch" },
  headerCol: { paddingHorizontal: 12, justifyContent: "center" },
  headerDivider: { borderLeftWidth: 0.8, borderLeftColor: INK },
  legalName: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  addressLine: { fontSize: 8, color: INK },
  trnLabel: { fontSize: 7.5, color: GREY, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 3 },
  trn: { fontSize: 14, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 },
  title: { fontSize: 24, fontFamily: "Helvetica-Bold", letterSpacing: 2 },
  metaRow: { flexDirection: "row", gap: 16 },
  metaLabel: { fontSize: 7, color: GREY, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 2 },
  metaValue: { fontSize: 9.5, fontFamily: "Helvetica-Bold" },
  boxes: { flexDirection: "row", gap: 10, marginBottom: 14 },
  box: { flex: 1, backgroundColor: PALE, borderRadius: 3, padding: 9 },
  boxTitle: { fontSize: 7, fontFamily: "Helvetica-Bold", color: GREY, letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 },
  boxStrong: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  boxRow: { flexDirection: "row", marginTop: 1.5 },
  boxLabel: { width: 52, color: GREY, fontSize: 8 },
  boxValue: { flex: 1, fontSize: 8.5 },
  sectionTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 8, marginBottom: 4 },
  th: { flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: INK, paddingVertical: 4, fontFamily: "Helvetica-Bold", fontSize: 7.5, color: GREY, textTransform: "uppercase", letterSpacing: 0.4 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4.5 },
  subtotal: { flexDirection: "row", backgroundColor: PALE, paddingVertical: 4.5, fontFamily: "Helvetica-Bold" },
  cNo: { width: 18 },
  cDesc: { flex: 1, paddingRight: 6 },
  cQty: { width: 44, textAlign: "right" },
  cRate: { width: 60, textAlign: "right" },
  cAmt: { width: 64, textAlign: "right" },
  cVat: { width: 52, textAlign: "right" },
  cTot: { width: 66, textAlign: "right" },
  lineTitle: { fontFamily: "Helvetica-Bold" },
  lineDetails: { fontSize: 7.5, color: GREY, marginTop: 1 },
  partNumber: { fontSize: 7.5, color: GREY, marginTop: 1 },
  discountLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: LINE, fontFamily: "Helvetica-Bold" },
  bottom: { flexDirection: "row", gap: 18, marginTop: 14 },
  leftCol: { flex: 1 },
  rightCol: { width: 230 },
  tRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  tLabel: { color: GREY },
  tBold: { fontFamily: "Helvetica-Bold", color: INK },
  tTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1.2, borderTopColor: INK, marginTop: 3, paddingTop: 6, paddingBottom: 4, fontSize: 12.5, fontFamily: "Helvetica-Bold" },
  statusBox: { borderWidth: 1.2, borderColor: INK, borderRadius: 3, padding: 9, marginTop: 8 },
  statusTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 3 },
  statusNote: { fontSize: 7.5, color: GREY, marginTop: 2 },
  words: { fontSize: 8.5, fontFamily: "Helvetica-Oblique", marginBottom: 8 },
  smallTitle: { fontSize: 7, fontFamily: "Helvetica-Bold", color: GREY, letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 },
  payRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderBottomWidth: 0.4, borderBottomColor: LINE, fontSize: 8 },
  bank: { marginTop: 16 },
  bankRow: { flexDirection: "row", fontSize: 8, marginTop: 1.5 },
  bankLabel: { width: 70, color: GREY },
  note: { marginTop: 12, padding: 8, borderWidth: 0.6, borderColor: LINE, borderRadius: 3, fontSize: 8.5 },
  footer: { position: "absolute", left: 36, right: 36, bottom: 24 },
  footerMain: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 7, paddingBottom: 7 },
  footerText: { fontSize: 7.5, color: GREY },
  footerStrong: { fontSize: 8, color: INK },
  qr: { width: 44, height: 44 },
  contact: { borderTopWidth: 2.2, borderTopColor: INK, paddingTop: 6, flexDirection: "row", justifyContent: "center", gap: 18, fontSize: 8 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 },
  photo: { width: 118, height: 88, objectFit: "cover", borderRadius: 3, backgroundColor: PALE },
  tag: { fontSize: 7.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 },
  item: { borderWidth: 0.6, borderColor: LINE, borderRadius: 3, padding: 8, marginTop: 6 },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  small: { fontSize: 8, color: GREY },
  checkRow: { flexDirection: "row", gap: 6, paddingVertical: 2, borderBottomWidth: 0.4, borderBottomColor: LINE },
  groupTitle: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: GREY, letterSpacing: 1, textTransform: "uppercase", marginTop: 8, marginBottom: 2 },
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
export function Amount({ value, currency, size = 9, bold = false, color = INK, align = "flex-end", style }: { value: number | null | undefined; currency: Currency; size?: number; bold?: boolean; color?: string; align?: "flex-start" | "flex-end"; style?: TextProps["style"] }) {
  const text = moneyDigits(value);
  const textStyle = { fontSize: size, fontFamily: bold ? "Helvetica-Bold" : "Helvetica", color };
  const extra = style ? (Array.isArray(style) ? style : [style]) : [];
  if (currency === "aed") return <Text style={[textStyle, ...extra]}>AED {text}</Text>;
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: align }, ...extra]}>
      <DirhamMark size={size} color={color} />
      <Text style={textStyle}>{text}</Text>
    </View>
  );
}

export function PdfDocument({ title, company, logo, qr, preparedBy, footerLines = [], children }: { title: string; company: Company; logo: Buffer | null; qr?: Buffer | null; preparedBy?: string | null; footerLines?: string[]; children: ReactNode }) {
  return (
    <Document title={title} author={company.tradingName} creator={company.tradingName} producer={company.tradingName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {logo ? <Image src={{ data: logo, format: "jpg" }} style={styles.logo} /> : <Text style={styles.legalName}>{company.tradingName}</Text>}
          <View style={styles.headerRight}>
            <View style={[styles.headerCol, { alignItems: "flex-end" }]}>
              <Text style={styles.legalName}>{company.legalName}</Text>
              {company.address.map((l, i) => (
                <Text key={i} style={styles.addressLine}>{l}</Text>
              ))}
            </View>
            {company.trn ? (
              <View style={[styles.headerCol, styles.headerDivider, { alignItems: "flex-start", paddingRight: 0 }]}>
                <Text style={styles.trnLabel}>Tax registration no.</Text>
                <Text style={styles.trn}>{company.trn}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {/* The footer sits before the content: react-pdf drops fixed elements placed after a block that wraps over pages. */}
        <View style={styles.footer} fixed>
          <View style={styles.footerMain}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              {preparedBy ? (
                <Text style={styles.footerStrong}>
                  Prepared by <Text style={{ fontFamily: "Helvetica-Bold" }}>{preparedBy}</Text>
                </Text>
              ) : null}
              <Text style={styles.footerText}>This is a computer generated document which requires no stamp and signature.</Text>
              {footerLines.filter(Boolean).map((l, i) => (
                <Text key={i} style={styles.footerText}>{l}</Text>
              ))}
              <Text style={styles.footerText}>Terms and conditions: {SITE_HOST}/terms</Text>
            </View>
            {qr ? <Image src={{ data: qr, format: "png" }} style={styles.qr} /> : null}
            <Text style={[styles.footerText, { width: 60, textAlign: "right", marginLeft: 10 }]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
          <View style={styles.contact}>
            {company.phone ? <Text>Tel {company.phone}</Text> : null}
            {company.website ? <Text>Web {company.website}</Text> : null}
            {company.email ? <Text>Email {company.email}</Text> : null}
          </View>
        </View>
        {children}
      </Page>
    </Document>
  );
}

export type Meta = { label: string; value: string } | null;

/** The big title with the document's numbers in one row beside it. */
export function TitleRow({ title, meta }: { title: string; meta: Meta[] }) {
  // A long title ("INSPECTION REPORT") with four meta columns must not run into them: it shrinks a little and may wrap.
  const long = title.length > 12;
  return (
    <View style={styles.titleRow}>
      <Text style={[styles.title, { flexShrink: 1, maxWidth: long ? 250 : 320, fontSize: long ? 19 : 24, letterSpacing: long ? 1.2 : 2 }]}>{title}</Text>
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

export type Box = { title: string; strong?: string | null; rows?: [string, string | null | undefined][]; lines?: (string | null | undefined)[] };

/** Pale grey boxes: customer, vehicle, supplier. */
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
              <Text key={i} style={styles.boxValue}>{l}</Text>
            ))}
          {(b.rows ?? [])
            .filter((r) => !!r[1])
            .map(([label, value]) => (
              <View key={label} style={styles.boxRow}>
                <Text style={styles.boxLabel}>{label}</Text>
                <Text style={styles.boxValue}>{value}</Text>
              </View>
            ))}
        </View>
      ))}
    </View>
  );
}

export type DocLine = { description: string; details?: string | null; partNumber?: string | null; qty: string; rate: number; amount: number; vat: number; total: number; complimentary?: boolean; tag?: string | null };

/** SERVICES or SPARE PARTS: #, Description, Qty, Rate, Amount, VAT 5%, Total, with a pale subtotal row. */
export function LinesTable({ title, lines, currency, vatPercent = 5, subtotalLabel, startAt = 1 }: { title: string; lines: DocLine[]; currency: Currency; vatPercent?: number; subtotalLabel: string; startAt?: number }) {
  const sum = (k: "amount" | "vat" | "total") => lines.reduce((a, l) => a + l[k], 0);
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.th}>
        <Text style={styles.cNo}>#</Text>
        <Text style={styles.cDesc}>Description</Text>
        <Text style={styles.cQty}>Qty</Text>
        <Text style={styles.cRate}>Rate</Text>
        <Text style={styles.cAmt}>Amount</Text>
        <Text style={styles.cVat}>VAT {vatPercent}%</Text>
        <Text style={styles.cTot}>Total</Text>
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
            <Text style={styles.lineTitle}>{l.description}</Text>
            {l.tag ? <Text style={[styles.tag, { color: GREY, marginTop: 1 }]}>{l.tag.toUpperCase()}</Text> : null}
            {l.partNumber ? <Text style={styles.partNumber}>{l.partNumber}</Text> : null}
            {l.details ? <Text style={styles.lineDetails}>{l.details}</Text> : null}
          </View>
          <Text style={styles.cQty}>{l.qty}</Text>
          {l.complimentary ? (
            <>
              <Text style={styles.cRate}>{""}</Text>
              <Text style={[styles.cAmt, { fontFamily: "Helvetica-Oblique" }]}>Complimentary</Text>
              <Text style={styles.cVat}>{""}</Text>
              <Text style={styles.cTot}>{""}</Text>
            </>
          ) : (
            <>
              <Text style={styles.cRate}>{moneyDigits(l.rate)}</Text>
              <Text style={styles.cAmt}>{moneyDigits(l.amount)}</Text>
              <Text style={styles.cVat}>{moneyDigits(l.vat)}</Text>
              <Text style={styles.cTot}>{moneyDigits(l.total)}</Text>
            </>
          )}
        </View>
      ))}
      <View style={styles.subtotal} wrap={false}>
        <Text style={styles.cNo}>{""}</Text>
        <Text style={styles.cDesc}>{subtotalLabel}</Text>
        <Text style={styles.cQty}>{""}</Text>
        <Text style={styles.cRate}>{""}</Text>
        <Text style={styles.cAmt}>{moneyDigits(sum("amount"))}</Text>
        <Text style={styles.cVat}>{moneyDigits(sum("vat"))}</Text>
        <Amount value={sum("total")} currency={currency} bold style={styles.cTot} />
      </View>
    </View>
  );
}

/** "Discount on labour and services", in bold under the services table. Never spread across lines. */
export function DiscountLine({ amount, currency, label = "Discount on labour and services" }: { amount: number; currency: Currency; label?: string }) {
  if (!amount) return null;
  return (
    <View style={styles.discountLine} wrap={false}>
      <Text>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ fontFamily: "Helvetica-Bold" }}>- </Text>
        <Amount value={amount} currency={currency} bold />
      </View>
    </View>
  );
}

export type TotalRow = { label: string; value: number; bold?: boolean; negative?: boolean };
export type StatusBox = { title: string; value?: number | null; note?: string | null };

/** The totals on the right: gross, discount, taxable, VAT, total in bold, paid, then the outlined status box. */
export function TotalsBlock({ rows, total, after = [], status, currency }: { rows: TotalRow[]; total: { label: string; value: number }; after?: TotalRow[]; status?: StatusBox | null; currency: Currency }) {
  const row = (r: TotalRow) => (
    <View key={r.label} style={styles.tRow}>
      <Text style={r.bold ? styles.tBold : styles.tLabel}>{r.label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {r.negative ? <Text style={r.bold ? styles.tBold : {}}>- </Text> : null}
        <Amount value={r.value} currency={currency} bold={!!r.bold} />
      </View>
    </View>
  );
  return (
    <View style={styles.rightCol} wrap={false}>
      {rows.map(row)}
      <View style={styles.tTotal}>
        <Text>{total.label}</Text>
        <Amount value={total.value} currency={currency} bold size={12.5} />
      </View>
      {after.map(row)}
      {status ? (
        <View style={styles.statusBox}>
          <Text style={styles.statusTitle}>{status.title}</Text>
          {status.value !== null && status.value !== undefined ? <Amount value={status.value} currency={currency} bold size={15} align="flex-start" /> : null}
          {status.note ? <Text style={styles.statusNote}>{status.note}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export type PaymentLine = { date: string; method: string; amount: number; note?: string | null };

/** Left of the totals: the amount in words, the payments received, and the bank transfer details with clear space above. */
export function WordsAndPayments({ words, payments, bank, currency, showBank = true }: { words: string; payments: PaymentLine[]; bank: Company["bank"]; currency: Currency; showBank?: boolean }) {
  return (
    <View style={styles.leftCol}>
      <Text style={styles.smallTitle}>Amount in words</Text>
      <Text style={styles.words}>{words}</Text>
      {payments.length ? (
        <View>
          <Text style={styles.smallTitle}>Payments received</Text>
          {payments.map((p, i) => (
            <View key={i} style={styles.payRow}>
              <Text>{p.date}  ·  {p.method}{p.note ? `  ·  ${p.note}` : ""}</Text>
              <Amount value={p.amount} currency={currency} size={8} />
            </View>
          ))}
        </View>
      ) : null}
      {showBank && (bank.iban || bank.accountNumber) ? (
        <View style={styles.bank}>
          <Text style={styles.smallTitle}>Bank transfer</Text>
          {bank.name ? <View style={styles.bankRow}><Text style={styles.bankLabel}>Bank</Text><Text>{bank.name}</Text></View> : null}
          {bank.accountName ? <View style={styles.bankRow}><Text style={styles.bankLabel}>Account name</Text><Text>{bank.accountName}</Text></View> : null}
          {bank.accountNumber ? <View style={styles.bankRow}><Text style={styles.bankLabel}>Account no.</Text><Text>{bank.accountNumber}</Text></View> : null}
          {bank.iban ? <View style={styles.bankRow}><Text style={styles.bankLabel}>IBAN</Text><Text>{bank.iban}</Text></View> : null}
          {bank.swift ? <View style={styles.bankRow}><Text style={styles.bankLabel}>SWIFT</Text><Text>{bank.swift}</Text></View> : null}
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
