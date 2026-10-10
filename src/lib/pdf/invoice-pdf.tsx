import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatDateTime } from "@/lib/format";
import { METHOD_LABELS, invoiceBalance, type InvoiceBundle, type InvoiceLineRow, type PaymentRow } from "@/lib/invoice-data";
import { amountInWords, round2 } from "@/lib/money";
import type { PoBundle } from "@/lib/parts-data";
import { partTypeText } from "@/lib/quotes";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { loadLogo } from "./images";
import { qrPng } from "./qr";
import { InfoBoxes, LinesTable, PdfDocument, TitleRow, TotalsBlock, WordsAndPayments, companyOf, currencyOf, qtyText, styles, type DocLine, type StatusBox } from "./template";

const TITLES = { tax_invoice: "TAX INVOICE", proforma: "PROFORMA INVOICE", credit_note: "CREDIT NOTE" } as const;
const NUMBER_LABELS = { tax_invoice: "Invoice no.", proforma: "Proforma no.", credit_note: "Credit note no." } as const;

function docLine(l: InvoiceLineRow, vatPercent: number): DocLine {
  return {
    description: l.description,
    details: l.hours !== null ? null : l.details,
    partNumber: l.part_number,
    qty: l.hours !== null ? qtyText(l.quantity, l.hours) : qtyText(l.quantity),
    rate: l.unit_price,
    amount: l.amount_aed,
    vat: l.vat_aed || round2(l.amount_aed * (vatPercent / 100)),
    total: l.total_aed || round2(l.amount_aed * (1 + vatPercent / 100)),
    complimentary: l.amount_aed === 0,
  };
}

function customerBox(b: Pick<InvoiceBundle, "customer" | "invoice">) {
  const snap = b.invoice.customer_snapshot ?? {};
  const name = snap.company_name ?? b.customer?.company_name ?? snap.full_name ?? b.customer?.full_name ?? "Customer";
  const person = snap.company_name ?? b.customer?.company_name ? (snap.full_name ?? b.customer?.full_name ?? null) : null;
  const trn = snap.trn ?? b.customer?.trn ?? null;
  return { title: "Billed to", strong: name, lines: [person, [snap.phone ?? b.customer?.phone, snap.email ?? b.customer?.email].filter(Boolean).join(" · ") || null], muted: [trn ? `TRN ${trn}` : null] };
}

function vehicleBox(b: Pick<InvoiceBundle, "vehicle" | "invoice">) {
  const v = b.vehicle;
  const snap = b.invoice.vehicle_snapshot ?? {};
  const title = snap.title ?? [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ");
  const plate = snap.plate ?? (v ? formatPlate(v) : null);
  const vin = snap.vin ?? v?.vin ?? null;
  return { title: "Vehicle", strong: [title || "Vehicle", plate].filter(Boolean).join(" · "), lines: [snap.variant ?? v?.variant ?? null, vin ? `VIN ${vin}` : null] };
}

/** What the status box says at this moment, from the payments: amount due, balance due, paid in full, or cheque pending. */
export function statusBoxFor(invoice: InvoiceBundle["invoice"], payments: PaymentRow[]): StatusBox {
  if (invoice.kind === "credit_note") return { title: "Credit note total", value: invoice.total_aed };
  const bal = invoiceBalance(invoice, payments);
  if (bal.state === "paid") return { title: "Paid in full", value: null, note: bal.paidAt ? `Final payment received ${formatDate(bal.paidAt)}` : null };
  if (bal.state === "cheque_pending") return { title: "Cheque pending clearance", value: bal.balance, note: "Counts as unpaid until the cheque clears" };
  if (bal.state === "part_paid") return { title: "Balance due", value: bal.balance, note: bal.pendingAmount ? `Cheque of ${bal.pendingAmount.toFixed(2)} pending clearance` : null };
  return { title: "Amount due", value: invoice.total_aed };
}

/** A tax invoice, proforma invoice or credit note on the document template. The status reflects the moment it is downloaded. */
export async function renderInvoicePdf(bundle: InvoiceBundle, settings: Settings): Promise<Buffer> {
  const { invoice, lines, payments, job, preparedByName } = bundle;
  const currency = currencyOf(settings);
  const vatPercent = invoice.taxable_aed ? round2((invoice.vat_aed / invoice.taxable_aed) * 100) || 5 : 5;
  const services = lines.filter((l) => l.section === "services").map((l) => docLine(l, vatPercent));
  const fees = lines.filter((l) => l.section === "fees").map((l) => docLine(l, vatPercent));
  const parts = lines.filter((l) => l.section === "parts").map((l) => docLine(l, vatPercent));
  const live = payments.filter((p) => p.status === "recorded");
  const bal = invoiceBalance(invoice, live);
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), invoice.token ? qrPng(`${PRODUCTION_SITE_URL}/invoice/${invoice.token}`) : Promise.resolve(null)]);
  const isCredit = invoice.kind === "credit_note";
  const rounding = round2(invoice.taxable_aed - (invoice.subtotal_aed - invoice.discount_aed - (invoice.warranty_credit_aed || 0)));
  const doc = (
    <PdfDocument title={`${TITLES[invoice.kind]} ${invoice.number}`} company={company} logo={logo} qr={qr} preparedBy={preparedByName} scanLabel={"Scan to view\nthis invoice online"} footerLines={[invoice.kind === "proforma" ? "A proforma invoice is a request for payment, not a tax invoice." : `VAT at ${vatPercent}% shown separately. Prices in UAE dirhams.`]}>
      <TitleRow
        title={TITLES[invoice.kind]}
        meta={[
          { label: NUMBER_LABELS[invoice.kind], value: invoice.number },
          { label: "Date", value: formatDate(invoice.issued_at) },
          job ? { label: "Job card", value: job.job_number } : null,
          { label: "Advisor", value: preparedByName ?? "" },
        ]}
      />
      <InfoBoxes boxes={[customerBox(bundle), vehicleBox(bundle)]} />
      <LinesTable title="Services" lines={[...services, ...fees]} currency={currency} vatPercent={vatPercent} subtotalLabel="Services subtotal" discount={invoice.discount_aed ? { label: "Discount on labour and services", amount: invoice.discount_aed } : null} />
      {parts.length ? <LinesTable title="Spare parts" lines={parts} currency={currency} vatPercent={vatPercent} subtotalLabel="Spare parts subtotal" startAt={services.length + fees.length + 1} /> : null}
      <View style={styles.bottom}>
        <WordsAndPayments
          words={amountInWords(invoice.total_aed)}
          payments={live.map((p) => ({ date: formatDate(p.received_at), method: METHOD_LABELS[p.method] + (p.method === "cheque" && p.cheque_status !== "cleared" ? " (pending)" : ""), amount: p.amount_aed, note: p.method === "cheque" ? p.cheque_number : p.reference }))}
          bank={company.bank}
          currency={currency}
          showBank={!isCredit && bal.state !== "paid"}
        />
        <TotalsBlock
          currency={currency}
          rows={[
            { label: "Gross amount", value: invoice.subtotal_aed },
            ...(invoice.discount_aed ? [{ label: "Discount", value: invoice.discount_aed, bold: true, negative: true }] : []),
            ...(invoice.warranty_credit_aed ? [{ label: "Warranty repair, no charge", value: invoice.warranty_credit_aed, bold: true, negative: true }] : []),
            ...(rounding ? [{ label: "Rounding", value: Math.abs(rounding), negative: rounding < 0 }] : []),
            { label: "Taxable amount", value: invoice.taxable_aed },
            { label: `VAT ${vatPercent}%`, value: invoice.vat_aed },
          ]}
          total={{ label: isCredit ? "Credit total" : "Total", value: invoice.total_aed }}
          after={!isCredit && bal.paid ? [{ label: "Paid", value: bal.paid, negative: true }] : []}
          status={statusBoxFor(invoice, live)}
        />
      </View>
      {invoice.notes ? (
        <View style={styles.note} wrap={false}>
          <Text style={styles.smallTitle}>Note</Text>
          <Text>{invoice.notes}</Text>
        </View>
      ) : null}
      {isCredit && invoice.credit_of ? (
        <View style={styles.note} wrap={false}>
          <Text>This credit note corrects an earlier tax invoice.</Text>
        </View>
      ) : null}
    </PdfDocument>
  );
  return renderToBuffer(doc);
}

/** A receipt for one payment, on the same template. */
export async function renderReceiptPdf(payment: PaymentRow, invoice: InvoiceBundle | null, customer: { full_name: string; company_name: string | null; phone: string; email: string | null; trn: string | null } | null, job: { job_number: string } | null, settings: Settings, receivedByName: string | null): Promise<Buffer> {
  const currency = currencyOf(settings);
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), invoice?.invoice.token ? qrPng(`${PRODUCTION_SITE_URL}/invoice/${invoice.invoice.token}`) : Promise.resolve(null)]);
  const pending = payment.method === "cheque" && payment.cheque_status !== "cleared";
  const line: DocLine = {
    description: invoice ? `Payment against ${invoice.invoice.kind === "proforma" ? "proforma invoice" : "invoice"} ${invoice.invoice.number}` : payment.is_deposit ? "Deposit" : "Payment",
    details: [METHOD_LABELS[payment.method], payment.method === "cheque" ? `cheque ${payment.cheque_number ?? ""}${payment.cheque_bank ? `, ${payment.cheque_bank}` : ""}${payment.cheque_date ? `, dated ${formatDate(payment.cheque_date)}` : ""}` : payment.reference].filter(Boolean).join("  ·  "),
    qty: "1",
    rate: payment.amount_aed,
    amount: payment.amount_aed,
    vat: 0,
    total: payment.amount_aed,
  };
  const doc = (
    <PdfDocument title={`Receipt ${payment.number}`} company={company} logo={logo} qr={qr} preparedBy={receivedByName} scanLabel={"Scan to view\nthe invoice online"} footerLines={[pending ? "This receipt is for a cheque that has not cleared yet. It counts as unpaid until it clears." : "Thank you for your payment."]}>
      <TitleRow title="RECEIPT" meta={[{ label: "Receipt no.", value: payment.number }, { label: "Date", value: formatDate(payment.received_at) }, invoice ? { label: NUMBER_LABELS[invoice.invoice.kind], value: invoice.invoice.number } : null, job ? { label: "Job card", value: job.job_number } : null]} />
      <InfoBoxes
        boxes={[
          { title: "Received from", strong: customer?.company_name ?? customer?.full_name ?? "Customer", lines: [customer?.company_name ? customer.full_name : null, [customer?.phone, customer?.email].filter(Boolean).join(" · ") || null], muted: [customer?.trn ? `TRN ${customer.trn}` : null] },
          { title: "Payment", strong: METHOD_LABELS[payment.method], rows: [["Reference", payment.reference], ["Cheque no.", payment.cheque_number], ["Bank", payment.cheque_bank], ["Cheque date", payment.cheque_date ? formatDate(payment.cheque_date) : null], ["Received", formatDateTime(payment.received_at)]] },
        ]}
      />
      <LinesTable title="Payment" lines={[line]} currency={currency} vatPercent={0} subtotalLabel="Amount received" />
      <View style={styles.bottom}>
        <WordsAndPayments words={amountInWords(payment.amount_aed)} payments={[]} bank={company.bank} currency={currency} showBank={false} />
        <TotalsBlock currency={currency} rows={[]} total={{ label: "Received", value: payment.amount_aed }} status={pending ? { title: "Cheque pending clearance", value: payment.amount_aed } : { title: "Received with thanks", value: payment.amount_aed, note: invoice ? (invoiceBalance(invoice.invoice, invoice.payments).balance > 0 ? `Balance remaining on the invoice ${invoiceBalance(invoice.invoice, invoice.payments).balance.toFixed(2)}` : "Invoice paid in full") : null }} />
      </View>
    </PdfDocument>
  );
  return renderToBuffer(doc);
}

/** A purchase order for a supplier: part numbers, quantities and the agreed cost. Internal document. */
export async function renderPoPdf(bundle: PoBundle, settings: Settings): Promise<Buffer> {
  const { po, lines, job, names } = bundle;
  const currency = currencyOf(settings);
  const company = companyOf(settings);
  const logo = await loadLogo();
  const vatPercent = 5;
  const docLines: DocLine[] = lines.map((l) => {
    const amount = round2(l.quantity * l.unit_cost);
    const vat = round2(amount * (vatPercent / 100));
    const part = bundle.parts.find((p) => p.id === l.part_item_id);
    return { description: l.description, partNumber: l.part_number, details: [part ? partTypeText(part) : null, l.expected_date ? `Expected ${formatDate(l.expected_date)}` : null].filter(Boolean).join(" · ") || null, qty: qtyText(l.quantity), rate: l.unit_cost, amount, vat, total: round2(amount + vat) };
  });
  const gross = round2(docLines.reduce((a, l) => a + l.amount, 0));
  const vat = round2(gross * (vatPercent / 100));
  const v = job?.vehicle;
  const doc = (
    <PdfDocument title={`Purchase order ${po.number}`} company={company} logo={logo} preparedBy={po.created_by ? (names.get(po.created_by) ?? null) : null} footerLines={["Please quote the purchase order number on your delivery note and invoice. Prices before VAT as agreed."]}>
      <TitleRow title="PURCHASE ORDER" meta={[{ label: "PO no.", value: po.number }, { label: "Date", value: formatDate(po.approved_at ?? po.created_at) }, job ? { label: "Job card", value: job.job_number } : null, { label: "Approved by", value: po.approved_by ? (names.get(po.approved_by) ?? "") : "" }]} />
      <InfoBoxes
        boxes={[
          { title: "Supplier", strong: po.supplier_name, lines: [po.notes] },
          { title: "Vehicle", strong: v ? [[v.make?.name, v.model?.name].filter(Boolean).join(" "), formatPlate(v)].filter(Boolean).join(" · ") : "", lines: [v?.vin ? `VIN ${v.vin}` : null, job ? `Job card ${job.job_number}` : null] },
        ]}
      />
      <LinesTable title="Parts ordered" lines={docLines} currency={currency} vatPercent={vatPercent} subtotalLabel="Order subtotal" />
      <View style={styles.bottom}>
        <WordsAndPayments words={amountInWords(round2(gross + vat))} payments={[]} bank={company.bank} currency={currency} showBank={false} />
        <TotalsBlock currency={currency} rows={[{ label: "Gross amount", value: gross }, { label: `VAT ${vatPercent}%`, value: vat }]} total={{ label: "Total", value: round2(gross + vat) }} status={{ title: "Deliver to", value: null, note: company.address.join(", ") }} />
      </View>
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
