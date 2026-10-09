import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatDateTime } from "@/lib/format";
import { feeNotice } from "@/lib/jobs";
import type { QuoteBundle } from "@/lib/quote-data";
import { URGENCY_LABELS, isHidden, lineQuantityText, lineTotal, lineUnitPrice, money, quoteTotals } from "@/lib/quotes";
import type { Settings } from "@/lib/settings";
import { formatPlate } from "@/lib/types";
import { loadLogo } from "./images";
import { InfoBoxes, LinesTable, PdfDocument, TitleBlock, TotalsBlock, companyOf, styles, type PdfLine } from "./template";

/** The customer's quotation or estimate as a PDF: no internal costs, margins, hidden lines or bank charges. */
export async function renderQuotePdf(bundle: QuoteBundle, settings: Settings): Promise<Buffer> {
  const { quotation: q, customer, vehicle, job, creatorName } = bundle;
  const isEstimate = q.kind === "estimate";
  const lines = bundle.lines.filter((l) => l.is_active && !isHidden(l));
  const totals = quoteTotals(lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const order: string[] = [];
  const groups = new Map<string, PdfLine[]>();
  for (const l of lines) {
    const label = l.group_label ?? (l.line_type === "part" ? "Parts" : "Work");
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push({
      title: l.title,
      details: [l.details, l.discount_percent ? `${l.discount_percent}% discount applied` : null].filter(Boolean).join("   ·   ") || null,
      qty: lineQuantityText(l),
      unit: money(lineUnitPrice(l)),
      amount: money(lineTotal(l)),
      tag: l.urgency && !isEstimate ? URGENCY_LABELS[l.urgency] : null,
    });
  }
  const company = companyOf(settings);
  const logo = await loadLogo();
  const carName = vehicle ? [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ") : "";
  const validity = q.valid_until ? `valid until ${formatDate(q.valid_until)}` : `valid for ${q.validity_days} days`;
  const footer = [
    isEstimate ? `This estimate is ${validity}. The final price is confirmed once the vehicle is with us.` : `This quotation is ${validity}. Prices in AED; VAT at ${q.vat_percent}% shown separately.`,
    isEstimate ? "" : feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed),
  ];
  const statusLine = q.status === "approved" ? `${isEstimate ? "Accepted" : "Approved"} by ${q.approver_name} on ${formatDateTime(q.responded_at)}.` : q.status === "declined" ? `Declined by ${q.approver_name} on ${formatDateTime(q.responded_at)}.` : null;

  const doc = (
    <PdfDocument title={`${isEstimate ? "Estimate" : "Quotation"} ${q.number}`} company={company} logo={logo} footerLines={footer}>
      <TitleBlock
        title={isEstimate ? "ESTIMATE" : "QUOTATION"}
        number={`${q.number}${q.version > 1 ? `   ·   version ${q.version}` : ""}`}
        meta={[
          { label: "Date", value: formatDate(q.sent_at ?? q.created_at) },
          { label: "Valid until", value: q.valid_until ? formatDate(q.valid_until) : `${q.validity_days} days` },
          { label: "Advisor", value: creatorName ?? "" },
          job ? { label: "Job", value: job.job_number } : null,
          q.promised_at && !isEstimate ? { label: "Promised", value: formatDate(q.promised_at) } : null,
        ]}
      />
      <InfoBoxes
        boxes={[
          { title: "Customer", strong: customer?.company_name ?? customer?.full_name ?? "Customer", lines: [customer?.company_name ? customer.full_name : null, customer?.phone ?? null] },
          { title: "Vehicle", strong: carName || "Vehicle", lines: [vehicle ? formatPlate(vehicle) : null, vehicle?.vin ? `VIN ${vehicle.vin}` : null] },
        ]}
      />
      <LinesTable groups={order.map((label) => ({ label, lines: groups.get(label)! }))} />
      <TotalsBlock
        rows={[
          { label: "Subtotal", value: money(totals.subtotal) },
          ...(totals.discount ? [{ label: `Discount ${q.discount_percent}% on labour and services`, value: `- ${money(totals.discount)}` }, { label: "Before VAT", value: money(totals.net) }] : []),
          { label: `VAT ${q.vat_percent}%`, value: money(totals.vat) },
        ]}
        total={{ label: "Total (AED)", value: money(totals.total) }}
        after={[
          ...(totals.deposit ? [{ label: "Deposit required", value: `AED ${money(totals.deposit)}` }] : []),
          ...(q.promised_at && !isEstimate ? [{ label: "Promised date", value: formatDate(q.promised_at) }] : []),
        ]}
      />
      {q.customer_note ? (
        <View style={styles.note} wrap={false}>
          <Text style={styles.sectionTitle}>Note</Text>
          <Text>{q.customer_note}</Text>
        </View>
      ) : null}
      {statusLine ? (
        <View style={styles.note} wrap={false}>
          <Text>{statusLine}</Text>
        </View>
      ) : null}
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
