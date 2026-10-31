import { isPickupShownByPackage, packagesGivePickup } from "../packages";
import { customerCompWord } from "../complimentary";
import { compReasonForJob } from "../quote-data";
import "server-only";
import { customerWarrantyTitle } from "@/lib/warranty";
/* eslint-disable jsx-a11y/alt-text -- react-pdf images are not HTML images */
import type { ReactNode } from "react";
import { Image, Path, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { detailsWithoutHours, formatDate, formatDateTime } from "@/lib/format";
import { METHOD_LABELS, invoiceBalance, type InvoiceBundle, type InvoiceLineRow, type PaymentRow } from "@/lib/invoice-data";
import { amountInWords, round2 } from "@/lib/money";
import type { PoBundle } from "@/lib/parts-data";
import type { Settings } from "@/lib/settings";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { loadLogo } from "./images";
import { qrPng } from "./qr";
import { packageDocOf } from "@/lib/packages";
import { CUT_EXPLAIN, cutWords, lineIsPpf } from "@/lib/ppf-cut";
import { decorateTint, lineTintWords } from "@/lib/tint";
import { tintLimitOf, tintSpecForJob } from "@/lib/tint-data";
import { RED, PALE, INK, GREY, GREEN, Amount, DocumentTail, InfoBoxes, PackageSection, PdfDocument, PoLinesTable, TitleRow, boxesWithTail, type BoxSpec, TotalsBlock, WarrantyPanel, WarrantySection, companyOf, currencyOf, px, qtyText, styles, type PoDocRow, type SectionLine, type StatusBox, type Box } from "./template";
import { docMoneyRows, sectionSubtotalShown } from "@/lib/doc-totals";
import { renderByPageRules } from "@/lib/pdf-read";
import { addMonthsIso, dubaiDay } from "@/lib/warranty";
import { positionsWords } from "@/lib/parts-list";
import { ensureWarrantyToken, warrantyCardOf } from "@/lib/warranty-data";

const TITLES = { tax_invoice: "TAX INVOICE", proforma: "PROFORMA INVOICE", credit_note: "CREDIT NOTE" } as const;
const NUMBER_LABELS = { tax_invoice: "Invoice no.", proforma: "Proforma no.", credit_note: "Credit note no." } as const;

/** One invoice line in the section box: description, a small grey line of details, qty, rate, amount. Never a part number. */
function docLineOf(l: InvoiceLineRow, compReason: string | null = null): SectionLine {
  // A labour line stores its hours as the quantity: it counts as one line, so a labour box shows just the AMOUNT (the
  // owner's mockup B), the same as on the quotation.
  const quantity = l.hours !== null ? 1 : Number(l.quantity) || 1;
  const comp = l.price_display === "complimentary" || l.price_display === "included";
  const disc = Number(l.discount_percent) || 0;
  return {
    quantity,
    description: l.description,
    positions: positionsWords(l.positions) || null,
    details: l.hours !== null ? detailsWithoutHours(l.details) : l.details,
    qty: l.hours !== null ? qtyText(l.quantity, l.hours) : qtyText(l.quantity),
    rate: l.unit_price,
    amount: l.amount_aed,
    complimentary: comp || l.amount_aed === 0,
    compWord: comp ? customerCompWord({ price_display: (l.price_display ?? null) as "complimentary" | "included" | "normal" | null }, compReason, null) : undefined,
    discountPercent: disc > 0 ? disc : undefined,
    discountAmount: disc > 0 ? round2(l.unit_price * l.quantity - l.amount_aed) : undefined,
  };
}

function customerBox(b: Pick<InvoiceBundle, "customer" | "invoice">) {
  const snap = b.invoice.customer_snapshot ?? {};
  const name = snap.company_name ?? b.customer?.company_name ?? snap.full_name ?? b.customer?.full_name ?? "Customer";
  const person = snap.company_name ?? b.customer?.company_name ? (snap.full_name ?? b.customer?.full_name ?? null) : null;
  const trn = snap.trn ?? b.customer?.trn ?? null;
  return { title: "Billed to", strong: name, lines: [person, [snap.phone ?? b.customer?.phone, snap.email ?? b.customer?.email].filter(Boolean).join(" · ") || null], muted: [trn ? `TRN ${trn}` : null] };
}

function vehicleBox(b: Pick<InvoiceBundle, "vehicle" | "invoice" | "mileage">) {
  const v = b.vehicle;
  const snap = b.invoice.vehicle_snapshot ?? {};
  const title = snap.title ?? [v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ");
  const plate = snap.plate ?? (v ? formatPlate(v) : null);
  const vin = snap.vin ?? v?.vin ?? null;
  const km = b.mileage?.in ? [`Mileage in ${b.mileage.in}`, b.mileage.out ? `out ${b.mileage.out}` : null].filter(Boolean).join(" · ") : null;
  return { title: "Vehicle", strong: title || "Vehicle", lines: [snap.variant ?? v?.variant ?? null, plate ? `Plate ${plate}` : null, vin ? `VIN ${vin}` : null, km] };
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
  const vatPercent = invoice.taxable_aed ? round2((invoice.vat_aed / invoice.taxable_aed) * 100) || 5 : 5;
  // Section 9: a line billed from a bodyshop package gets the PROTECTION PACKAGE section; the rest stays in Labour and services.
  const pkgRows = lines.filter((l) => l.section === "services" && !!l.package_items);
  const serviceRows = lines.filter((l) => l.section === "services" && !l.package_items);
  // Section 11: the job's tint specification puts the shades on the tint lines and package items.
  const tintSpec = await tintSpecForJob(invoice.job_id);
  // Section 5.6: the free work's wording follows its reason (goodwill / our mistake / warranty).
  const compReason = await compReasonForJob(invoice.job_id);
  const docLine = (l: InvoiceLineRow) => docLineOf(l, compReason);
  const tintLimit = tintLimitOf(settings);
  const services = serviceRows.map((l) => {
    const d = docLine(l);
    const tw = lineTintWords(l, null, tintSpec, tintLimit);
    return tw ? { ...d, details: [d.details, tw].filter(Boolean).join(" · ") } : d;
  });
  // Section 6.3: the package badge shows the free pick-up once; its AED 0 line is left off the customer's copy.
  const pickupInPackage = packagesGivePickup(pkgRows.map((l) => l.package_items));
  const fees = lines.filter((l) => l.section === "fees" && !(pickupInPackage && isPickupShownByPackage({ description: l.description }, Number(l.amount_aed) || 0))).map(docLine);
  const parts = lines.filter((l) => l.section === "parts").map(docLine);
  // The labour discount as a percentage when it divides cleanly, else the amount alone.
  const pkgSum = round2(pkgRows.reduce((a, l) => a + l.amount_aed, 0));
  const labourSum = round2(services.reduce((a, l) => a + l.amount, 0));
  const discountBase = round2(labourSum + pkgSum);
  const pct = invoice.discount_aed && discountBase ? round2((invoice.discount_aed / discountBase) * 100) : 0;
  const discountWords = pkgRows.length ? "Package discount" : "Labour discount";
  const discountLabel = pct && Math.abs(pct - Math.round(pct)) < 0.011 ? `${discountWords} (${Math.round(pct)}%)` : discountWords;
  const live = payments.filter((p) => p.status === "recorded");
  const bal = invoiceBalance(invoice, live);
  const company = companyOf(settings);
  const logo = await loadLogo();
  const isCredit = invoice.kind === "credit_note";
  const rounding = round2(invoice.taxable_aed - (invoice.subtotal_aed - invoice.discount_aed - (invoice.warranty_credit_aed || 0)));
  // Section 12: the tax invoice is the warranty card - the WARRANTY table per product, the framed panel with its QR,
  // and on mechanical work the workmanship line. Dates run from the handover (gate-out) day.
  const card = invoice.kind === "tax_invoice" && invoice.job_id ? await warrantyCardOf(invoice.job_id, settings) : null;
  const warrantyToken = card?.rows.length ? await ensureWarrantyToken(card.jobId) : null;
  const warrantyQr = warrantyToken ? await qrPng(`${PRODUCTION_SITE_URL}/warranty/${warrantyToken}`, 420) : null;
  const workmanship = card?.mechanical ? { period: card.mechanical.period, until: card.mechanical.validUntil ?? addMonthsIso(dubaiDay(invoice.issued_at), card.mechanical.months) } : null;

  // THE money rows (31 October 2026, the owner's mockup): every amount once - the lines after their own discount, a
  // package at its price with its discount among the green rows, one TOTAL INCL. VAT, then the payments and the balance
  // due in the same box. A tax invoice and a credit note always print the taxable amount (UAE tax invoice field).
  const sectionCounts = [...pkgRows.map((l) => ({ key: `pkg:${l.id}`, lines: 1 })), { key: "services", lines: services.length || (!pkgRows.length && !parts.length && !fees.length ? 1 : 0) }, { key: "parts", lines: parts.length }, { key: "fees", lines: fees.length }];
  const pkgDiscounts = pkgRows.filter((l) => l.unit_price * l.quantity - l.amount_aed > 0.004).map((l) => ({ label: `Package discount${Number(l.discount_percent) > 0 ? ` (${String(Number(l.discount_percent))}%)` : ""}`, value: round2(l.unit_price * l.quantity - l.amount_aed) }));
  const gross = round2(pkgRows.reduce((a, l) => a + l.unit_price * l.quantity, 0) + [...services, ...parts, ...fees].reduce((a, l) => a + l.amount, 0));
  const paidRows = isCredit ? [] : live.map((p) => {
    const pending = p.method === "cheque" && p.cheque_status !== "cleared";
    const what = p.is_deposit ? (p.deposit_invoice_number ? `Deposit invoiced (${p.deposit_invoice_number})` : `Deposit paid (${p.number})`) : `Paid ${formatDate(p.received_at)} · ${METHOD_LABELS[p.method] ?? p.method} (${p.number})`;
    return { label: pending ? `Cheque pending, not counted yet (${p.number})` : what, value: p.amount_aed, kind: pending ? ("after" as const) : ("paid" as const) };
  });
  const rows = docMoneyRows({
    sections: sectionCounts,
    gross,
    green: [...pkgDiscounts, ...(invoice.discount_aed ? [{ label: discountLabel, value: invoice.discount_aed }] : []), ...(invoice.warranty_credit_aed ? [{ label: "Warranty repair, no charge", value: invoice.warranty_credit_aed }] : []), ...(rounding < 0 ? [{ label: "Round-off", value: Math.abs(rounding) }] : [])],
    roundUp: rounding > 0 ? rounding : 0,
    net: invoice.taxable_aed,
    vatPercent,
    vat: invoice.vat_aed,
    total: invoice.total_aed,
    taxDocument: invoice.kind === "tax_invoice" || isCredit,
    totalLabel: isCredit ? "Credit total incl. VAT" : "Total incl. VAT",
    after: paidRows,
    balance: isCredit ? null : bal.balance,
  });
  const note = isCredit ? "This credit note corrects an earlier tax invoice." : bal.state === "paid" ? `Paid in full${bal.paidAt ? ` on ${formatDate(bal.paidAt)}` : ""}. Thank you.` : invoice.kind === "proforma" ? "Please pay the total to collect the vehicle. The tax invoice follows the payment." : "Thank you for your business.";
  // The boxes of lines; when the totals would start a page alone, the last two lines travel with them (boxesWithTail).
  const boxes: BoxSpec[] = [
    ...(services.length || !pkgRows.length ? [{ key: "services", title: "Labour and services", lines: services, subtotalLabel: "Labour subtotal", showSubtotal: sectionSubtotalShown(sectionCounts, "services") }] : []),
    ...(parts.length ? [{ key: "parts", title: "Parts", descLabel: "Part", lines: parts, subtotalLabel: "Parts subtotal", showSubtotal: sectionSubtotalShown(sectionCounts, "parts") }] : []),
    ...(fees.length ? [{ key: "fees", title: "Other charges", lines: fees, subtotalLabel: "Other charges subtotal", showSubtotal: sectionSubtotalShown(sectionCounts, "fees") }] : []),
  ];

  const draw = ({ tight, keepLast }: { tight: boolean; keepLast: boolean }) => {
    const { body, lead } = boxesWithTail(boxes, keepLast, tight);
    const notes = invoice.notes ? (
      <View style={styles.note} wrap={false}>
        <Text style={styles.smallTitle}>Note</Text>
        <Text>{invoice.notes}</Text>
      </View>
    ) : null;
    return renderToBuffer(
    <PdfDocument tight={tight} title={`${TITLES[invoice.kind]} ${invoice.number}`} company={company} logo={logo} uppercase={settings.customer_documents_uppercase === true} footerLines={[]} computerGenerated={invoice.kind === "tax_invoice"}>
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
        const docModel = packageDocOf(l.package_items, { car: null, decorate: decorateTint(tintSpec, tintLimit), ppfNote: lineIsPpf({ title: l.description, package_items: l.package_items }) ? cutWords(l.cut_method, l.cut_note) : null, ppfExplain: CUT_EXPLAIN });
        return docModel ? <PackageSection tight={tight} key={l.id} doc={docModel} price={round2(l.unit_price * l.quantity)} /> : null;
      })}
      {body}
      <DocumentTail
        tight={tight}
        rows={rows}
        words={amountInWords(invoice.total_aed)}
        bank={!isCredit && bal.state !== "paid" ? company.bank : null}
        note={note}
        lead={lead.length ? <>{lead}{notes}</> : null}
        before={lead.length ? null : notes}
        after={
          <>
            {workmanship ? (
              <View style={styles.note} wrap={false}>
                <Text style={{ fontWeight: 700 }}>Workmanship warranty: {workmanship.period}, valid until {formatDate(workmanship.until)}</Text>
                <Text style={{ color: "#5F6368", marginTop: px(2) }}>{card?.terms.mechanical.short}</Text>
              </View>
            ) : null}
            {card?.rows.length ? (
              <>
                <WarrantySection
                  vehicle={[card.car, card.plate, card.vin ? `VIN ${card.vin}` : null].filter(Boolean).join(" · ")}
                  startNote={card.handoverDay ? `From the handover on ${formatDate(card.handoverDay)}` : "Starts on the handover day"}
                  rows={card.rows.map((r) => ({ product: r.name, coverage: r.coverage, rollBatch: r.rollBatch ?? "—", cut: r.cut ?? "—", darkness: r.darkness ?? "—", period: r.period, validUntil: r.validUntil ? formatDate(r.validUntil) : "From handover" }))}
                />
                <WarrantyPanel logo={logo} qr={warrantyQr} certificateNo={card.certificateNo} car={[card.car, card.plate].filter(Boolean).join(" · ")} status={customerWarrantyTitle(card.status)} />
              </>
            ) : null}
          </>
        }
      />
    </PdfDocument>,
    );
  };
  // One page when it fits; a second page only when needed, never with the totals alone on it (src/lib/pdf-read.ts).
  return renderByPageRules(draw);
}

/** A receipt for one payment, on the same template. */
export type ReceiptVehicle = { title: string | null; plate: string; vin: string | null };
export type ReceiptSummary = { totalLabel: string; total: number; paid: number; balance: number; paidInFull: boolean; pendingCheque: boolean };
export type ReceiptData = {
  payment: PaymentRow;
  customer: { full_name: string; company_name: string | null; phone: string | null; trn: string | null } | null;
  jobNumber: string | null;
  vehicle: ReceiptVehicle | null;
  /** The meta cell after the date: Quotation Q-00002, or the invoice's own number. */
  docRef: { label: string; value: string } | null;
  /** "Advance payment (deposit) against quotation Q-00002" / "Payment against invoice INV-00012". */
  forLine: string;
  summary: ReceiptSummary | null;
  /** The invoice link token: the QR opens the invoice page. A deposit receipt has none. */
  invoiceToken: string | null;
};

/** A drawn check mark: the document font has no ✓ glyph to rely on. */
function CheckMark({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" style={{ marginRight: px(4) }}>
      <Path d="M1.5 6.5 L4.8 9.8 L10.5 2.5" stroke={color} strokeWidth={2.2} fill="none" />
    </Svg>
  );
}

function SummaryCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: PALE, borderRadius: 5, paddingVertical: px(9), paddingHorizontal: px(11) }}>
      <Text style={styles.smallTitle}>{label}</Text>
      {children}
    </View>
  );
}

/**
 * The receipt (26 October 2026, the owner's mock): the shared header, three boxes (received from, the vehicle,
 * paid by), one FOR line, ONE framed "Amount received" box with the amount large and in words, and a three-part
 * summary (total, paid to date, balance remaining or "Paid in full" with a green check). No lines table and the
 * amount printed once: the old receipt repeated it seven times. One template for every receipt, deposits and
 * payments alike; the customer's link opens this same PDF. The footer note is the owner's wording in Settings.
 */
export async function renderReceiptPdf(data: ReceiptData, settings: Settings): Promise<Buffer> {
  const { payment, customer, vehicle, summary } = data;
  const currency = currencyOf(settings);
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), data.invoiceToken ? qrPng(`${PRODUCTION_SITE_URL}/invoice/${data.invoiceToken}`) : Promise.resolve(null)]);
  const pending = payment.method === "cheque" && payment.cheque_status === "pending" && payment.status === "recorded";
  const voided = payment.status === "voided" || payment.status === "reversed";
  const note = String(settings.receipt_footer_note ?? "").trim();
  const boxes: Box[] = [
    {
      title: "Received from",
      strong: customer?.company_name ?? customer?.full_name ?? "Customer",
      lines: [customer?.company_name ? customer.full_name : null, customer?.phone ?? null],
      muted: [customer?.trn ? `TRN ${customer.trn}` : null],
    },
    ...(vehicle
      ? [{ title: "Vehicle", strong: vehicle.title ?? vehicle.plate, rows: [["Plate", vehicle.title ? vehicle.plate : null], ["VIN", vehicle.vin]] } as Box]
      : []),
    {
      title: "Paid by",
      strong: METHOD_LABELS[payment.method] ?? payment.method,
      rows: [
        ["Auth code", payment.auth_code ?? null],
        ["Reference", payment.reference],
        ["Cheque no.", payment.cheque_number],
        ["Bank", payment.cheque_bank],
        ["Cheque date", payment.cheque_date ? formatDate(payment.cheque_date) : null],
        ["Received", formatDateTime(payment.received_at)],
      ],
      muted: [pending ? "Cheque pending clearance" : null],
    },
  ];
  const doc = (
    <PdfDocument
      title={`Receipt ${payment.number}`}
      company={company}
      logo={logo}
      qr={qr}
      uppercase={settings.customer_documents_uppercase === true}
      scanLabel={"Scan to view\nthe invoice online"}
      footerLines={[pending ? "This receipt is for a cheque that has not cleared yet. It counts as unpaid until it clears." : null].filter((x): x is string => !!x)}
    >
      <TitleRow
        title="RECEIPT"
        meta={[
          { label: "Receipt no.", value: payment.number },
          { label: "Date", value: formatDate(payment.received_at) },
          data.docRef ? { label: data.docRef.label, value: data.docRef.value } : null,
          data.jobNumber ? { label: "Job card", value: data.jobNumber } : null,
        ]}
      />
      {voided ? (
        <View style={{ borderWidth: 1.5, borderColor: RED, borderRadius: 5, padding: px(8), marginBottom: px(8) }} wrap={false}>
          <Text style={{ color: RED, fontWeight: 700 }}>VOIDED — this receipt was cancelled{payment.void_reason ? `: ${payment.void_reason}` : "."}</Text>
        </View>
      ) : null}
      <InfoBoxes boxes={boxes} />
      <View style={{ marginTop: px(2) }}>
        <Text style={styles.smallTitle}>For</Text>
        <Text style={{ fontSize: px(12.5) }}>{data.forLine}</Text>
      </View>
      <View style={{ borderWidth: 1.6, borderColor: INK, borderRadius: 6, paddingVertical: px(11), paddingHorizontal: px(13), marginTop: px(11), flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: px(10) }} wrap={false}>
        <View style={{ flexShrink: 1, paddingRight: px(8) }}>
          <Text style={styles.smallTitle}>Amount received</Text>
          <Text style={{ fontSize: px(10.5), color: GREY }}>{amountInWords(payment.amount_aed)}</Text>
        </View>
        <Amount value={payment.amount_aed} currency={currency} size={px(21)} bold />
      </View>
      {summary ? (
        <View style={{ flexDirection: "row", gap: px(7), marginTop: px(9) }} wrap={false}>
          <SummaryCell label={summary.totalLabel}>
            <Amount value={summary.total} currency={currency} size={px(12.5)} bold align="flex-start" />
          </SummaryCell>
          <SummaryCell label="Paid to date">
            <Amount value={summary.paid} currency={currency} size={px(12.5)} bold align="flex-start" />
          </SummaryCell>
          {summary.paidInFull ? (
            <SummaryCell label="Balance">
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <CheckMark color={GREEN} size={px(11)} />
                <Text style={{ color: GREEN, fontWeight: 700, fontSize: px(12.5) }}>Paid in full</Text>
              </View>
            </SummaryCell>
          ) : (
            <SummaryCell label="Balance remaining">
              <Amount value={summary.balance} currency={currency} size={px(12.5)} bold align="flex-start" />
              {summary.pendingCheque ? <Text style={{ fontSize: px(8.5), color: GREY }}>Cheque pending clearance counted once cleared</Text> : null}
            </SummaryCell>
          )}
        </View>
      ) : null}
      {note ? <Text style={[styles.small, { marginTop: px(12) }]}>{note}</Text> : null}
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
    const positions = l.part_item_id ? (bundle.parts ?? []).find((p) => p.id === l.part_item_id)?.positions : null;
    return { partNumber: l.part_number, name: l.description, sub: positionsWords(positions) || null, qty: qtyText(l.quantity), list, disc: Math.max(0, disc), net, vat, total: round2(net + vat) };
  });
  // The supplier's own charges on this order (courier, freight): one row each, after the parts.
  for (const c of bundle.charges ?? []) {
    const vatC = round2(c.amount_aed * (vatPercent / 100));
    rows.push({ partNumber: null, name: c.description, qty: "1", list: c.amount_aed, disc: 0, net: c.amount_aed, vat: vatC, total: round2(c.amount_aed + vatC) });
  }
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
