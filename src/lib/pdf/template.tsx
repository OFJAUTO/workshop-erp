import "server-only";
import type { ReactNode } from "react";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";

// Long words (part numbers, VINs) stay whole instead of being split with hyphens.
Font.registerHyphenationCallback((word) => [word]);

export const INK = "#111111";
export const GREY = "#6a6a6a";
export const LINE = "#d9d9d9";
export const CHIP = "#f2f2f2";
export const RED = "#b3261e";
export const AMBER = "#8a5a00";
export const GREEN = "#1b6b2f";

/**
 * One template for every PDF the workshop sends: the logo on the left, the company details on the
 * right, a big title with the number, two boxes, a table, totals, and a footer on every page.
 * White, black and grey only; A4 with proper margins.
 */
export const styles = StyleSheet.create({
  // No lineHeight anywhere above the footer: react-pdf drops a fixed footer whose page-number Text inherits one.
  page: { paddingTop: 34, paddingBottom: 82, paddingHorizontal: 42, fontFamily: "Helvetica", fontSize: 9.5, color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 10, marginBottom: 16 },
  logo: { width: 120, height: 56, objectFit: "contain", objectPosition: "left" },
  company: { alignItems: "flex-end", fontSize: 8.5, color: GREY, lineHeight: 1.4 },
  companyName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK },
  titleRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginBottom: 6 },
  title: { fontSize: 22, lineHeight: 1.15, fontFamily: "Helvetica-Bold", letterSpacing: 1.5 },
  number: { fontSize: 12, lineHeight: 1.15, fontFamily: "Helvetica-Bold", color: GREY, paddingBottom: 4 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 14, fontSize: 9, color: GREY },
  metaLabel: { fontFamily: "Helvetica-Bold", color: INK },
  boxes: { flexDirection: "row", gap: 12, marginTop: 16 },
  box: { flex: 1, borderWidth: 0.8, borderColor: LINE, borderRadius: 4, padding: 9 },
  boxTitle: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: GREY, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 },
  boxLine: { fontSize: 9.5 },
  boxStrong: { fontSize: 10.5, fontFamily: "Helvetica-Bold" },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: GREY, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 },
  groupTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: GREY, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 10, marginBottom: 2 },
  th: { flexDirection: "row", backgroundColor: CHIP, paddingVertical: 5, paddingHorizontal: 4, fontFamily: "Helvetica-Bold", fontSize: 8, color: GREY },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 5, paddingHorizontal: 4 },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 58, textAlign: "right" },
  cUnit: { width: 76, textAlign: "right" },
  cAmt: { width: 80, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cTag: { width: 74, textAlign: "right", fontSize: 7.5, fontFamily: "Helvetica-Bold" },
  lineTitle: { fontFamily: "Helvetica-Bold" },
  lineDetails: { fontSize: 8.5, color: GREY, marginTop: 1 },
  totals: { marginTop: 14, alignSelf: "flex-end", width: 280 },
  tRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  tLabel: { color: GREY },
  tTotal: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.2, borderTopColor: INK, marginTop: 4, paddingTop: 6, fontSize: 13, fontFamily: "Helvetica-Bold" },
  note: { marginTop: 14, padding: 9, borderWidth: 0.8, borderColor: LINE, borderRadius: 4, fontSize: 9 },
  footer: { position: "absolute", left: 42, right: 42, bottom: 26, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 6, fontSize: 7.5, color: GREY },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 },
  photo: { width: 118, height: 88, objectFit: "cover", borderRadius: 3, backgroundColor: CHIP },
  tag: { fontSize: 7.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.8 },
  item: { borderWidth: 0.8, borderColor: LINE, borderRadius: 4, padding: 8, marginTop: 6 },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  small: { fontSize: 8.5, color: GREY },
  checkRow: { flexDirection: "row", gap: 6, paddingVertical: 2, borderBottomWidth: 0.4, borderBottomColor: LINE },
});

export type Company = { name: string; address: string; phone: string; email: string; trn: string };

/** The company details from Settings, for the header of every PDF. */
export function companyOf(s: Settings): Company {
  return { name: String(s.company_name || "OFJ Automotive"), address: String(s.company_address ?? ""), phone: String(s.company_phone ?? ""), email: String(s.company_email ?? ""), trn: String(s.company_trn ?? "") };
}

export const SITE_HOST = PRODUCTION_SITE_URL.replace(/^https?:\/\//, "");

export function PdfDocument({ title, company, logo, footerLines, children }: { title: string; company: Company; logo: Buffer | null; footerLines: string[]; children: ReactNode }) {
  return (
    <Document title={title} author={company.name} creator={company.name} producer={company.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {logo ? <Image src={{ data: logo, format: "jpg" }} style={styles.logo} /> : <Text style={styles.companyName}>{company.name}</Text>}
          <View style={styles.company}>
            <Text style={styles.companyName}>{company.name}</Text>
            {company.address ? <Text>{company.address}</Text> : null}
            {company.phone || company.email ? <Text>{[company.phone, company.email].filter(Boolean).join("   ·   ")}</Text> : null}
            {company.trn ? <Text>TRN {company.trn}</Text> : null}
          </View>
        </View>
        {/* The footer sits before the content: react-pdf drops fixed elements placed after a block that wraps over pages. */}
        <View style={styles.footer} fixed>
          {footerLines.filter(Boolean).map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
          <View style={styles.footerRow}>
            <Text>Terms and conditions apply   ·   {SITE_HOST}/terms</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </View>
        {children}
      </Page>
    </Document>
  );
}

export function TitleBlock({ title, number, meta }: { title: string; number: string; meta: ({ label: string; value: string } | null)[] }) {
  return (
    <View>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.number}>{number}</Text>
      </View>
      <View style={styles.meta}>
        {meta
          .filter((m): m is { label: string; value: string } => !!m && !!m.value)
          .map((m) => (
            <Text key={m.label}>
              <Text style={styles.metaLabel}>{m.label}: </Text>
              {m.value}
            </Text>
          ))}
      </View>
    </View>
  );
}

export function InfoBoxes({ boxes }: { boxes: { title: string; strong: string; lines: (string | null | undefined)[] }[] }) {
  return (
    <View style={styles.boxes}>
      {boxes.map((b) => (
        <View key={b.title} style={styles.box}>
          <Text style={styles.boxTitle}>{b.title}</Text>
          <Text style={styles.boxStrong}>{b.strong}</Text>
          {b.lines
            .filter((l): l is string => !!l)
            .map((l, i) => (
              <Text key={i} style={styles.boxLine}>{l}</Text>
            ))}
        </View>
      ))}
    </View>
  );
}

export type PdfLine = { title: string; details?: string | null; qty: string; unit: string; amount: string; tag?: string | null };

export function LinesTable({ groups, currency = "AED" }: { groups: { label: string; lines: PdfLine[] }[]; currency?: string }) {
  return (
    <View style={styles.section}>
      <View style={styles.th}>
        <Text style={styles.cDesc}>Description</Text>
        <Text style={styles.cQty}>Qty / hours</Text>
        <Text style={styles.cUnit}>Unit price ({currency})</Text>
        <Text style={styles.cAmt}>Amount ({currency})</Text>
        <Text style={styles.cTag}>{""}</Text>
      </View>
      {groups.map((g) => (
        <View key={g.label}>
          <Text style={styles.groupTitle}>{g.label}</Text>
          {g.lines.map((l, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <View style={styles.cDesc}>
                <Text style={styles.lineTitle}>{l.title}</Text>
                {l.details ? <Text style={styles.lineDetails}>{l.details}</Text> : null}
              </View>
              <Text style={styles.cQty}>{l.qty}</Text>
              <Text style={styles.cUnit}>{l.unit}</Text>
              <Text style={styles.cAmt}>{l.amount}</Text>
              <Text style={[styles.cTag, { color: l.tag === "Urgent" ? RED : GREY }]}>{l.tag ?? ""}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function TotalsBlock({ rows, total, after = [] }: { rows: { label: string; value: string }[]; total: { label: string; value: string }; after?: { label: string; value: string }[] }) {
  return (
    <View style={styles.totals} wrap={false}>
      {rows.map((r) => (
        <View key={r.label} style={styles.tRow}>
          <Text style={styles.tLabel}>{r.label}</Text>
          <Text>{r.value}</Text>
        </View>
      ))}
      <View style={styles.tTotal}>
        <Text>{total.label}</Text>
        <Text>{total.value}</Text>
      </View>
      {after.map((r) => (
        <View key={r.label} style={styles.tRow}>
          <Text style={styles.tLabel}>{r.label}</Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{r.value}</Text>
        </View>
      ))}
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
