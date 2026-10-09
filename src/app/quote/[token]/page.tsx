import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { Money } from "@/components/Money";
import { Badge, Notice } from "@/components/ui";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate, formatDateTime } from "@/lib/format";
import { INSPECTION_BUCKET } from "@/lib/inspection-data";
import { feeNotice, formatPromised } from "@/lib/jobs";
import { notifyStaff } from "@/lib/notifications";
import { loadQuotation, signPaths } from "@/lib/quote-data";
import { URGENCY_LABELS, isHidden, isUnchosen, lineQuantityText, partTypeText, lineTotal, lineUnitPrice, quoteTotals, type QuoteLine } from "@/lib/quotes";
import { type Currency } from "@/lib/money";
import { getSettings } from "@/lib/settings";
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

type ShownLine = QuoteLine & { photo_urls: string[]; remark: string | null };

/** The customer's quotation or estimate page: every line with Urgent or Recommended, the totals, and one answer for the whole quotation. */
export default async function CustomerQuotePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const currency: Currency = String(settings.document_currency) === "aed" ? "aed" : "symbol";
  const shell = (children: React.ReactNode, title = "Your Quotation") => (
    <div className="min-h-screen bg-canvas">
      <header className="bg-sidebar text-white px-4 py-3 flex items-center gap-3">
        <Logo onDark className="h-9" alt={settings.company_name} />
        <span className="hidden sm:inline text-sm font-bold">{title}</span>
      </header>
      <div className="sm:hidden bg-white border-b border-line px-4 py-2.5">
        <span className="block text-base font-extrabold">{title}</span>
      </div>
      <main className="mx-auto max-w-2xl px-4 py-5 flex flex-col gap-4">{children}</main>
    </div>
  );
  const { data: row } = await admin.from("quotations").select("id, kind, status, valid_until").eq("token", token).maybeSingle();
  if (!row) return shell(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const isEstimate = row.kind === "estimate";
  const title = isEstimate ? "Your Estimate" : "Your Quotation";

  // First opening: remembered and the advisor told.
  if (row.status === "sent") {
    await admin.from("quotations").update({ status: "opened", opened_at: new Date().toISOString() }).eq("id", row.id);
  }
  const expired = (row.status === "sent" || row.status === "opened") && isPastNow(row.valid_until);
  if (expired) await admin.from("quotations").update({ status: "expired" }).eq("id", row.id);
  const bundle = await loadQuotation(row.id);
  if (!bundle) return shell(<Notice tone="error">This quotation is no longer available.</Notice>, title);
  const { quotation: q, customer, vehicle, job, inspection } = bundle;
  if (row.status === "sent") {
    const ids = [q.created_by, q.sent_by, job?.gated_in_by].filter((x): x is string => !!x);
    await notifyStaff(ids, { type: "quote_opened", title: `Customer opened ${isEstimate ? "the estimate" : "the quotation"} · ${q.number}`, body: vehicle ? formatPlate(vehicle) : "", jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}` : `/estimates/${q.id}` });
  }
  if (q.status === "superseded" || q.status === "cancelled" || q.status === "draft" || q.status === "pending_owner") return shell(<Notice tone="info">This {isEstimate ? "estimate" : "quotation"} has been replaced. Please use the newest link the workshop sent you.</Notice>, title);

  // Internal lines (hidden Recovery or Other) never reach the customer.
  const lines = bundle.lines.filter((l) => l.is_active && !isHidden(l) && !isUnchosen(l));
  const customerName = q.sent_to_name ?? customer?.company_name ?? customer?.full_name ?? "Customer";
  const carName = [vehicle?.make?.name, vehicle?.model?.name, vehicle?.model_year].filter(Boolean).join(" ");
  // Photos and remarks from the inspection for each line's source.
  const mediaPaths: string[] = [];
  const decorated = lines.map((l) => {
    let remark: string | null = null;
    let paths: string[] = [];
    if (inspection && l.source_type === "item" && l.source_key) {
      const item = inspection.items.find((i) => i.item_key === l.source_key);
      remark = item?.remarks ?? null;
      paths = inspection.media.filter((m) => m.item_key === l.source_key && m.kind === "photo").map((m) => m.storage_path);
    } else if (inspection && l.source_type === "request" && l.source_key) {
      const f = inspection.findings.find((x) => x.job_request_id === l.source_key);
      remark = f?.found ?? null;
      paths = inspection.media.filter((m) => m.job_request_id === l.source_key && m.kind === "photo").map((m) => m.storage_path);
    }
    mediaPaths.push(...paths);
    // The suggested line already carries the remark as its details: do not show it twice.
    return { ...l, remark: remark && remark.trim() === (l.details ?? "").trim() ? null : remark, paths };
  });
  const urls = await signPaths(INSPECTION_BUCKET, Array.from(new Set(mediaPaths)));
  const groupOrder: string[] = [];
  const groups = new Map<string, ShownLine[]>();
  for (const l of decorated) {
    const label = l.group_label ?? (l.line_type === "part" ? "Parts" : "Work");
    if (!groups.has(label)) {
      groups.set(label, []);
      groupOrder.push(label);
    }
    groups.get(label)!.push({ ...l, photo_urls: l.paths.map((p) => urls[p]).filter(Boolean), remark: l.remark });
  }
  const groupList = groupOrder.map((label) => ({ label, lines: groups.get(label)! }));
  // The full report link, if the advisor already made one.
  const { data: report } = q.job_id ? await admin.from("report_links").select("token").eq("job_id", q.job_id).order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
  const totals = quoteTotals(lines, q, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const hasUrgent = lines.some((l) => l.urgency === "urgent");
  const hasRecommended = lines.some((l) => l.urgency !== "urgent");
  // A dangerous finding: the warning sits above the lines, and declining asks for an acknowledgement.
  const dangerous = !isEstimate && lines.some((l) => l.dangerous);

  const lineSections = groupList.map((g) => (
    <section key={g.label} className="bg-white border border-line rounded-card p-4 flex flex-col gap-2">
      <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">{g.label}</h2>
      <ul className="divide-y divide-line text-sm">
        {g.lines.map((l) => (
          <li key={l.id} className="py-3 flex flex-col gap-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{l.title}</span>
                {l.urgency && !isEstimate ? <Badge tone={l.urgency === "urgent" ? "red" : "neutral"}>{URGENCY_LABELS[l.urgency]}</Badge> : null}
                {partTypeText(l) ? <Badge tone="outline">{partTypeText(l)}</Badge> : null}
                {l.dangerous && !isEstimate ? <Badge tone="red">Safety</Badge> : null}
              </span>
              <span className="font-bold"><Money amount={lineTotal(l)} currency={currency} /></span>
            </div>
            <span className="text-xs text-muted">
              {lineQuantityText(l)} × <Money amount={lineUnitPrice(l)} currency={currency} />
              {l.discount_percent ? ` · ${l.discount_percent}% discount applied` : ""}
            </span>
            {l.details ? <p className="whitespace-pre-wrap">{l.details}</p> : null}
            {l.remark ? <p className="text-muted">Found: {l.remark}</p> : null}
            {l.photo_urls.length ? (
              <div className="flex flex-wrap gap-2">
                {l.photo_urls.map((u) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Photo" className="h-24 w-24 rounded-control object-cover bg-chip" /></a>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  ));
  const totalsSection = (
    <section className="bg-white border border-line rounded-card p-4 text-sm">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt className="text-muted">Subtotal</dt><dd className="text-right"><Money amount={totals.subtotal} currency={currency} /></dd>
        {totals.discount ? (
          <>
            <dt className="text-muted">Discount {q.discount_percent}% on labour and services</dt><dd className="text-right">− <Money amount={totals.discount} currency={currency} /></dd>
            <dt className="text-muted">Before VAT</dt><dd className="text-right"><Money amount={totals.net} currency={currency} /></dd>
          </>
        ) : null}
        <dt className="text-muted">VAT {q.vat_percent}%</dt><dd className="text-right"><Money amount={totals.vat} currency={currency} /></dd>
        <dt className="text-base font-extrabold">Total</dt><dd className="text-right text-base font-extrabold"><Money amount={totals.total} currency={currency} /></dd>
        {totals.deposit ? <><dt className="text-muted">Deposit required</dt><dd className="text-right font-semibold"><Money amount={totals.deposit} currency={currency} /></dd></> : null}
      </dl>
    </section>
  );

  return shell(
    <>
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p className="text-[15px] leading-relaxed">
        Dear {customerName}, {isEstimate ? "here is our estimate" : "here is the quotation"} for your {carName}{vehicle ? ` (${formatPlate(vehicle)})` : ""}
        {job ? `, job ${job.job_number}` : ""}. {q.number} version {q.version}.
        {isEstimate ? " Final price confirmed once the vehicle is with us." : " Please review it and approve the work you would like us to do."}
      </p>
      <div className="flex flex-wrap gap-2">
        {q.promised_at && !isEstimate ? <Badge tone="ink">Promised {formatPromised(q.promised_at)}</Badge> : null}
        {q.valid_until ? <Badge tone={q.status === "expired" ? "red" : "neutral"}>{q.status === "expired" ? "Expired" : `Valid until ${formatDate(q.valid_until)}`}</Badge> : null}
      </div>
      {q.customer_note ? <p className="rounded-control bg-white border border-line p-3 text-sm whitespace-pre-wrap">{q.customer_note}</p> : null}
      {report ? (
        <a href={`/report/${report.token}`} className="text-sm font-bold underline underline-offset-4">
          See the full inspection report
        </a>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <a href={`/api/pdf/quote/${token}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-white">
        {isEstimate ? "Download the estimate as a PDF" : "Download the quotation as a PDF"}
      </a>

      {q.status === "approved" ? <Notice tone="success">{isEstimate ? "Accepted" : "Approved"} by {q.approver_name} on {formatDateTime(q.responded_at)}. Thank you.</Notice> : null}
      {q.status === "declined" ? <Notice tone="error">Declined by {q.approver_name} on {formatDateTime(q.responded_at)}.</Notice> : null}
      {q.status === "urgent_requested" ? <Notice tone="info">You asked on {formatDateTime(q.responded_at)} for a quotation with the urgent work only. We are preparing it and will send you a new link.</Notice> : null}
      {q.status === "expired" ? <Notice tone="error">This {isEstimate ? "estimate" : "quotation"} expired on {formatDate(q.valid_until)}. Please ask the workshop for a new one.</Notice> : null}

      {dangerous ? (
        <section className="rounded-card border-2 border-red-bar bg-white p-4 flex flex-col gap-2">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase text-red">Safety warning</h2>
          <p className="text-sm whitespace-pre-wrap">{settings.dangerous_customer_text}</p>
          {settings.dangerous_customer_text_ar ? <p className="text-sm whitespace-pre-wrap" dir="rtl" lang="ar">{settings.dangerous_customer_text_ar}</p> : null}
        </section>
      ) : null}
      {lineSections}
      {totalsSection}

      {q.status === "sent" || q.status === "opened" ? (
        <QuoteResponse
          token={token}
          customerName={customerName}
          total={totals.total}
          declaration={settings.declaration_text}
          declarationAr={settings.declaration_text_ar}
          feeNotice={feeNotice(settings.inspection_fee_notice, settings.inspection_fee_aed)}
          feeNoticeAr={feeNotice(settings.inspection_fee_notice_ar, settings.inspection_fee_aed)}
          isEstimate={isEstimate}
          terms={settings.terms_and_conditions}
          termsAr={settings.terms_and_conditions_ar}
          hasUrgent={hasUrgent && hasRecommended}
          dangerText={dangerous ? settings.dangerous_acknowledgement_text : null}
        />
      ) : null}
      <p className="text-xs text-muted">{settings.company_name}. Prices in UAE dirhams. VAT at {q.vat_percent}% shown separately.</p>
    </>,
    title,
  );
}
