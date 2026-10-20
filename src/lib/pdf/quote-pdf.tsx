import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatDateTime } from "@/lib/format";
import { amountInWords } from "@/lib/money";
import type { QuoteBundle } from "@/lib/quote-data";
import { discountLabelOf,blockOf, isHidden, isUnchosen, lineTotal, lineUnitPrice, partAvailabilityText, partTypeText, quoteTotals, withPositions } from "@/lib/quotes";
import type { Settings } from "@/lib/settings";
import { dubaiDate } from "@/lib/jobs";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { loadLogo } from "./images";
import { qrPng } from "./qr";
import { createAdminClient } from "@/lib/supabase/admin";
import { packageDetailsText } from "../packages";
import { DocumentTail, GREY, InfoBoxes, PdfDocument, SectionBox, TitleRow, TotalsBox, companyOf, currencyOf, px, qtyText, styles, type SectionLine } from "./template";

/**
 * The customer's quotation or estimate on the document template: the header, two grey boxes, three bordered boxes
 * (Labour and services, Parts, Other charges) numbered from 1 each, the totals box with the labour discount and the
 * round-off in bold green. No internal costs, margins, commission, hidden lines, bank charges or part numbers.
 */
export async function renderQuotePdf(bundle: QuoteBundle, settings: Settings): Promise<Buffer> {
  const { quotation: q, customer, vehicle, job } = bundle;
  const isEstimate = q.kind === "estimate";
  const currency = currencyOf(settings);
  const vatPct = Number(q.vat_percent) || 5;
  const lines = bundle.lines.filter((l) => l.is_active && !isHidden(l) && !isUnchosen(l));
  const totals = quoteTotals(lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  // Bodyshop packages: the PPF warranty line and the old-film note under the services.
  const svcIds = Array.from(new Set(lines.map((l) => l.service_id).filter((x): x is string => !!x)));
  const { data: svcRows } = svcIds.length ? await createAdminClient().from("services").select("id, bodyshop_kind").in("id", svcIds) : { data: [] as { id: string; bodyshop_kind: string | null }[] };
  const kindSet = new Set((svcRows ?? []).map((s) => s.bodyshop_kind).filter((k): k is string => !!k));
  const bodyshopNotes = [kindSet.has("ppf") || kindSet.has("coloured_ppf") ? `${String(settings.ppf_brand_name || "OFJ PPF")} · ${Number(settings.ppf_warranty_years) || 10}-year warranty: a written certificate comes with the car at handover.` : null, kindSet.has("ppf_removal") ? String(settings.ppf_removal_note || "") : null].filter((x): x is string => !!x);
  const partOf = (id: string | null) => (id ? bundle.parts.find((p) => p.id === id) : undefined);
  const today = dubaiDate();
  const toDoc = (l: (typeof lines)[number]): SectionLine => {
    const amount = lineTotal(l);
    const unit = lineUnitPrice(l);
    const part = partOf(l.part_item_id);
    // Part numbers are never shown to the customer; an old title that still carries one in brackets loses it here.
    const number = part?.part_number ?? (l.line_type === "part" ? (l.title.match(/\(([^()]+)\)\s*$/)?.[1] ?? null) : null);
    const title = l.line_type === "part" && number && l.title.endsWith(`(${number})`) ? l.title.slice(0, -(number.length + 2)).trim() : l.title;
    return {
      description: withPositions(title, l.positions),
      // A part: its availability in plain words (Today, Tomorrow, In 2 days) as the small grey line, then its type.
      details: l.package_items ? packageDetailsText(l.package_items) : [l.line_type === "part" ? partAvailabilityText(part ?? null, today) : null, l.line_type === "part" ? partTypeText(l) : null, l.details].filter(Boolean).join(" · ") || null,
      qty: l.line_type === "labour" ? qtyText(l.quantity, l.hours ?? 0) : qtyText(l.quantity || 1),
      rate: unit,
      amount,
      complimentary: amount === 0,
      tag: l.urgency === "urgent" && !isEstimate ? "Urgent" : null,
    };
  };
  const services = lines.filter((l) => blockOf(l) === "labour").map(toDoc);
  const parts = lines.filter((l) => blockOf(l) === "parts").map(toDoc);
  const others = lines.filter((l) => blockOf(l) === "other").map(toDoc);
  const dangerous = !isEstimate && lines.some((l) => l.dangerous);
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), q.token ? qrPng(`${PRODUCTION_SITE_URL}/quote/${q.token}`) : Promise.resolve(null)]);
  const carName = vehicle ? [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ") : "";
  const statusLine = q.status === "approved" ? `${isEstimate ? "Accepted" : "Approved"} by ${q.approver_name} on ${formatDateTime(q.responded_at)}.` : q.status === "declined" ? `Declined by ${q.approver_name} on ${formatDateTime(q.responded_at)}.` : null;
  const discountLabel = discountLabelOf(q);

  const doc = (
    <PdfDocument title={`${isEstimate ? "Estimate" : "Quotation"} ${q.number}`} company={company} logo={logo} qr={qr} uppercase={settings.customer_documents_uppercase === true} footerLines={[]} scanLabel={`Scan to view\nthis ${isEstimate ? "estimate" : "quotation"} online`}>
      <TitleRow
        title={isEstimate ? "ESTIMATE" : q.version > 1 ? "REVISED QUOTATION" : "QUOTATION"}
        meta={[
          { label: isEstimate ? "Estimate no." : "Quotation no.", value: `${q.number}${q.version > 1 ? ` v${q.version}` : ""}` },
          { label: "Date", value: formatDate(q.sent_at ?? q.created_at) },
          { label: "Valid until", value: q.valid_until ? formatDate(q.valid_until) : `${q.validity_days} days` },
          job ? { label: "Job card", value: job.job_number } : null,
        ]}
      />
      <InfoBoxes
        boxes={[
          { title: isEstimate ? "Estimate for" : "Quotation for", strong: customer?.company_name ?? customer?.full_name ?? "Customer", lines: [customer?.company_name ? customer.full_name : null, [customer?.phone, customer?.email].filter(Boolean).join(" · ") || null], muted: [customer?.trn ? `TRN ${customer.trn}` : null] },
          vehicle?.kind === "loose" ? { title: "Items", strong: vehicle.variant ?? "Loose items" } : { title: "Vehicle", strong: [carName || "Vehicle", vehicle ? formatPlate(vehicle) : null].filter(Boolean).join(" · "), lines: [vehicle?.variant ?? null, vehicle?.vin ? `VIN ${vehicle.vin}` : null] },
        ]}
      />
      <SectionBox title="Labour and services" lines={services} subtotalLabel="Labour and services subtotal" />
      {bodyshopNotes.map((note) => <Text key={note} style={{ fontSize: px(9.5), color: GREY, marginTop: px(-4), marginBottom: px(8) }}>{note}</Text>)}
      {parts.length ? <SectionBox title="Parts" lines={parts} subtotalLabel="Parts subtotal" /> : null}
      {others.length ? <SectionBox title="Other charges" lines={others} subtotalLabel="Other charges subtotal" /> : null}
      <DocumentTail
        words={amountInWords(totals.total)}
        bank={isEstimate ? null : company.bank}
        totals={
          <TotalsBox
            currency={currency}
            sections={[
              { label: "Labour and services", value: totals.labourSell },
              { label: "Parts", value: totals.partsSell },
              ...(others.length ? [{ label: "Other charges", value: totals.otherSell }] : []),
            ]}
            green={[
              ...(totals.discount ? [{ label: discountLabel, value: totals.discount }] : []),
              ...(totals.rounding < 0 ? [{ label: "Round-off", value: Math.abs(totals.rounding) }] : []),
            ]}
            net={totals.net}
            vatPercent={vatPct}
            vat={totals.vat}
            total={totals.total}
            after={[
              ...(totals.rounding > 0 ? [{ label: "Rounding", value: totals.rounding }] : []),
              ...(totals.deposit ? [{ label: "Deposit required", value: totals.deposit, bold: true }] : []),
            ]}
            status={{ title: isEstimate ? "Estimate total" : "Quotation total", value: totals.total, note: q.promised_at && !isEstimate ? `Promised date ${formatDate(q.promised_at)}` : isEstimate ? "Final price confirmed once the vehicle is with us" : null }}
          />
        }
        notes={
          <>
            {dangerous ? (
              <View style={styles.note} wrap={false}>
                <Text style={styles.smallTitle}>Safety warning</Text>
                <Text>{settings.dangerous_customer_text}</Text>
              </View>
            ) : null}
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
          </>
        }
      />
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
