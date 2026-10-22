import "server-only";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import { Image, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatDateTime } from "@/lib/format";
import { METHOD_LABELS, invoiceBalance, type InvoiceBundle, type InvoiceLineRow, type PaymentRow } from "@/lib/invoice-data";
import { amountInWords, round2 } from "@/lib/money";
import type { PoBundle } from "@/lib/parts-data";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { loadLogo } from "./images";
import { qrPng } from "./qr";
import { packageDocOf } from "@/lib/packages";
import { DocumentTail, InfoBoxes, LinesTable, PackageSection, PdfDocument, PoLinesTable, SectionBox, TitleRow, TotalsBlock, TotalsBox, companyOf, currencyOf, px, qtyText, styles, type DocLine, type PoDocRow, type SectionLine, type StatusBox } from "./template";

const TITLES = { tax_invoice: "TAX INVOICE", proforma: "PROFORMA INVOICE", credit_note: "CREDIT NOTE" } as const;
const NUMBER_LABELS = { tax_invoice: "Invoice no.", proforma: "Proforma no.", credit_note: "Credit note no." } as const;

/** One invoice line in the section box: description, a small grey line of details, qty, rate, amount. Never a part number. */
function docLine(l: InvoiceLineRow): SectionLine {
  const comp = l.price_display === "complimentary" || l.price_display === "included";
  const disc = Number(l.discount_percent) || 0;
  return {
    description: l.description,
    details: l.hours !== null ? null : l.details,
    qty: l.hours !== null ? qtyText(l.quantity, l.hours) : qtyText(l.quantity),
    rate: l.unit_price,
    amount: l.amount_aed,
    complimentary: comp || l.amount_aed === 0,
    compWord: comp ? (l.price_display === "included" ? "Included" : "Complimentary") : undefined,
    discountPercent: disc > 0 ? disc : undefined,
    discountAmount: disc > 0 ? round2(l.unit_price * l.quantity - l.amount_aed) : undefined,
  };
}
/** The lines' own discounts inside one section (already inside the stored amounts). */
function lineDiscountsOf(lines: InvoiceLineRow[]): number {
  return round2(lines.reduce((a, l) => a + ((Number(l.discount_percent) || 0) > 0 ? Math.max(0, l.unit_price * l.quantity - l.amount_aed) : 0), 0));
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
  const { invoice, lines, payments, job } = bundle;
  const currency = currencyOf(settings);
  const vatPercent = invoice.taxable_aed ? round2((invoice.vat_aed / invoice.taxable_aed) * 100) || 5 : 5;
  // Section 9: a line billed from a bodyshop package gets the PROTECTION PACKAGE section; the rest stays in Labour and services.
  const pkgRows = lines.filter((l) => l.section === "services" && !!l.package_items);
  const serviceRows = lines.filter((l) => l.section === "services" && !l.package_items);
  const services = serviceRows.map(docLine);
  const fees = lines.filter((l) => l.section === "fees").map(docLine);
  const parts = lines.filter((l) => l.section === "parts").map(docLine);
  const sum = (ls: SectionLine[]) => round2(ls.reduce((a, l) => a + l.amount, 0));
  // The lines' own discounts (line 1's 22%): the sections show the pre-discount figure, the green row takes it off.
  const lineDiscounts = lineDiscountsOf(lines);
  // The labour discount as a percentage when it divides cleanly, else the amount alone.
  const pkgSum = round2(pkgRows.reduce((a, l) => a + l.amount_aed, 0));
  const labourSum = sum(services);
  const discountBase = round2(labourSum + pkgSum);
  const pct = invoice.discount_aed && discountBase ? round2((invoice.discount_aed / discountBase) * 100) : 0;
  const discountWords = pkgRows.length ? "Package discount" : "Labour discount";
  const discountLabel = pct && Math.abs(pct - Math.round(pct)) < 0.011 ? `${discountWords} (${Math.round(pct)}%)` : discountWords;
  const carTitle = (invoice.vehicle_snapshot?.title ?? [bundle.vehicle?.make?.name, bundle.vehicle?.model?.name, bundle.vehicle?.model_year].filter(Boolean).join(" ")) || null;
  const live = payments.filter((p) => p.status === "recorded");
  const bal = invoiceBalance(invoice, live);
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), invoice.token ? qrPng(`${PRODUCTION_SITE_URL}/${invoice.kind === "proforma" ? "proforma" : "invoice"}/${invoice.token}`) : Promise.resolve(null)]);
  const isCredit = invoice.kind === "credit_note";
  const rounding = round2(invoice.taxable_aed - (invoice.subtotal_aed - invoice.discount_aed - (invoice.warranty_credit_aed || 0)));
  const doc = (
    <PdfDocument title={`${TITLES[invoice.kind]} ${invoice.number}`} company={company} logo={logo} qr={qr} uppercase={settings.customer_documents_uppercase === true} scanLabel={"Scan to view\nthis invoice online"} footerLines={[]} computerGenerated={invoice.kind === "tax_invoice"}>
      <TitleRow
        title={TITLES[invoice.kind]}
        meta={[
          { label: NUMBER_LABELS[invoice.kind], value: invoice.number },
          { label: "Date", value: formatDate(invoice.issued_at) },
          job ? { label: "Job card", value: job.job_number } : null,
        ]}
      />
      <InfoBoxes boxes={[customerBox(bundle), vehicleBox(bundle)]} />
      {pkgRows.map((l) => {
        const docModel = packageDocOf(l.package_items, { car: carTitle });
        const disc = Number(l.discount_percent) || 0;
        return docModel ? <PackageSection key={l.id} doc={docModel} price={round2(l.unit_price * l.quantity)} subtotal={l.amount_aed} discount={disc > 0 ? { percent: disc, amount: round2(l.unit_price * l.quantity - l.amount_aed) } : null} /> : null;
      })}
      {services.length || !pkgRows.length ? <SectionBox title="Labour and services" lines={services} subtotalLabel="Labour and services subtotal" /> : null}
      {parts.length ? <SectionBox title="Parts" lines={parts} subtotalLabel="Parts subtotal" /> : null}
      {fees.length ? <SectionBox title="Other charges" lines={fees} subtotalLabel="Other charges subtotal" /> : null}
      <DocumentTail
        words={amountInWords(invoice.total_aed)}
        payments={live.map((p) => ({ date: formatDate(p.received_at), method: p.is_deposit ? (p.deposit_invoice_number ? `Less deposit invoiced (${p.deposit_invoice_number})` : `Less deposit received (${p.number})`) : METHOD_LABELS[p.method] + (p.method === "cheque" && p.cheque_status !== "cleared" ? " (pending)" : ""), amount: p.amount_aed, note: p.is_deposit ? METHOD_LABELS[p.method] : p.method === "cheque" ? p.cheque_number : p.reference }))}
        bank={!isCredit && bal.state !== "paid" ? company.bank : null}
        totals={
          <TotalsBox
            currency={currency}
            sections={[
              ...(pkgRows.length ? [{ label: lineDiscounts > 0 ? "Protection package (before discount)" : "Protection package", value: round2(pkgSum + lineDiscountsOf(pkgRows)) }] : []),
              ...(services.length || !pkgRows.length ? [{ label: lineDiscounts > 0 ? "Labour and services (before discount)" : "Labour and services", value: round2(labourSum + lineDiscountsOf(serviceRows)) }] : []),
              ...(parts.length || !pkgRows.length ? [{ label: "Parts", value: round2(sum(parts) + lineDiscountsOf(lines.filter((l) => l.section === "parts"))) }] : []),
              ...(fees.length ? [{ label: "Other charges", value: round2(sum(fees) + lineDiscountsOf(lines.filter((l) => l.section === "fees"))) }] : []),
            ]}
            green={[
              ...(lineDiscounts > 0 ? [{ label: "Discount", value: lineDiscounts }] : []),
              ...(invoice.discount_aed ? [{ label: discountLabel, value: invoice.discount_aed }] : []),
              ...(invoice.warranty_credit_aed ? [{ label: "Warranty repair, no charge", value: invoice.warranty_credit_aed }] : []),
              ...(rounding < 0 ? [{ label: "Round-off", value: Math.abs(rounding) }] : []),
            ]}
            net={invoice.taxable_aed}
            vatPercent={vatPercent}
            vat={invoice.vat_aed}
            total={invoice.total_aed}
            totalLabel={isCredit ? "Credit total" : "Grand total"}
            after={[
              ...(rounding > 0 ? [{ label: "Rounding", value: rounding }] : []),
              ...(!isCredit && bal.paid ? [{ label: "Paid", value: bal.paid, negative: true }] : []),
            ]}
            status={statusBoxFor(invoice, live)}
          />
        }
        notes={
          <>
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
          </>
        }
      />
    </PdfDocument>
  );
  return renderToBuffer(doc);
}

/** A receipt for one payment, on the same template. */
export async function renderReceiptPdf(payment: PaymentRow, invoice: InvoiceBundle | null, customer: { full_name: string; company_name: string | null; phone: string; email: string | null; trn: string | null } | null, job: { job_number: string } | null, settings: Settings, receivedByName: string | null, deposit: { quotationNumber: string | null; quotationTotal: number; received: number; balance: number } | null = null): Promise<Buffer> {
  void receivedByName;
  const currency = currencyOf(settings);
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), invoice?.invoice.token ? qrPng(`${PRODUCTION_SITE_URL}/invoice/${invoice.invoice.token}`) : Promise.resolve(null)]);
  const pending = payment.method === "cheque" && payment.cheque_status !== "cleared";
  const line: DocLine = {
    description: invoice ? `Payment against ${invoice.invoice.kind === "proforma" ? "proforma invoice" : "invoice"} ${invoice.invoice.number}` : deposit ? `Advance payment (deposit)${deposit.quotationNumber ? ` against quotation ${deposit.quotationNumber}` : ""}` : payment.is_deposit ? "Deposit" : "Payment",
    details: [METHOD_LABELS[payment.method], payment.method === "cheque" ? `cheque ${payment.cheque_number ?? ""}${payment.cheque_bank ? `, ${payment.cheque_bank}` : ""}${payment.cheque_date ? `, dated ${formatDate(payment.cheque_date)}` : ""}` : payment.reference].filter(Boolean).join("  ·  "),
    qty: "1",
    rate: payment.amount_aed,
    amount: payment.amount_aed,
    vat: 0,
    total: payment.amount_aed,
  };
  const doc = (
    <PdfDocument title={`Receipt ${payment.number}`} company={company} logo={logo} qr={qr} uppercase={settings.customer_documents_uppercase === true} scanLabel={"Scan to view\nthe invoice online"} footerLines={[pending ? "This receipt is for a cheque that has not cleared yet. It counts as unpaid until it clears." : "Thank you for your payment."]}>
      <TitleRow title="RECEIPT" meta={[{ label: "Receipt no.", value: payment.number }, { label: "Date", value: formatDate(payment.received_at) }, invoice ? { label: NUMBER_LABELS[invoice.invoice.kind], value: invoice.invoice.number } : null, deposit?.quotationNumber ? { label: "Quotation", value: deposit.quotationNumber } : null, job ? { label: "Job card", value: job.job_number } : null]} />
      <InfoBoxes
        boxes={[
          { title: "Received from", strong: customer?.company_name ?? customer?.full_name ?? "Customer", lines: [customer?.company_name ? customer.full_name : null, [customer?.phone, customer?.email].filter(Boolean).join(" · ") || null], muted: [customer?.trn ? `TRN ${customer.trn}` : null] },
          { title: "Payment", strong: METHOD_LABELS[payment.method], rows: [["Reference", payment.reference], ["Cheque no.", payment.cheque_number], ["Bank", payment.cheque_bank], ["Cheque date", payment.cheque_date ? formatDate(payment.cheque_date) : null], ["Received", formatDateTime(payment.received_at)]] },
        ]}
      />
      <LinesTable title="Payment" lines={[line]} currency={currency} vatPercent={0} subtotalLabel="Amount received" />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: px(4) }}>
        <TotalsBlock currency={currency} rows={[]} total={{ label: "Received", value: payment.amount_aed }} status={pending ? { title: "Cheque pending clearance", value: payment.amount_aed } : { title: "Received with thanks", value: payment.amount_aed, note: invoice ? (invoiceBalance(invoice.invoice, invoice.payments).balance > 0 ? `Balance remaining on the invoice ${invoiceBalance(invoice.invoice, invoice.payments).balance.toFixed(2)}` : "Invoice paid in full") : deposit ? (deposit.balance > 0 ? `Balance remaining AED ${deposit.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : "Quotation covered in full") : null }} />
      </View>
      <View style={{ marginTop: px(14) }} wrap={false}>
        <Text style={styles.smallTitle}>Amount in words</Text>
        <Text style={styles.words}>{amountInWords(payment.amount_aed)}</Text>
      </View>
    </PdfDocument>
  );
  return renderToBuffer(doc);
}

/** An LPO for a supplier: part numbers, quantities and the agreed cost. Internal document. */
export async function renderPoPdf(bundle: PoBundle, settings: Settings): Promise<Buffer> {
  // The supplier copy: the only LPO that leaves the system. LPO number and date, the supplier, the VIN only, the
  // lines with list price, discount, net, VAT and total, then "Approved electronically" with the time and a QR code
  // to the verification page. No job card, no expected dates, no urgency, no staff names.
  const { po, lines, job, supplier } = bundle;
  const currency = currencyOf(settings);
  const company = companyOf(settings);
  const vatPercent = 5;
  const verifyUrl = po.verify_token ? `${PRODUCTION_SITE_URL}/lpo/${po.verify_token}` : null;
  const [logo, qr] = await Promise.all([loadLogo(), verifyUrl ? qrPng(verifyUrl) : Promise.resolve(null)]);
  const rows: PoDocRow[] = lines.map((l) => {
    const list = l.list_price !== null && l.list_price !== undefined ? l.list_price : l.unit_cost;
    const disc = l.discount_percent !== null && l.discount_percent !== undefined ? l.discount_percent : list > 0 ? round2((1 - l.unit_cost / list) * 100) : 0;
    const net = round2(l.quantity * l.unit_cost);
    const vat = round2(net * (vatPercent / 100));
    return { partNumber: l.part_number, name: l.description, qty: qtyText(l.quantity), list, disc: Math.max(0, disc), net, vat, total: round2(net + vat) };
  });
  const gross = round2(rows.reduce((a, r) => a + r.net, 0));
  const vat = round2(gross * (vatPercent / 100));
  const total = round2(gross + vat);
  const vin = job?.vehicle?.vin ?? null;
  const approvedAt = po.approved_at ?? po.created_at;
  const doc = (
    <PdfDocument title={`LPO ${po.number}`} company={company} logo={logo} footerLines={["Please quote the LPO number on your delivery note and invoice. Prices before VAT as agreed."]}>
      <TitleRow title="LOCAL PURCHASE ORDER" meta={[{ label: "LPO no.", value: po.number }, { label: "Date", value: formatDate(approvedAt) }]} />
      <InfoBoxes
        boxes={[
          { title: "Supplier", strong: po.supplier_name, lines: [supplier?.trn ? `TRN ${supplier.trn}` : null, supplier?.address ?? null, [supplier?.phone, supplier?.email].filter(Boolean).join(" · ") || null, supplier?.payment_terms ? `Terms: ${supplier.payment_terms}` : null] },
          { title: "Vehicle", strong: vin ? `VIN ${vin}` : "VIN to follow" },
        ]}
      />
      <PoLinesTable rows={rows} vatPercent={vatPercent} />
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <TotalsBlock currency={currency} rows={[{ label: "Net amount", value: gross }, { label: `VAT ${vatPercent}%`, value: vat }]} total={{ label: "Total", value: total }} />
      </View>
      <View style={{ marginTop: px(12) }} wrap={false}>
        <Text style={styles.smallTitle}>Amount in words</Text>
        <Text style={styles.words}>{amountInWords(total)}</Text>
      </View>
      {po.notes ? (
        <View style={styles.note} wrap={false}>
          <Text style={styles.smallTitle}>Note</Text>
          <Text>{po.notes}</Text>
        </View>
      ) : null}
      <View style={[styles.note, { flexDirection: "row", alignItems: "center", gap: px(14) }]} wrap={false}>
        <View style={{ flex: 1 }}>
          <Text style={styles.smallTitle}>Approved electronically</Text>
          <Text>This order was issued by the OFJ Automotive system and needs no signature or stamp.</Text>
          <Text style={styles.small}>{formatDateTime(approvedAt)}{verifyUrl ? ` · Scan the code to verify this order` : ""}</Text>
        </View>
        {qr ? <Image src={{ data: qr, format: "png" }} style={styles.qr} /> : null}
      </View>
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
