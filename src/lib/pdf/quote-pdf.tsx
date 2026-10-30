import { isPickupShownByPackage, packagesGivePickup } from "../packages";
import { customerCompWord } from "../complimentary";
import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatDateTime } from "@/lib/format";
import { amountInWords } from "@/lib/money";
import type { QuoteBundle } from "@/lib/quote-data";
import { discountLabelOf, blockOf, isComplimentary, isHidden, isUnchosen, lineDiscountAmount, linePrice, lineTotal, lineUnitPrice, partAvailabilityText, partTypeText, quoteTotals, round2, hasPackageLine } from "@/lib/quotes";
import { positionsWords } from "@/lib/parts-list";
import type { Settings } from "@/lib/settings";
import { dubaiDate } from "@/lib/jobs";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { loadLogo } from "./images";
import { qrPng } from "./qr";
import { createAdminClient } from "@/lib/supabase/admin";
import { packageDetailsText, packageDocOf } from "../packages";
import { CUT_EXPLAIN, cutWords, lineIsPpf } from "@/lib/ppf-cut";
import { cleanTintSpec, decorateTint, lineTintWords } from "@/lib/tint";
import { tintLimitOf, tintSpecForJob } from "@/lib/tint-data";
import { DocumentTail, GREY, InfoBoxes, PackageSection, PdfDocument, SectionBox, TitleRow, TotalsBox, companyOf, currencyOf, px, qtyText, styles, type SectionLine } from "./template";
import { additionalToOf, estimateAddsTo } from "@/lib/quote-history-data";
import { additionalEstimateLine, additionalLine } from "@/lib/quote-history";

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
  const kindOfService = new Map((svcRows ?? []).map((s) => [s.id, s.bodyshop_kind]));
  const bodyshopNotes = [kindSet.has("ppf") || kindSet.has("coloured_ppf") ? `${String(settings.ppf_brand_name || "OFJ Bespoke PPF")} · ${Number(settings.ppf_warranty_years) || 10}-year warranty: a written certificate comes with the car at handover.` : null, kindSet.has("ppf_removal") ? String(settings.ppf_removal_note || "") : null].filter((x): x is string => !!x);
  const partOf = (id: string | null) => (id ? bundle.parts.find((p) => p.id === id) : undefined);
  const today = dubaiDate();
  // Section 11: the job's tint specification puts the shades on the tint items ("· 50% darkness").
  const tintSpec = cleanTintSpec(q.tint_spec) ?? (await tintSpecForJob(q.job_id));
  const tintLimit = tintLimitOf(settings);
  const toDoc = (l: (typeof lines)[number]): SectionLine => {
    const amount = lineTotal(l);
    const unit = lineUnitPrice(l);
    const part = partOf(l.part_item_id);
    // Part numbers are never shown to the customer; an old title that still carries one in brackets loses it here.
    const number = part?.part_number ?? (l.line_type === "part" ? (l.title.match(/\(([^()]+)\)\s*$/)?.[1] ?? null) : null);
    const title = l.line_type === "part" && number && l.title.endsWith(`(${number})`) ? l.title.slice(0, -(number.length + 2)).trim() : l.title;
    return {
      description: title,
      // The positions on their own line first (ALL 4, FRONT PAIR…); then a part's availability in plain words (Today, Tomorrow, In 2 days) as the small grey line, then its type.
      positions: positionsWords(l.positions) || null,
      details: l.package_items ? packageDetailsText(l.package_items) : [l.line_type === "part" ? partAvailabilityText(part ?? null, today) : null, l.line_type === "part" ? partTypeText(l) : null, l.details, !l.package_items && lineIsPpf(l, kindOfService.get(l.service_id ?? "") ?? null) ? cutWords(l.cut_method, l.cut_note) : null, lineTintWords(l, kindOfService.get(l.service_id ?? "") ?? null, tintSpec, tintLimit)].filter(Boolean).join(" · ") || null,
      qty: l.line_type === "labour" ? qtyText(l.quantity, l.hours ?? 0) : qtyText(l.quantity || 1),
      rate: unit,
      amount,
      complimentary: isComplimentary(l) || amount === 0,
      // Section 5.6: goodwill "COMPLIMENTARY (value AED 350.00)", our mistake or warranty "NO CHARGE". Never our cost.
      compWord: isComplimentary(l) ? customerCompWord(l, q.comp_reason) : undefined,
      discountPercent: (l.discount_percent ?? 0) > 0 ? l.discount_percent : undefined,
      discountAmount: (l.discount_percent ?? 0) > 0 ? lineDiscountAmount(l) : undefined,
      tag: l.urgency === "urgent" && !isEstimate ? "Urgent" : null,
    };
  };
  // Section 9: a bodyshop package has its own PROTECTION PACKAGE section; the rest of the work stays in Labour and services.
  const pkgLines = lines.filter((l) => blockOf(l) === "labour" && !!l.package_key);
  const services = lines.filter((l) => blockOf(l) === "labour" && !l.package_key).map(toDoc);
  const parts = lines.filter((l) => blockOf(l) === "parts").map(toDoc);
  // Section 6.3: a package that shows "Complimentary pick-up & drop-off" as its badge says it once - the free recovery
  // line is left off the customer's copy (its cost stays internal), and an empty Other charges section is not printed.
  const pickupInPackage = packagesGivePickup(pkgLines.map((l) => l.package_items));
  const others = lines.filter((l) => blockOf(l) === "other" && !(pickupInPackage && isPickupShownByPackage(l, lineTotal(l)))).map(toDoc);
  const dangerous = !isEstimate && lines.some((l) => l.dangerous);
  const company = companyOf(settings);
  const [logo, qr] = await Promise.all([loadLogo(), q.token ? qrPng(`${PRODUCTION_SITE_URL}/quote/${q.token}`) : Promise.resolve(null)]);
  const carName = vehicle ? [vehicle.make?.name, vehicle.model?.name, vehicle.model_year].filter(Boolean).join(" ") : "";
  const statusLine = q.status === "approved" ? `${isEstimate ? "Accepted" : "Approved"} by ${q.approver_name} on ${formatDateTime(q.responded_at)}.` : q.status === "declined" ? `Declined by ${q.approver_name} on ${formatDateTime(q.responded_at)}.` : null;
  const discountLabel = discountLabelOf(q, { hasPackage: hasPackageLine(lines) });
  // An additional quotation (29 October 2026): its own title and the quotation(s) it adds to.
  // An additional estimate (30 October 2026) says so like an additional quotation, naming the estimate it adds to.
  const estBase = isEstimate ? await estimateAddsTo(q) : null;
  const addsToLine = isEstimate ? additionalEstimateLine(estBase) : additionalLine(await additionalToOf(q.job_id, q.number));

  const doc = (
    <PdfDocument title={`${isEstimate ? "Estimate" : "Quotation"} ${q.number}`} company={company} logo={logo} qr={qr} uppercase={settings.customer_documents_uppercase === true} footerLines={[]} scanLabel={`Scan to view\nthis ${isEstimate ? "estimate" : "quotation"} online`}>
      <TitleRow
        title={isEstimate ? (estBase ? "ADDITIONAL ESTIMATE" : "ESTIMATE") : addsToLine ? "ADDITIONAL QUOTATION" : q.version > 1 ? "REVISED QUOTATION" : "QUOTATION"}
        meta={[
          { label: isEstimate ? "Estimate no." : "Quotation no.", value: `${q.number}${q.version > 1 ? ` v${q.version}` : ""}` },
          { label: "Date", value: formatDate(q.sent_at ?? q.created_at) },
          { label: "Valid until", value: q.valid_until ? formatDate(q.valid_until) : `${q.validity_days} days` },
          job ? { label: "Job card", value: job.job_number } : null,
        ]}
      />
      {addsToLine ? <Text style={{ fontSize: px(12), fontWeight: 700, marginTop: px(-8), marginBottom: px(12) }}>{addsToLine}</Text> : null}
      <InfoBoxes
        boxes={[
          { title: isEstimate ? "Estimate for" : "Quotation for", strong: customer?.company_name ?? customer?.full_name ?? "Customer", lines: [customer?.company_name ? customer.full_name : null, [customer?.phone, customer?.email].filter(Boolean).join(" · ") || null], muted: [customer?.trn ? `TRN ${customer.trn}` : null] },
          vehicle?.kind === "loose" ? { title: "Items", strong: vehicle.variant ?? "Loose items" } : { title: "Vehicle", strong: [carName || "Vehicle", vehicle ? formatPlate(vehicle) : null].filter(Boolean).join(" · "), lines: [vehicle?.variant ?? null, vehicle?.vin ? `VIN ${vehicle.vin}` : null] },
        ]}
      />
      {pkgLines.map((l) => {
        const docModel = packageDocOf(l.package_items, { car: carName || null, decorate: decorateTint(tintSpec, tintLimit), ppfNote: lineIsPpf(l) ? cutWords(l.cut_method, l.cut_note) : null, ppfExplain: CUT_EXPLAIN });
        return docModel ? <PackageSection key={l.id} doc={docModel} price={linePrice(l)} subtotal={lineTotal(l)} discount={(l.discount_percent ?? 0) > 0 ? { percent: l.discount_percent ?? null, amount: lineDiscountAmount(l) } : null} /> : null;
      })}
      {services.length || !pkgLines.length ? <SectionBox title="Labour and services" lines={services} subtotalLabel="Labour and services subtotal" /> : null}
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
              // Before any discount: the green rows underneath then take the discounts off, so the story reads top to bottom.
              ...(pkgLines.length ? [{ label: totals.lineDiscounts > 0 ? "Protection package (before discount)" : "Protection package", value: round2(pkgLines.reduce((a, l) => a + linePrice(l), 0)) }] : []),
              ...(services.length || !pkgLines.length ? [{ label: totals.lineDiscounts > 0 ? "Labour and services (before discount)" : "Labour and services", value: round2(lines.filter((l) => blockOf(l) === "labour" && !l.package_key).reduce((a, l) => a + linePrice(l), 0)) }] : []),
              ...(parts.length || !pkgLines.length ? [{ label: "Parts", value: round2(lines.filter((l) => blockOf(l) === "parts").reduce((a, l) => a + linePrice(l), 0)) }] : []),
              ...(others.length ? [{ label: "Other charges", value: round2(lines.filter((l) => blockOf(l) === "other").reduce((a, l) => a + linePrice(l), 0)) }] : []),
            ]}
            green={[
              ...(totals.lineDiscounts > 0 ? [{ label: "Discount", value: totals.lineDiscounts }] : []),
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
