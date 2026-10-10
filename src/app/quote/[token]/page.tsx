import type { Metadata } from "next";
import { CustomerDocument, DocLines, DocTotals, type DocRow } from "@/components/CustomerDocument";
import { Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate, formatDateTime } from "@/lib/format";
import { feeNotice } from "@/lib/jobs";
import { notifyStaff } from "@/lib/notifications";
import { loadQuotation } from "@/lib/quote-data";
import { aed, blockOf, isHidden, isUnchosen, lineQuantityText, lineTotal, lineUnitPrice, partAvailabilityText, partTypeText, quoteTotals } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { dubaiDate } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { QuoteResponse } from "./QuoteResponse";

export const dynamic = "force-dynamic";

/** Has this moment passed? Kept outside the page so the render stays free of clock calls. */
function isPastNow(iso: string | null) {
  return !!iso && Date.parse(iso) < Date.now();
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { data } = await createAdminClient().from("quotations").select("kind").eq("token", token).maybeSingle();
  return data?.kind === "estimate"
    ? customerPageMetadata("OFJ Automotive, Your Estimate", "Review your estimate and accept the work you would like us to do")
    : customerPageMetadata("OFJ Automotive, Your Quotation", "Review your quotation and approve the work you would like us to do");
}

/** The customer's quotation, laid out like the document itself, with Approved and Declined in a bar at the bottom. */
export default async function CustomerQuotePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const plain = (children: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto max-w-2xl px-4 py-8">{children}</main>
    </div>
  );
  const { data: row } = await admin.from("quotations").select("id, kind, status, valid_until").eq("token", token).maybeSingle();
  if (!row) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const isEstimate = row.kind === "estimate";

  // First opening: remembered and the advisor told.
  if (row.status === "sent") await admin.from("quotations").update({ status: "opened", opened_at: new Date().toISOString() }).eq("id", row.id);
  const expired = (row.status === "sent" || row.status === "opened") && isPastNow(row.valid_until);
  if (expired) await admin.from("quotations").update({ status: "expired" }).eq("id", row.id);
  const bundle = await loadQuotation(row.id);
  if (!bundle) return plain(<Notice tone="error">This quotation is no longer available.</Notice>);
  const { quotation: q, customer, vehicle, job } = bundle;
  if (row.status === "sent") {
    const ids = [q.created_by, q.sent_by, job?.gated_in_by].filter((x): x is string => !!x);
    await notifyStaff(ids, { type: "quote_opened", title: `Customer opened ${isEstimate ? "the estimate" : "the quotation"} · ${q.number}`, body: vehicle ? formatPlate(vehicle) : "", jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}` : `/estimates/${q.id}` });
  }
  if (q.status === "superseded" || q.status === "cancelled" || q.status === "draft" || q.status === "pending_owner") return plain(<Notice tone="info">This {isEstimate ? "estimate" : "quotation"} has been replaced. Please use the newest link the workshop sent you.</Notice>);

  // Internal lines and unused options never reach the customer.
  const lines = bundle.lines.filter((l) => l.is_active && !isHidden(l) && !isUnchosen(l));
  const totals = quoteTotals(lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const customerName = q.sent_to_name ?? customer?.company_name ?? customer?.full_name ?? "Customer";
  const carName = [vehicle?.make?.name, vehicle?.model?.name, vehicle?.model_year].filter(Boolean).join(" ");
  const dangerous = !isEstimate && lines.some((l) => l.dangerous);
  const title = isEstimate ? "Estimate" : q.version > 1 ? "Revised quotation" : "Quotation";
  const money = (n: number) => aed(n).replace("AED ", "");
  const today = dubaiDate();
  let n = 0;
  const rowOf = (l: (typeof lines)[number]): DocRow => {
    n++;
    const part = l.part_item_id ? bundle.parts.find((p) => p.id === l.part_item_id) : null;
    const details = [l.line_type === "part" ? partTypeText(l) : null, part?.part_number ?? null, l.line_type === "part" ? partAvailabilityText(part, today) : null, l.details].filter(Boolean).join(" · ") || null;
    return { n, description: l.line_type === "part" && part?.part_number && l.title.endsWith(`(${part.part_number})`) ? l.title.slice(0, -(part.part_number.length + 2)).trim() : l.title, details, tag: !isEstimate && l.urgency === "urgent" ? "Urgent" : null, qty: lineQuantityText(l), rate: money(lineUnitPrice(l)), amount: lineTotal(l) === 0 ? "Complimentary" : money(lineTotal(l)), amountNum: lineTotal(l) };
  };
  const labour = lines.filter((l) => blockOf(l) === "labour").map(rowOf);
  const parts = lines.filter((l) => blockOf(l) === "parts").map(rowOf);
  const other = lines.filter((l) => blockOf(l) === "other").map(rowOf);
  const open = q.status === "sent" || q.status === "opened";

  return (
    <CustomerDocument
      company={company}
      title={title}
      meta={[
        { label: isEstimate ? "Estimate no." : "Quotation no.", value: `${q.number}${q.version > 1 ? ` v${q.version}` : ""}` },
        { label: "Date", value: formatDate(q.sent_at ?? q.created_at) },
        { label: "Valid until", value: q.valid_until ? formatDate(q.valid_until) : `${q.validity_days} days` },
        ...(job ? [{ label: "Job card", value: job.job_number }] : []),
      ]}
      boxes={[
        { title: isEstimate ? "Estimate for" : "Quotation for", strong: customer?.company_name ?? customer?.full_name ?? "Customer", rows: [["", customer?.company_name ? customer.full_name : null], ["", customer?.phone ?? null]], muted: [customer?.trn ? `TRN ${customer.trn}` : null] },
        { title: "Vehicle", strong: [carName || "Vehicle", vehicle ? formatPlate(vehicle) : null].filter(Boolean).join(" · "), rows: [["", vehicle?.variant ?? null], ["VIN", vehicle?.vin ?? null]] },
      ]}
      pdfHref={`/api/pdf/quote/${token}`}
      uppercase={settings.customer_documents_uppercase === true}
      bar={open ? <QuoteResponse token={token} customerName={customerName} total={totals.total} declaration={settings.declaration_text} declarationAr={settings.declaration_text_ar} feeNotice={feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed)} feeNoticeAr={feeNotice(settings.inspection_fee_notice_ar, settings.inspection_fee_aed)} isEstimate={isEstimate} terms={settings.terms_and_conditions} termsAr={settings.terms_and_conditions_ar} dangerText={dangerous ? settings.dangerous_acknowledgement_text : null} /> : null}
      footer={<>{isEstimate ? "The final price is confirmed once the vehicle is with us." : `Prices in UAE dirhams; VAT at ${q.vat_percent}% shown separately.`} {!isEstimate ? feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed) : ""}</>}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {q.status === "approved" ? (
        <div className="rounded-card border-2 border-ink p-4 text-center">
          <div className="text-xl font-extrabold">Thank you</div>
          <div className="text-sm">{isEstimate ? "Accepted" : "Approved"} by {q.approver_name} on {formatDateTime(q.responded_at)}. {isEstimate ? "We will book the car in with you." : "We are planning the work and will tell you the date."}</div>
        </div>
      ) : null}
      {q.status === "declined" ? <Notice tone="info">Declined by {q.approver_name} on {formatDateTime(q.responded_at)}. {!isEstimate ? feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed) : ""}</Notice> : null}
      {q.status === "urgent_requested" ? <Notice tone="info">You asked for a revised quotation on {formatDateTime(q.responded_at)}. We will send you a new link.</Notice> : null}
      {q.status === "expired" ? <Notice tone="error">This {isEstimate ? "estimate" : "quotation"} expired on {formatDate(q.valid_until)}. Please ask the workshop for a new one.</Notice> : null}
      {dangerous ? (
        <div className="rounded-card border-2 border-red-bar p-4 flex flex-col gap-1">
          <span className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-red">Safety warning</span>
          <p className="text-sm whitespace-pre-wrap">{settings.dangerous_customer_text}</p>
          {settings.dangerous_customer_text_ar ? <p className="text-sm whitespace-pre-wrap" dir="rtl" lang="ar">{settings.dangerous_customer_text_ar}</p> : null}
        </div>
      ) : null}
      {labour.length ? <DocLines title="Labour and services" rows={labour} vatPercent={Number(q.vat_percent) || 5} discount={totals.discount ? { label: `Discount ${q.discount_percent}% on labour and services`, amount: totals.discount } : null} subtotalLabel="Labour and services subtotal" /> : null}
      {parts.length ? <DocLines title="Parts" rows={parts} vatPercent={Number(q.vat_percent) || 5} subtotalLabel="Parts subtotal" /> : null}
      {other.length ? <DocLines title="Other charges" rows={other} vatPercent={Number(q.vat_percent) || 5} subtotalLabel="Other charges subtotal" /> : null}
      <DocTotals
        rows={[
          { label: "Subtotal", value: money(totals.subtotal) },
          ...(totals.discount ? [{ label: `Discount ${q.discount_percent}%`, value: `− ${money(totals.discount)}`, bold: true }] : []),
          ...(totals.rounding ? [{ label: "Rounding", value: `${totals.rounding < 0 ? "− " : ""}${money(Math.abs(totals.rounding))}` }] : []),
          { label: "Taxable amount", value: money(totals.net) },
          { label: `VAT ${q.vat_percent}%`, value: money(totals.vat) },
        ]}
        total={{ label: "Total AED", value: money(totals.total) }}
        after={totals.deposit ? [{ label: "Deposit required", value: money(totals.deposit), bold: true }] : []}
        box={{ label: isEstimate ? "Estimate total" : "Quotation total", value: aed(totals.total), note: q.valid_until ? `Valid until ${formatDate(q.valid_until)}` : null }}
      />
      {q.customer_note ? <div className="rounded-control border border-line p-3 text-sm whitespace-pre-wrap">{q.customer_note}</div> : null}
    </CustomerDocument>
  );
}
