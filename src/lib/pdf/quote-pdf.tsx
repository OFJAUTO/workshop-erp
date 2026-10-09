import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatDateTime } from "@/lib/format";
import { feeNotice } from "@/lib/jobs";
import { amountInWords, round2 } from "@/lib/money";
import type { QuoteBundle } from "@/lib/quote-data";
import { URGENCY_LABELS, hasCostFloor, isHidden, lineTotal, lineUnitPrice, quoteTotals } from "@/lib/quotes";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { loadLogo } from "./images";
import { qrPng } from "./qr";
import { DiscountLine, InfoBoxes, LinesTable, PdfDocument, TitleRow, TotalsBlock, WordsAndPayments, companyOf, currencyOf, qtyText, styles, type DocLine } from "./template";

/** The customer's quotation or estimate on the document template: no internal costs, margins, hidden lines or bank charges. */
export async function renderQuotePdf(bundle: QuoteBundle, settings: Settings): Promise<Buffer> {
  const { quotation: q, customer, vehicle, job, creatorName } = bundle;
  const isEstimate = q.kind === "estimate";
  const currency = currencyOf(settings);
  const vatPct = Number(q.vat_percent) || 5;
  const lines = bundle.lines.filter((l) => l.is_active && !isHidden(l));
  const totals = quoteTotals(lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const partOf = (id: string | null) => (id ? bundle.parts.find((p) => p.id === id) : undefined);
  const toDoc = (l: (typeof lines)[number]): DocLine => {
    const amount = lineTotal(l);
    const unit = lineUnitPrice(l);
    const vat = round2(amount * (vatPct / 100));
    const part = partOf(l.part_item_id);
    const number = part?.part_number ?? (l.line_type === "part" ? (l.title.match(/\(([^()]+)\)\s*$/)?.[1] ?? null) : null);
    const title = l.line_type === "part" && number && l.title.endsWith(`(${number})`) ? l.title.slice(0, -(number.length + 2)).trim() : l.title;
    return {
      description: title,
      details: l.details,
      partNumber: number,
      qty: l.line_type === "labour" ? qtyText(l.quantity, l.hours ?? 0) : qtyText(l.quantity || 1),
      rate: unit,
      amount,
      vat,
      total: round2(amount + vat),
      complimentary: amount === 0,
      tag: l.urgency && !isEstimate ? URGENCY_LABELS[l.urgency] : null,
    };
  };
  const services = lines.filter((l) => l.line_type !== "part" && !(l.line_type === "other" && hasCostFloor(l))).map(toDoc);
  const parts = lines.filter((l) => l.line_type === "part" || (l.line_type === "other" && hasCostFloor(l))).map(toDoc);
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), q.token ? qrPng(`${PRODUCTION_SITE_URL}/quote/${q.token}`) : Promise.resolve(null)]);
  const carName = vehicle ? [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ") : "";
  const validity = q.valid_until ? `valid until ${formatDate(q.valid_until)}` : `valid for ${q.validity_days} days`;
  const footer = [isEstimate ? `This estimate is ${validity}. The final price is confirmed once the vehicle is with us.` : `This quotation is ${validity}. Prices in UAE dirhams; VAT at ${vatPct}% shown separately.`, isEstimate ? "" : feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed)];
  const statusLine = q.status === "approved" ? `${isEstimate ? "Accepted" : "Approved"} by ${q.approver_name} on ${formatDateTime(q.responded_at)}.` : q.status === "declined" ? `Declined by ${q.approver_name} on ${formatDateTime(q.responded_at)}.` : null;

  const doc = (
    <PdfDocument title={`${isEstimate ? "Estimate" : "Quotation"} ${q.number}`} company={company} logo={logo} qr={qr} preparedBy={creatorName} footerLines={footer}>
      <TitleRow
        title={isEstimate ? "ESTIMATE" : "QUOTATION"}
        meta={[
          { label: isEstimate ? "Estimate no." : "Quotation no.", value: `${q.number}${q.version > 1 ? ` v${q.version}` : ""}` },
          { label: "Date", value: formatDate(q.sent_at ?? q.created_at) },
          { label: "Valid until", value: q.valid_until ? formatDate(q.valid_until) : `${q.validity_days} days` },
          job ? { label: "Job card", value: job.job_number } : null,
          { label: "Advisor", value: creatorName ?? "" },
        ]}
      />
      <InfoBoxes
        boxes={[
          { title: "Customer", strong: customer?.company_name ?? customer?.full_name ?? "Customer", rows: [["Name", customer?.company_name ? customer.full_name : null], ["Mobile", customer?.phone ?? null], ["Email", customer?.email ?? null], ["TRN", customer?.trn ?? null]] },
          { title: "Vehicle", strong: carName || "Vehicle", rows: [["Variant", vehicle?.variant ?? null], ["Plate", vehicle ? formatPlate(vehicle) : null], ["VIN", vehicle?.vin ?? null]] },
        ]}
      />
      <LinesTable title="Services" lines={services} currency={currency} vatPercent={vatPct} subtotalLabel="Services subtotal" />
      <DiscountLine amount={totals.discount} currency={currency} />
      <LinesTable title="Spare parts" lines={parts} currency={currency} vatPercent={vatPct} subtotalLabel="Spare parts subtotal" startAt={services.length + 1} />
      <View style={styles.bottom}>
        <WordsAndPayments words={amountInWords(totals.total)} payments={[]} bank={company.bank} currency={currency} showBank={!isEstimate} />
        <TotalsBlock
          currency={currency}
          rows={[
            { label: "Gross amount", value: totals.subtotal },
            ...(totals.discount ? [{ label: "Discount", value: totals.discount, bold: true, negative: true }] : []),
            { label: "Taxable amount", value: totals.net },
            { label: `VAT ${vatPct}%`, value: totals.vat },
          ]}
          total={{ label: "Total", value: totals.total }}
          after={totals.deposit ? [{ label: "Deposit required", value: totals.deposit, bold: true }] : []}
          status={{ title: isEstimate ? "Estimate total" : "Quotation total", value: totals.total, note: q.promised_at && !isEstimate ? `Promised date ${formatDate(q.promised_at)}` : isEstimate ? "Final price confirmed once the vehicle is with us" : null }}
        />
      </View>
      {q.customer_note ? (
        <View style={styles.note} wrap={false}>
          <Text style={styles.smallTitle}>Note</Text>
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
