import type { Metadata } from "next";
import { CustomerDocument, DocLines, DocTotals, type DocRow } from "@/components/CustomerDocument";
import { ContactButtons, CustomerFront, advisorContact, customerBoxes } from "@/components/CustomerFront";
import { Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate, formatDateTime } from "@/lib/format";
import { notifyStaff } from "@/lib/notifications";
import { loadQuotation } from "@/lib/quote-data";
import { aed, blockOf, isHidden, isUnchosen, lineQuantityText, lineTotal, lineUnitPrice, partAvailabilityText, partTypeText, quoteTotals, withPositions } from "@/lib/quotes";
import { dubaiDate } from "@/lib/jobs";
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
export default async function CustomerQuotePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; view?: string }> }) {
  const { token } = await params;
  const { error, view } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const plain = (children: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto max-w-2xl px-4 py-8">{children}</main>
    </div>
  );
  const { data: row } = await admin.from("quotations").select("id, kind, status, valid_until, viewed_full_at").eq("token", token).maybeSingle();
  if (!row) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const isEstimate = row.kind === "estimate";
  const full = view === "1";

  // First opening: remembered and the advisor told. Opening the full document is remembered too.
  if (row.status === "sent") await admin.from("quotations").update({ status: "opened", opened_at: new Date().toISOString() }).eq("id", row.id);
  if (full && !row.viewed_full_at && ["sent", "opened"].includes(row.status)) await admin.from("quotations").update({ viewed_full_at: new Date().toISOString() }).eq("id", row.id);
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

  // Internal lines, unused options and parts left off never reach the customer.
  const lines = bundle.lines.filter((l) => l.is_active && !isHidden(l) && !isUnchosen(l) && !l.left_off);
  const totals = quoteTotals(lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const customerName = q.sent_to_name ?? customer?.company_name ?? customer?.full_name ?? "Customer";
  const carName = [vehicle?.make?.name, vehicle?.model?.name, vehicle?.model_year].filter(Boolean).join(" ");
  const dangerous = !isEstimate && lines.some((l) => l.dangerous);
  const title = isEstimate ? "Estimate" : q.version > 1 ? "Revised quotation" : "Quotation";
  const money = (n: number) => aed(n).replace("AED ", "");
  const today = dubaiDate();
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

  if (!full) {
    const advisor = await advisorContact(admin, [q.sent_by, q.created_by, job?.gated_in_by]);
    return (
      <CustomerFront
        company={company}
        title={title}
        meta={meta}
        boxes={boxes}
        view={{ href: `/quote/${token}?view=1`, label: isEstimate ? "View estimate" : "View quotation" }}
        action={open ? <QuoteResponse token={token} customerName={customerName} total={totals.total} declaration={settings.declaration_text} declarationAr={settings.declaration_text_ar} isEstimate={isEstimate} terms={settings.terms_and_conditions} termsAr={settings.terms_and_conditions_ar} /> : null}
        contact={<ContactButtons name={advisor?.name ?? null} phone={advisor?.phone ?? null} label="Questions or changes?" />}
      >
        {statusNotes}
        <div className="rounded-lg bg-[#F4F4F5] px-4 py-4 flex flex-col gap-1">
          <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">{isEstimate ? "Estimate total" : "Total"} including VAT</span>
          <span className="text-3xl font-extrabold">{aed(totals.total)}</span>
          {totals.deposit ? <span className="text-xs text-[#5F6368]">Deposit required on approval: {aed(totals.deposit)}</span> : null}
        </div>
      </CustomerFront>
    );
  }

  let n = 0;
  const rowOf = (l: (typeof lines)[number]): DocRow => {
    n++;
    const part = l.part_item_id ? bundle.parts.find((p) => p.id === l.part_item_id) : null;
    const details = [l.line_type === "part" ? partTypeText(l) : null, part?.part_number ?? null, l.line_type === "part" ? partAvailabilityText(part, today) : null, l.details].filter(Boolean).join(" · ") || null;
    return { n, description: l.line_type === "part" && part?.part_number && l.title.endsWith(`(${part.part_number})`) ? l.title.slice(0, -(part.part_number.length + 2)).trim() : withPositions(l.title, l.positions), details, tag: !isEstimate && l.urgency === "urgent" ? "Urgent" : null, qty: lineQuantityText(l), rate: money(lineUnitPrice(l)), amount: lineTotal(l) === 0 ? "Complimentary" : money(lineTotal(l)), amountNum: lineTotal(l) };
  };
  const labour = lines.filter((l) => blockOf(l) === "labour").map(rowOf);
  const parts = lines.filter((l) => blockOf(l) === "parts").map(rowOf);
  const other = lines.filter((l) => blockOf(l) === "other").map(rowOf);
  const { data: reportLink } = job ? await admin.from("report_links").select("token").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };

  return (
    <CustomerDocument company={company} title={title} meta={meta} boxes={boxes} pdfHref={`/api/pdf/quote/${token}`} backHref={`/quote/${token}`}>
      {statusNotes}
      {reportLink?.token ? <a href={`/report/${reportLink.token}`} className="self-start text-xs font-semibold text-[#5F6368] underline underline-offset-4">See your inspection report</a> : null}
      {labour.length ? <DocLines title="Labour and services" rows={labour} vatPercent={Number(q.vat_percent) || 5} discount={totals.discount ? { label: `Discount ${q.discount_percent}% on labour and services`, amount: totals.discount } : null} subtotalLabel="Labour and services subtotal" /> : null}
      {parts.length ? <DocLines title="Parts" rows={parts} vatPercent={Number(q.vat_percent) || 5} subtotalLabel="Parts subtotal" /> : null}
      {other.length ? <DocLines title="Other charges" rows={other} vatPercent={Number(q.vat_percent) || 5} subtotalLabel="Other charges subtotal" /> : null}
      <DocTotals
        rows={[
          { label: "Subtotal", value: money(totals.subtotal) },
          ...(totals.discount ? [{ label: `Discount ${q.discount_percent}%`, value: `− ${money(totals.discount)}`, bold: true }] : []),
          ...(totals.rounding ? [{ label: totals.rounding < 0 ? "Discount (rounding)" : "Rounding", value: `${totals.rounding < 0 ? "− " : ""}${money(Math.abs(totals.rounding))}` }] : []),
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
