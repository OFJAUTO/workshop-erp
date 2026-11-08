import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate } from "@/lib/format";
import type { Settings } from "@/lib/settings";
import type { PurchaseReturn } from "@/lib/purchase-returns";
import { loadLogo } from "./images";
import { InfoBoxes, PdfDocument, TitleRow, companyOf, styles } from "./template";

/**
 * THE RETURN NOTE for the supplier (8 November 2026, Section 8): PR number, the part, its part number, the quantity
 * going back, the supplier's own invoice number, the LPO and the reason. No customer details, no job number, no
 * prices - it travels with the part and comes back signed.
 */
export async function renderReturnNotePdf(r: PurchaseReturn, settings: Settings): Promise<Buffer> {
  const logo = await loadLogo();
  const doc = (
    <PdfDocument title={`Return note ${r.number}`} company={companyOf(settings)} logo={logo} footerLines={["Please credit this return against your invoice and send us the credit note."]}>
      <TitleRow title="RETURN NOTE" meta={[{ label: "Return no.", value: r.number }, { label: "Date", value: formatDate(r.requestedAt) }, { label: "Our LPO", value: r.poNumber ?? "" }]} />
      <InfoBoxes boxes={[{ title: "Returned to", strong: r.supplier, lines: [r.invoiceNumber ? `Your invoice ${r.invoiceNumber}` : "Your invoice: to follow"] }, { title: "Reason", strong: null, lines: [r.reason] }]} />
      <View style={styles.th}>
        <Text style={{ width: 130 }}>Part number</Text>
        <Text style={{ flex: 1 }}>Part</Text>
        <Text style={{ width: 70, textAlign: "right" }}>Qty</Text>
      </View>
      <View style={styles.tr} wrap={false}>
        <Text style={{ width: 130 }}>{r.partNumber ?? "–"}</Text>
        <Text style={{ flex: 1, textTransform: "uppercase" }}>{r.description}</Text>
        <Text style={{ width: 70, textAlign: "right" }}>{r.quantity}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 24, marginTop: 40 }} wrap={false}>
        <View style={{ flex: 1 }}>
          <Text style={styles.smallTitle}>Handed over by (OFJ)</Text>
          <Text style={{ marginTop: 28, borderTopWidth: 1, borderTopColor: "#111113", paddingTop: 4 }}>Name, signature, date</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.smallTitle}>Received by (supplier)</Text>
          <Text style={{ marginTop: 28, borderTopWidth: 1, borderTopColor: "#111113", paddingTop: 4 }}>Name, signature, stamp, date</Text>
        </View>
      </View>
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
