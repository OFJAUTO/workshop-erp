import type { Metadata } from "next";
import { CustomerDocument, DocLines, DocSection, DocTotals, type DocRow } from "@/components/CustomerDocument";
import { Notice } from "@/components/ui";
import { companyFromSettings } from "@/lib/company";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate } from "@/lib/format";
import { METHOD_LABELS, invoiceBalance, loadInvoice } from "@/lib/invoice-data";
import { aed } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata("OFJ Automotive, Your Invoice", "Your invoice and balance, with the PDF to download");
}

/** The customer's invoice from the "car is ready" link: the document, the balance, Pay now when a payment link was added, the bank details, and the receipts once paid. */
export default async function CustomerInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = await getSettings();
  const company = companyFromSettings(settings);
  const plain = (children: React.ReactNode) => <div className="min-h-screen bg-canvas"><main className="mx-auto max-w-2xl px-4 py-8">{children}</main></div>;
  const { data: row } = await createAdminClient().from("invoices").select("id").eq("token", token).eq("is_active", true).maybeSingle();
  if (!row) return plain(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const bundle = await loadInvoice(row.id);
  if (!bundle) return plain(<Notice tone="error">This invoice is no longer available.</Notice>);
  const { invoice, lines, payments, customer, vehicle, job } = bundle;
  const live = payments.filter((p) => p.status === "recorded");
  const bal = invoiceBalance(invoice, live);
  const car = [vehicle?.make?.name, vehicle?.model?.name, vehicle?.model_year].filter(Boolean).join(" ");
  const title = invoice.kind === "proforma" ? "Proforma invoice" : invoice.kind === "credit_note" ? "Credit note" : "Tax invoice";
  const money = (n: number) => aed(n).replace("AED ", "");
  let n = 0;
  const rowOf = (l: (typeof lines)[number]): DocRow => {
    n++;
    return { n, description: l.description, details: [l.part_number, l.hours === null ? l.details : null].filter(Boolean).join(" · ") || null, qty: l.hours !== null ? `${l.hours.toFixed(1)} h` : String(l.quantity), rate: money(l.unit_price), amount: l.amount_aed === 0 ? "Complimentary" : money(l.amount_aed) };
  };
  const services = lines.filter((l) => l.section === "services").map(rowOf);
  const parts = lines.filter((l) => l.section === "parts").map(rowOf);
  const fees = lines.filter((l) => l.section === "fees").map(rowOf);
  const paid = invoice.kind === "tax_invoice" && bal.state === "paid";
  const due = invoice.kind === "tax_invoice" && !paid;

  return (
    <CustomerDocument
      company={company}
      title={title}
      meta={[
        { label: "Invoice no.", value: invoice.number },
        { label: "Date", value: formatDate(invoice.issued_at) },
        ...(job ? [{ label: "Job card", value: job.job_number }] : []),
        ...(bundle.preparedByName ? [{ label: "Advisor", value: bundle.preparedByName }] : []),
      ]}
      boxes={[
        { title: "Customer", strong: invoice.customer_snapshot?.company_name ?? customer?.company_name ?? invoice.customer_snapshot?.full_name ?? customer?.full_name ?? "Customer", rows: [["Name", invoice.customer_snapshot?.company_name ? invoice.customer_snapshot?.full_name : null], ["Mobile", invoice.customer_snapshot?.phone ?? customer?.phone ?? null], ["TRN", invoice.customer_snapshot?.trn ?? customer?.trn ?? null]] },
        { title: "Vehicle", strong: invoice.vehicle_snapshot?.title ?? car ?? "Vehicle", rows: [["Variant", invoice.vehicle_snapshot?.variant ?? vehicle?.variant ?? null], ["Plate", invoice.vehicle_snapshot?.plate ?? (vehicle ? formatPlate(vehicle) : null)], ["VIN", invoice.vehicle_snapshot?.vin ?? vehicle?.vin ?? null]] },
      ]}
      pdfHref={`/api/pdf/invoice/${token}`}
      bar={due && invoice.payment_link_url ? <a href={invoice.payment_link_url} target="_blank" rel="noreferrer" className="flex min-h-14 w-full items-center justify-center rounded-control bg-ink text-base font-extrabold text-white">Pay now · {aed(bal.balance)}</a> : null}
      footer={<>{company.legalName} · TRN {company.trn}. Prices in dirhams; VAT at 5% shown separately.</>}
    >
      {paid ? (
        <div className="rounded-card border-2 border-ink p-4 text-center">
          <div className="text-xl font-extrabold">Paid, thank you</div>
          <div className="text-sm">Final payment received {bal.paidAt ? formatDate(bal.paidAt) : ""}.</div>
        </div>
      ) : due ? (
        <div className="rounded-card border-2 border-ink p-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em]">{bal.state === "cheque_pending" ? "Cheque pending clearance" : bal.state === "part_paid" ? "Balance due" : "Amount due"}</span>
          <span className="text-2xl font-extrabold">{aed(bal.balance)}</span>
        </div>
      ) : null}
      {services.length ? <DocSection title="Services"><DocLines rows={services} /></DocSection> : null}
      {parts.length ? <DocSection title="Spare parts"><DocLines rows={parts} /></DocSection> : null}
      {fees.length ? <DocSection title="Fees"><DocLines rows={fees} /></DocSection> : null}
      <DocTotals
        rows={[
          { label: "Gross amount", value: money(invoice.subtotal_aed) },
          ...(invoice.discount_aed ? [{ label: "Discount", value: `− ${money(invoice.discount_aed)}`, bold: true }] : []),
          ...(invoice.warranty_credit_aed ? [{ label: "Warranty repair, no charge", value: `− ${money(invoice.warranty_credit_aed)}`, bold: true }] : []),
          { label: "Taxable amount", value: money(invoice.taxable_aed) },
          { label: "VAT 5%", value: money(invoice.vat_aed) },
        ]}
        total={{ label: "Total", value: aed(invoice.total_aed) }}
        after={invoice.kind === "tax_invoice" ? [{ label: "Paid", value: money(bal.paid) }, { label: paid ? "Balance" : "Balance due", value: money(bal.balance), bold: true }] : []}
      />
      {live.length ? (
        <DocSection title="Payments received">
          <div className="text-sm divide-y divide-line">
            {live.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 py-1.5"><span>{p.number} · {formatDate(p.received_at)} · {METHOD_LABELS[p.method]}{p.method === "cheque" && p.cheque_status === "pending" ? " (pending clearance)" : ""}</span><span className="font-bold">{aed(p.amount_aed)} · <a href={`/api/pdf/receipt/${p.id}`} className="underline underline-offset-4">Receipt</a></span></div>
            ))}
          </div>
        </DocSection>
      ) : null}
      {due ? (
        <DocSection title="Bank transfer">
          <div className="text-sm grid grid-cols-[6rem_1fr] gap-y-0.5">
            <span className="text-muted">Bank</span><span>{company.bank.name}</span>
            <span className="text-muted">Account</span><span>{company.bank.accountName}</span>
            <span className="text-muted">Number</span><span>{company.bank.accountNumber}</span>
            <span className="text-muted">IBAN</span><span>{company.bank.iban}</span>
            <span className="text-muted">SWIFT</span><span>{company.bank.swift}</span>
          </div>
        </DocSection>
      ) : null}
      {invoice.notes ? <div className="rounded-control border border-line p-3 text-sm whitespace-pre-wrap">{invoice.notes}</div> : null}
    </CustomerDocument>
  );
}
