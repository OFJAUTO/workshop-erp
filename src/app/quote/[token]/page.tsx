import type { Metadata } from "next";
import { ContactButtons, CustomerFront, advisorContact, customerBoxes } from "@/components/CustomerFront";
import { Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate, formatDateTime } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import { loadQuotation } from "@/lib/quote-data";
import { discountLabelOf,aed, isHidden, isUnchosen, quoteTotals } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { QuoteResponse } from "./QuoteResponse";

export const dynamic = "force-dynamic";

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

/**
 * The customer's quotation or estimate. The first page: the number and dates, the customer and the car,
 * the grand total in large print, one "View quotation" button and one "Approved" button, then Call and
 * WhatsApp. "?view=1" opens the full document (recorded, so the job shows whether it was read before approving).
 */
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
  // The link always opens the latest version the customer was sent: an older link follows the number to the newest one.
  const { data: byToken } = await admin.from("quotations").select("id, kind, number").eq("token", token).maybeSingle();
  if (!byToken) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const { data: latest } = await admin.from("quotations").select("id, kind, status, valid_until, viewed_full_at, token, version, sent_at").eq("number", byToken.number).eq("kind", byToken.kind).eq("is_active", true).not("status", "in", "(draft,pending_owner,cancelled)").order("version", { ascending: false }).limit(1).maybeSingle();
  const row = latest ?? null;
  if (!row) return plain(<Notice tone="info">This quotation is being updated. The new version will be sent to you shortly.</Notice>);
  const liveToken = row.token ?? token;
  const isEstimate = row.kind === "estimate";

  // First opening: remembered and the advisor told. Opening the PDF is remembered by the PDF route.
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
  if (q.status === "superseded" || q.status === "cancelled" || q.status === "draft" || q.status === "pending_owner") return plain(<Notice tone="info">This {isEstimate ? "estimate" : "quotation"} is being updated. The new version will be sent to you shortly.</Notice>);

  // Internal lines, unused options and parts left off never reach the customer.
  const lines = bundle.lines.filter((l) => l.is_active && !isHidden(l) && !isUnchosen(l) && !l.left_off);
  // Bodyshop packages on the quotation: the PPF warranty block and the old-film acknowledgement.
  const svcIds = Array.from(new Set(lines.map((l) => l.service_id).filter((x): x is string => !!x)));
  const { data: svcKinds } = svcIds.length ? await admin.from("services").select("id, bodyshop_kind").in("id", svcIds) : { data: [] as { id: string; bodyshop_kind: string | null }[] };
  const kinds = new Set((svcKinds ?? []).map((s) => s.bodyshop_kind).filter((k): k is string => !!k));
  const hasPpf = kinds.has("ppf") || kinds.has("coloured_ppf");
  const hasRemoval = kinds.has("ppf_removal");
  const totals = quoteTotals(lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const customerName = q.sent_to_name ?? customer?.company_name ?? customer?.full_name ?? "Customer";
  const carName = [vehicle?.make?.name, vehicle?.model?.name, vehicle?.model_year].filter(Boolean).join(" ");
  const dangerous = !isEstimate && lines.some((l) => l.dangerous);
  const title = isEstimate ? "Estimate" : q.version > 1 ? "Revised quotation" : "Quotation";
  const open = q.status === "sent" || q.status === "opened";
  const meta = [
    { label: isEstimate ? "Estimate no." : "Quotation no.", value: `${q.number}${q.version > 1 ? ` v${q.version}` : ""}` },
    { label: "Date", value: formatDate(q.sent_at ?? q.created_at) },
    { label: "Valid until", value: q.valid_until ? formatDate(q.valid_until) : `${q.validity_days} days` },
    ...(job ? [{ label: "Job card", value: job.job_number }] : []),
  ];
  const boxes = customerBoxes(customer ? { full_name: customer.full_name, company_name: customer.company_name, phone: customer.phone } : null, vehicle ? { kind: vehicle.kind ?? null, variant: vehicle.variant ?? null, vin: vehicle.vin ?? null, plate: formatPlate(vehicle), title: carName || "Vehicle" } : null);
  const statusNotes = (
    <>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {q.status === "approved" ? (
        <div className="rounded-lg border-2 border-green bg-green-soft p-4 text-center">
          <div className="text-xl font-extrabold">Thank you</div>
          <div className="text-sm">{isEstimate ? "Accepted" : "Approved"} on {formatDateTime(q.responded_at)}{q.approved_total_aed ? ` for ${aed(q.approved_total_aed)}` : ""}. {isEstimate ? "We will book the car in with you." : "We are planning the work and will tell you the date."}</div>
        </div>
      ) : null}
      {q.status === "declined" ? <Notice tone="info">This {isEstimate ? "estimate" : "quotation"} was closed on {formatDateTime(q.responded_at)}. Please contact us for a revised one.</Notice> : null}
      {q.status === "urgent_requested" ? <Notice tone="info">You asked for a revised quotation on {formatDateTime(q.responded_at)}. We will send you a new link.</Notice> : null}
      {q.status === "expired" ? <Notice tone="error">This {isEstimate ? "estimate" : "quotation"} expired on {formatDate(q.valid_until)}. Please ask us for a new one.</Notice> : null}
      {dangerous ? (
        <div className="rounded-lg border-2 border-red-bar p-4 flex flex-col gap-1">
          <span className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-red">Safety warning</span>
          <p className="text-sm whitespace-pre-wrap">{settings.dangerous_customer_text}</p>
          {settings.dangerous_customer_text_ar ? <p className="text-sm whitespace-pre-wrap" dir="rtl" lang="ar">{settings.dangerous_customer_text_ar}</p> : null}
        </div>
      ) : null}
    </>
  );

  {
    const advisor = await advisorContact(admin, [q.sent_by, q.created_by, job?.gated_in_by]);
    return (
      <CustomerFront
        company={company}
        title={title}
        meta={meta}
        boxes={boxes}
        view={{ href: `/api/pdf/quote/${liveToken}`, label: isEstimate ? "View estimate (PDF)" : "View quotation (PDF)", fileName: `OFJ ${isEstimate ? "Estimate" : "Quotation"} ${q.number}${q.version > 1 ? ` v${q.version}` : ""}.pdf` }}
        action={open ? <QuoteResponse token={liveToken} customerName={customerName} total={totals.total} declaration={settings.declaration_text} declarationAr={settings.declaration_text_ar} isEstimate={isEstimate} terms={settings.terms_and_conditions} termsAr={settings.terms_and_conditions_ar} removalAck={hasRemoval ? String(settings.ppf_removal_note) : null} /> : null}
        contact={<ContactButtons name={advisor?.name ?? null} phone={advisor?.phone ?? null} label="Questions or changes?" />}
      >
        {statusNotes}
        {row.version > 1 && row.sent_at ? <p className="text-xs font-semibold text-[#5F6368]" data-updated-on>Updated on {formatDateTime(row.sent_at)}</p> : null}
        <div className="rounded-lg bg-[#F4F4F5] px-4 py-4 flex flex-col gap-1">
          <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">{isEstimate ? "Estimate total" : "Total"} including VAT</span>
          <span className="text-3xl font-extrabold">{aed(totals.total)}</span>
          {totals.discount ? <span className="text-sm font-bold text-green" data-labour-discount>{discountLabelOf(q)}: − {aed(totals.discount)}</span> : null}
          {totals.rounding < 0 ? <span className="text-sm font-bold text-green" data-roundoff>Round-off: − {aed(Math.abs(totals.rounding))}</span> : null}
          {totals.deposit ? <span className="text-xs text-[#5F6368]">Deposit required on approval: {aed(totals.deposit)}</span> : null}
        </div>
        {hasPpf ? (
          <div className="rounded-lg border border-[#D4D4D8] px-4 py-3 flex flex-col gap-0.5" data-ppf-warranty>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">{String(settings.ppf_brand_name || "OFJ PPF")} · {Number(settings.ppf_warranty_years) || 10}-year warranty</span>
            <span className="text-sm">Our own film, installed by our team, with a written warranty certificate at handover.</span>
          </div>
        ) : null}
        {hasRemoval ? <p className="text-sm text-[#5F6368]" data-removal-note>{String(settings.ppf_removal_note)}</p> : null}
      </CustomerFront>
    );
  }
}
