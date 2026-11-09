import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";
import type { Settings } from "@/lib/settings";
import type { Statement } from "@/lib/customer-statement";
import { loadLogo } from "./images";
import { InfoBoxes, PdfDocument, TitleRow, companyOf, styles } from "./template";

const m = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * THE customer statement and THE combined bill (9 November 2026, Section 3): one PDF per customer. The statement lists
 * every open job's document with its total, what was paid and what is due, then the payments (a cheque or transfer
 * still waiting for the bank marked so), credit on the account and the balance. The combined bill lists the chosen
 * proformas with each car's lines and the one total to pay; each car keeps its own tax invoice once paid.
 */
export async function renderStatementPdf(st: Statement, settings: Settings, kind: "statement" | "combined"): Promise<Buffer> {
  const logo = await loadLogo();
  const combined = kind === "combined";
  const doc = (
    <PdfDocument title={`${combined ? "Combined proforma" : "Statement"} ${st.customer.name}`} company={companyOf(settings)} logo={logo} footerLines={combined ? ["One payment for these cars: each car receives its own tax invoice once paid."] : []}>
      <TitleRow title={combined ? "COMBINED PROFORMA" : "STATEMENT OF ACCOUNT"} meta={[{ label: "Date", value: formatDate(st.asOf) }, { label: "Cars", value: String(st.docs.length) }]} />
      <InfoBoxes boxes={[{ title: "Customer", strong: st.customer.name, lines: [st.customer.phone ?? "", st.customer.trn ? `TRN ${st.customer.trn}` : ""].filter(Boolean) }, { title: combined ? "Total to pay" : "Balance", strong: m(combined ? st.totalDue : st.totalDue), lines: combined ? [] : [st.pending ? `Waiting for the bank ${m(st.pending)}` : "", st.credit ? `Credit on account ${m(st.credit)}` : "", `Balance once cleared ${m(st.balanceOnceCleared)}`].filter(Boolean) }]} />
      <View style={styles.th}>
        <Text style={{ flex: 1 }}>Car · document</Text>
        <Text style={{ width: 90, textAlign: "right" }}>Total</Text>
        <Text style={{ width: 90, textAlign: "right" }}>Paid</Text>
        <Text style={{ width: 90, textAlign: "right" }}>Due</Text>
      </View>
      {st.docs.map((d) => (
        <View key={(d.invoiceId ?? d.jobId ?? d.title) + d.title} wrap={d.lines.length > 12}>
          <View style={styles.tr} wrap={false}>
            <Text style={{ flex: 1, textTransform: "uppercase" }}>{d.title}{d.docNumber ? ` · ${d.docNumber}` : " · approved, no proforma yet"}{d.issuedAt ? ` · ${formatDate(d.issuedAt)}` : ""}</Text>
            <Text style={{ width: 90, textAlign: "right" }}>{d.total === null ? "–" : m(d.total)}</Text>
            <Text style={{ width: 90, textAlign: "right" }}>{m(d.paid)}</Text>
            <Text style={{ width: 90, textAlign: "right", fontWeight: 700 }}>{m(d.balance)}</Text>
          </View>
          {combined ? d.lines.map((l, i) => (
            <View key={i} style={{ flexDirection: "row", paddingVertical: 2, paddingLeft: 12 }} wrap={false}>
              <Text style={{ flex: 1, fontSize: 9, textTransform: "uppercase" }}>{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</Text>
              <Text style={{ width: 90, textAlign: "right", fontSize: 9 }}>{m(l.amount)}</Text>
            </View>
          )) : null}
        </View>
      ))}
      <View style={[styles.tr, { borderBottomWidth: 2 }]} wrap={false}>
        <Text style={{ flex: 1, fontWeight: 700 }}>{combined ? "TOTAL TO PAY" : "TOTAL DUE"}</Text>
        <Text style={{ width: 90, textAlign: "right", fontWeight: 700 }}>{m(st.totalDue)}</Text>
      </View>
      {!combined && st.payments.length ? (
        <View style={{ marginTop: 18 }}>
          <Text style={styles.smallTitle}>Payments</Text>
          {st.payments.map((p) => (
            <View key={p.number} style={styles.tr} wrap={false}>
              <Text style={{ width: 80 }}>{p.number}</Text>
              <Text style={{ width: 80 }}>{formatDate(p.receivedAt)}</Text>
              <Text style={{ flex: 1 }}>{p.method}{p.what ? ` · ${p.what}` : ""}{p.pending ? " · waiting for the bank" : ""}</Text>
              <Text style={{ width: 90, textAlign: "right" }}>{m(p.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
