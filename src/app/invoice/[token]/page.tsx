import type { Metadata } from "next";
import { CustomerFront, customerBoxes } from "@/components/CustomerFront";
import { PackageCard } from "@/components/PackageCard";
import { packageDocOf } from "@/lib/packages";
import { CUT_EXPLAIN, cutWords, lineIsPpf } from "@/lib/ppf-cut";
import { TintCard } from "@/components/TintCard";
import { decorateTint, lineIsTint, tintSummary } from "@/lib/tint";
import { tintLimitOf, tintSpecForJob } from "@/lib/tint-data";
import { PayNowButton } from "@/components/PayNowButton";
import { Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate, formatDateTime } from "@/lib/format";
import { METHOD_LABELS, invoiceBalance, loadInvoice } from "@/lib/invoice-data";
import { currentPaymentLink, paymentLinksOf } from "@/lib/payment-links";
import { aed } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata("OFJ Automotive, Your Invoice", "Your invoice and balance, with the PDF to download");
}

/**
 * The customer's proforma, tax invoice or credit note. The first page: the essentials, the amount due or
 * "Paid in full", one View button, Pay now (a payment link that opens once) and the folded bank details.
 * "?view=1" opens the full document with Download PDF and a way back.
 */
export default async function CustomerInvoicePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; paid?: string; notpaid?: string; cancelled?: string }> }) {
  const { token } = await params;
  const { error, paid: paidFlag, notpaid, cancelled } = await searchParams;
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const admin = createAdminClient();
  const plain = (children: React.ReactNode) => <div className="min-h-screen bg-canvas"><main className="mx-auto max-w-2xl px-4 py-8">{children}</main></div>;
  const { data: row } = await admin.from("invoices").select("id").eq("token", token).eq("is_active", true).maybeSingle();
  if (!row) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  let bundle = await loadInvoice(row.id);
  if (!bundle) return plain(<Notice tone="error">This invoice is no longer available.</Notice>);
  // The proforma link keeps working once it became the tax invoice: the customer sees the tax invoice.
  if (bundle.invoice.converted_to) bundle = (await loadInvoice(bundle.invoice.converted_to)) ?? bundle;
  const { invoice, payments, customer, vehicle, job } = bundle;
  const live = payments.filter((p) => p.status === "recorded");
  const bal = invoiceBalance(invoice, live);
  const car = [vehicle?.make?.name, vehicle?.model?.name, vehicle?.model_year].filter(Boolean).join(" ");
  const isProforma = invoice.kind === "proforma";
  const isTax = invoice.kind === "tax_invoice";
  const title = isProforma ? "Proforma invoice" : invoice.kind === "credit_note" ? "Credit note" : "Tax invoice";
  const payable = isTax || isProforma;
  const paid = payable && bal.state === "paid";
  const due = payable && !paid;
  const meta = [
    { label: isProforma ? "Proforma no." : isTax ? "Invoice no." : "Credit note no.", value: invoice.number },
    { label: "Date", value: formatDate(invoice.issued_at) },
    ...(job ? [{ label: "Job card", value: job.job_number }] : []),
  ];
  // Section 11: the job's tint specification on the tint items; tint outside a package gets its own small card.
  const tintSpec = await tintSpecForJob(invoice.job_id);
  const tintLimit = tintLimitOf(settings);
  const tintOutsidePackage = bundle.lines.some((l) => !l.package_items && lineIsTint(l));
  const tintWords = tintSummary(tintSpec, tintLimit);
  const snapshot = invoice.customer_snapshot;
  const boxes = customerBoxes(
    { full_name: snapshot?.full_name ?? customer?.full_name ?? null, company_name: snapshot?.company_name ?? customer?.company_name ?? null, phone: snapshot?.phone ?? customer?.phone ?? null },
    vehicle || invoice.vehicle_snapshot ? { kind: vehicle?.kind ?? null, variant: vehicle?.variant ?? invoice.vehicle_snapshot?.variant ?? null, vin: invoice.vehicle_snapshot?.vin ?? vehicle?.vin ?? null, plate: invoice.vehicle_snapshot?.plate ?? (vehicle ? formatPlate(vehicle) : null), title: invoice.vehicle_snapshot?.title ?? car ?? "Vehicle" } : null,
  );

  {
    const links = await paymentLinksOf(invoice.id);
    const link = currentPaymentLink(links);
    return (
      <CustomerFront
        company={company}
        title={title}
        meta={meta}
        boxes={boxes}
        view={{ href: `/api/pdf/invoice/${token}`, label: isProforma ? "View proforma (PDF)" : isTax ? "View tax invoice (PDF)" : "View credit note (PDF)", fileName: `OFJ ${title} ${invoice.number}.pdf` }}
        action={
          due ? (
            <div className="flex flex-col gap-3">
              {link && (link.provider === "ngenius" ? !link.paid_at : !link.opened_at) ? <PayNowButton token={token} amountText={aed(bal.balance)} once={link.provider !== "ngenius"} /> : null}
              {link?.opened_at && link.provider !== "ngenius" ? (
                <div className="rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-4 py-3 flex flex-col gap-2 text-sm">
                  <span className="font-bold">Payment link opened at {formatDateTime(link.opened_at)}</span>
                  <span>Didn&apos;t complete the payment? Ask us for a new link.</span>
                  <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="flex min-h-12 items-center justify-center rounded-lg border-2 border-[#111113] bg-white px-4 text-sm font-extrabold">Call OFJ · {company.phone}</a>
                </div>
              ) : null}
              <details className="rounded-lg border border-[#D4D4D8]">
                <summary className="cursor-pointer min-h-12 flex items-center px-4 text-sm font-bold">Bank details</summary>
                <div className="px-4 pb-4 text-sm grid grid-cols-[6rem_1fr] gap-y-0.5">
                  <span className="text-[#5F6368]">Bank</span><span>{company.bank.name}</span>
                  <span className="text-[#5F6368]">Account</span><span>{company.bank.accountName}</span>
                  <span className="text-[#5F6368]">Number</span><span>{company.bank.accountNumber}</span>
                  <span className="text-[#5F6368]">IBAN</span><span>{company.bank.iban}</span>
                  <span className="text-[#5F6368]">SWIFT</span><span>{company.bank.swift}</span>
                  <span className="text-[#5F6368]">Reference</span><span>{invoice.number}</span>
                </div>
              </details>
            </div>
          ) : paid && live.length ? (
            <div className="flex flex-col gap-2">
              {live.map((p) => (
                <a key={p.id} href={`/api/pdf/receipt/${p.id}?t=${token}`} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-between rounded-lg border border-[#D4D4D8] px-4 text-sm font-bold">
                  <span>View receipt {p.number} (PDF)</span>
                  <span className="text-[#5F6368] font-semibold">{formatDate(p.received_at)} · {METHOD_LABELS[p.method]}</span>
                </a>
              ))}
            </div>
          ) : null
        }
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {paidFlag && paid ? <Notice tone="success">Thank you, your payment was received.</Notice> : null}
        {notpaid && !paid ? <Notice tone="error">The payment was not completed. You can try again with Pay now, or pay by transfer with the bank details below.</Notice> : null}
        {cancelled && !paid ? <Notice tone="info">Payment cancelled. Nothing was charged.</Notice> : null}
        {isProforma ? <p className="text-xs text-[#5F6368]">This is not a tax invoice. It shows what is due for the work approved; the tax invoice follows on full payment.</p> : null}
        {payable ? (
          <div className={`rounded-lg px-4 py-4 flex flex-col gap-1 ${paid ? "bg-green-soft" : "bg-[#F4F4F5]"}`}>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">{paid ? "Paid, thank you" : bal.state === "cheque_pending" ? "Cheque pending" : "Amount due"}</span>
            <span className="text-3xl font-extrabold">{paid ? aed(invoice.total_aed) : aed(bal.balance)}</span>
            {invoice.discount_aed ? <span className="text-sm font-bold text-green" data-labour-discount>{bundle.lines.some((l) => !!l.package_items) ? "Package discount" : "Labour discount"}: − {aed(invoice.discount_aed)}</span> : null}
            {invoice.taxable_aed - (invoice.subtotal_aed - invoice.discount_aed - (invoice.warranty_credit_aed || 0)) < -0.004 ? <span className="text-sm font-bold text-green" data-roundoff>Round-off: − {aed(Math.abs(invoice.taxable_aed - (invoice.subtotal_aed - invoice.discount_aed - (invoice.warranty_credit_aed || 0))))}</span> : null}
            {paid && bal.paidAt ? <span className="text-xs text-[#5F6368]">Final payment received {formatDate(bal.paidAt)}</span> : null}
            {!paid && bal.paid ? <span className="text-xs text-[#5F6368]">Received so far {aed(bal.paid)} of {aed(invoice.total_aed)}</span> : null}
          </div>
        ) : (
          <div className="rounded-lg bg-[#F4F4F5] px-4 py-4 flex flex-col gap-1">
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Credit note total</span>
            <span className="text-3xl font-extrabold">{aed(invoice.total_aed)}</span>
          </div>
        )}
        {tintOutsidePackage && tintWords ? <TintCard words={tintWords} /> : null}
        {/* Section 9: the package keeps its own section on the proforma and the tax invoice too. */}
        {bundle.lines.filter((l) => l.section === "services" && !!l.package_items).map((l) => {
          const docModel = packageDocOf(l.package_items, { car: invoice.vehicle_snapshot?.title ?? (car || null), decorate: decorateTint(tintSpec, tintLimit), ppfNote: lineIsPpf({ title: l.description, package_items: l.package_items }) ? cutWords(l.cut_method, l.cut_note) : null, ppfExplain: CUT_EXPLAIN });
          const disc = Number(l.discount_percent) || 0;
          return docModel ? <PackageCard key={l.id} doc={docModel} price={Math.round(l.unit_price * l.quantity * 100) / 100} subtotal={l.amount_aed} discount={disc > 0 ? { percent: disc, amount: Math.round((l.unit_price * l.quantity - l.amount_aed) * 100) / 100 } : null} /> : null;
        })}
      </CustomerFront>
    );
  }
}
