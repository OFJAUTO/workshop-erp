import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { Money } from "@/components/Money";
import { Badge, Notice } from "@/components/ui";
import { customerPageMetadata } from "@/lib/customer-pages";
import { formatDate } from "@/lib/format";
import { METHOD_LABELS, invoiceBalance, loadInvoice } from "@/lib/invoice-data";
import type { Currency } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata("OFJ Automotive, Your Invoice", "Your invoice and balance, with the PDF to download");
}

/** The customer's invoice page from the "car is ready" link: the lines, what is paid, the balance, the PDF. */
export default async function CustomerInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = await getSettings();
  const currency: Currency = String(settings.document_currency) === "aed" ? "aed" : "symbol";
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <header className="bg-sidebar text-white px-4 py-3 flex items-center gap-3">
        <Logo onDark className="h-9" alt={settings.company_name} />
        <span className="hidden sm:inline text-sm font-bold">Your Invoice</span>
      </header>
      <div className="sm:hidden bg-white border-b border-line px-4 py-2.5">
        <span className="block text-base font-extrabold">Your Invoice</span>
      </div>
      <main className="mx-auto max-w-2xl px-4 py-5 flex flex-col gap-4">{children}</main>
    </div>
  );
  const { data: row } = await createAdminClient().from("invoices").select("id").eq("token", token).eq("is_active", true).maybeSingle();
  if (!row) return shell(<Notice tone="error">This link is not valid. Please ask the workshop for a new one.</Notice>);
  const bundle = await loadInvoice(row.id);
  if (!bundle) return shell(<Notice tone="error">This invoice is no longer available.</Notice>);
  const { invoice, lines, payments, customer, vehicle, job } = bundle;
  const live = payments.filter((p) => p.status === "recorded");
  const bal = invoiceBalance(invoice, live);
  const name = invoice.customer_snapshot?.full_name ?? customer?.full_name ?? "Customer";
  const car = [vehicle?.make?.name, vehicle?.model?.name, vehicle?.model_year].filter(Boolean).join(" ");
  const kindLabel = invoice.kind === "proforma" ? "proforma invoice" : invoice.kind === "credit_note" ? "credit note" : "invoice";

  return shell(
    <>
      <h1 className="text-2xl font-extrabold">Your {invoice.kind === "proforma" ? "Proforma Invoice" : invoice.kind === "credit_note" ? "Credit Note" : "Invoice"}</h1>
      <p className="text-[15px] leading-relaxed">
        Dear {name}, {invoice.kind === "tax_invoice" ? "your car is ready. Here is your" : "here is your"} {kindLabel} {invoice.number} for your {car}{vehicle ? ` (${formatPlate(vehicle)})` : ""}{job ? `, job ${job.job_number}` : ""}, dated {formatDate(invoice.issued_at)}.
      </p>
      {invoice.kind === "tax_invoice" ? (
        <div className="rounded-card border-2 border-ink bg-white p-4 flex flex-col gap-1">
          <span className="text-xs font-extrabold uppercase tracking-[0.08em]">{bal.state === "paid" ? "Paid in full" : bal.state === "cheque_pending" ? "Cheque pending clearance" : bal.state === "part_paid" ? "Balance due" : "Amount due"}</span>
          {bal.state === "paid" ? <span className="text-sm">Final payment received {bal.paidAt ? formatDate(bal.paidAt) : ""}. Thank you.</span> : <span className="text-3xl font-extrabold"><Money amount={bal.balance} currency={currency} /></span>}
        </div>
      ) : null}
      <a href={`/api/pdf/invoice/${token}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-control bg-ink px-4 text-sm font-bold text-white">Download the {kindLabel} as a PDF</a>

      {(["services", "fees", "parts"] as const).map((section) => {
        const ls = lines.filter((l) => l.section === section);
        if (!ls.length) return null;
        return (
          <section key={section} className="bg-white border border-line rounded-card p-4 flex flex-col gap-2">
            <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">{section === "parts" ? "Spare parts" : section === "fees" ? "Fees" : "Services"}</h2>
            <ul className="divide-y divide-line text-sm">
              {ls.map((l) => (
                <li key={l.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-semibold">{l.description}</span>{l.part_number ? <span className="block text-xs text-muted">{l.part_number}</span> : null}<span className="block text-xs text-muted">{l.hours !== null ? `${l.hours.toFixed(1)} h × ` : `${l.quantity} × `}<Money amount={l.unit_price} currency={currency} /></span></span>
                  <span className="font-bold">{l.amount_aed === 0 ? "Complimentary" : <Money amount={l.amount_aed} currency={currency} />}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section className="bg-white border border-line rounded-card p-4 text-sm">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt className="text-muted">Gross amount</dt><dd className="text-right"><Money amount={invoice.subtotal_aed} currency={currency} /></dd>
          {invoice.discount_aed ? <><dt className="font-bold">Discount on labour and services</dt><dd className="text-right font-bold">− <Money amount={invoice.discount_aed} currency={currency} /></dd></> : null}
          <dt className="text-muted">Taxable amount</dt><dd className="text-right"><Money amount={invoice.taxable_aed} currency={currency} /></dd>
          <dt className="text-muted">VAT 5%</dt><dd className="text-right"><Money amount={invoice.vat_aed} currency={currency} /></dd>
          <dt className="text-base font-extrabold">Total</dt><dd className="text-right text-base font-extrabold"><Money amount={invoice.total_aed} currency={currency} /></dd>
          {bal.paid ? <><dt className="text-muted">Paid</dt><dd className="text-right"><Money amount={bal.paid} currency={currency} /></dd></> : null}
        </dl>
      </section>
      {live.length ? (
        <section className="bg-white border border-line rounded-card p-4 flex flex-col gap-2 text-sm">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Payments received</h2>
          <ul className="divide-y divide-line">
            {live.map((p) => (
              <li key={p.id} className="py-1.5 flex items-center justify-between gap-2"><span>{formatDate(p.received_at)} · {METHOD_LABELS[p.method]}{p.method === "cheque" && p.cheque_status === "pending" ? <Badge tone="amber">pending clearance</Badge> : null}</span><Money amount={p.amount_aed} currency={currency} /></li>
            ))}
          </ul>
        </section>
      ) : null}
      {invoice.kind === "tax_invoice" && bal.state !== "paid" ? (
        <section className="bg-white border border-line rounded-card p-4 text-sm flex flex-col gap-1">
          <h2 className="text-sm font-extrabold tracking-[0.08em] uppercase">Bank transfer</h2>
          <p>{settings.bank_name}</p>
          <p>Account name {settings.bank_account_name}</p>
          <p>Account number {settings.bank_account_number}</p>
          <p>IBAN {settings.bank_iban} · SWIFT {settings.bank_swift}</p>
        </section>
      ) : null}
      <p className="text-xs text-muted">{settings.company_legal_name} · TRN {settings.company_trn}. Prices in dirhams; VAT at 5% shown separately.</p>
    </>,
  );
}
