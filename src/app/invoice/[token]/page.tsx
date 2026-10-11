import type { Metadata } from "next";
import { CustomerDocument, DocLines, DocSection, DocTotals, type DocRow } from "@/components/CustomerDocument";
import { ContactButtons, CustomerFront, advisorContact, customerBoxes } from "@/components/CustomerFront";
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
export default async function CustomerInvoicePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ view?: string; error?: string }> }) {
  const { token } = await params;
  const { view, error } = await searchParams;
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
  const { invoice, lines, payments, customer, vehicle, job } = bundle;
  const live = payments.filter((p) => p.status === "recorded");
  const bal = invoiceBalance(invoice, live);
  const car = [vehicle?.make?.name, vehicle?.model?.name, vehicle?.model_year].filter(Boolean).join(" ");
  const isProforma = invoice.kind === "proforma";
  const isTax = invoice.kind === "tax_invoice";
  const title = isProforma ? "Proforma invoice" : invoice.kind === "credit_note" ? "Credit note" : "Tax invoice";
  const money = (n: number) => aed(n).replace("AED ", "");
  const payable = isTax || isProforma;
  const paid = payable && bal.state === "paid";
  const due = payable && !paid;
  const rounding = Math.round((invoice.taxable_aed - (invoice.subtotal_aed - invoice.discount_aed - (invoice.warranty_credit_aed || 0))) * 100) / 100;
  const meta = [
    { label: isProforma ? "Proforma no." : isTax ? "Invoice no." : "Credit note no.", value: invoice.number },
    { label: "Date", value: formatDate(invoice.issued_at) },
    ...(job ? [{ label: "Job card", value: job.job_number }] : []),
  ];
  const snapshot = invoice.customer_snapshot;
  const boxes = customerBoxes(
    { full_name: snapshot?.full_name ?? customer?.full_name ?? null, company_name: snapshot?.company_name ?? customer?.company_name ?? null, phone: snapshot?.phone ?? customer?.phone ?? null },
    vehicle || invoice.vehicle_snapshot ? { kind: vehicle?.kind ?? null, variant: vehicle?.variant ?? invoice.vehicle_snapshot?.variant ?? null, vin: invoice.vehicle_snapshot?.vin ?? vehicle?.vin ?? null, plate: invoice.vehicle_snapshot?.plate ?? (vehicle ? formatPlate(vehicle) : null), title: invoice.vehicle_snapshot?.title ?? car ?? "Vehicle" } : null,
  );

  if (view !== "1") {
    const [links, advisor] = await Promise.all([paymentLinksOf(invoice.id), advisorContact(admin, [invoice.issued_by, job?.gated_in_by])]);
    const link = currentPaymentLink(links);
    return (
      <CustomerFront
        company={company}
        title={title}
        meta={meta}
        boxes={boxes}
        view={{ href: `/invoice/${token}?view=1`, label: isProforma ? "View proforma" : isTax ? "View tax invoice" : "View credit note" }}
        action={
          due ? (
            <div className="flex flex-col gap-3">
              {link && !link.opened_at ? <PayNowButton token={token} amountText={aed(bal.balance)} /> : null}
              {link?.opened_at ? (
                <div className="rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-4 py-3 flex flex-col gap-2 text-sm">
                  <span className="font-bold">Payment link opened at {formatDateTime(link.opened_at)}</span>
                  <span>Didn&apos;t complete the payment? Ask us for a new link.</span>
                  {advisor?.phone ? <a href={`https://wa.me/${advisor.phone.replace(/[^\d]/g, "")}`} className="flex min-h-12 items-center justify-center rounded-lg border-2 border-[#111113] bg-white px-4 text-sm font-extrabold">WhatsApp {advisor.name.split(" ")[0]}</a> : null}
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
                <a key={p.id} href={`/api/pdf/receipt/${p.id}?t=${token}`} className="flex min-h-12 items-center justify-between rounded-lg border border-[#D4D4D8] px-4 text-sm font-bold">
                  <span>View receipt {p.number}</span>
                  <span className="text-[#5F6368] font-semibold">{formatDate(p.received_at)} · {METHOD_LABELS[p.method]}</span>
                </a>
              ))}
            </div>
          ) : null
        }
        contact={<ContactButtons name={advisor?.name ?? null} phone={advisor?.phone ?? null} />}
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {isProforma ? <p className="text-xs text-[#5F6368]">This is not a tax invoice. It shows what is due for the work approved; the tax invoice follows on full payment.</p> : null}
        {payable ? (
          <div className={`rounded-lg px-4 py-4 flex flex-col gap-1 ${paid ? "bg-green-soft" : "bg-[#F4F4F5]"}`}>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">{paid ? "Paid, thank you" : bal.state === "cheque_pending" ? "Cheque pending" : "Amount due"}</span>
            <span className="text-3xl font-extrabold">{paid ? aed(invoice.total_aed) : aed(bal.balance)}</span>
            {paid && bal.paidAt ? <span className="text-xs text-[#5F6368]">Final payment received {formatDate(bal.paidAt)}</span> : null}
            {!paid && bal.paid ? <span className="text-xs text-[#5F6368]">Received so far {aed(bal.paid)} of {aed(invoice.total_aed)}</span> : null}
          </div>
        ) : (
          <div className="rounded-lg bg-[#F4F4F5] px-4 py-4 flex flex-col gap-1">
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#5F6368]">Credit note total</span>
            <span className="text-3xl font-extrabold">{aed(invoice.total_aed)}</span>
          </div>
        )}
      </CustomerFront>
    );
  }

  let n = 0;
  const rowOf = (l: (typeof lines)[number]): DocRow => {
    n++;
    return { n, description: l.description, details: [l.part_number, l.hours === null ? l.details : null].filter(Boolean).join(" · ") || null, qty: l.hours !== null ? `${l.hours.toFixed(1)} h` : String(l.quantity), rate: money(l.unit_price), amount: l.amount_aed === 0 ? "Complimentary" : money(l.amount_aed), amountNum: l.amount_aed };
  };
  const services = lines.filter((l) => l.section === "services").map(rowOf);
  const parts = lines.filter((l) => l.section === "parts").map(rowOf);
  const fees = lines.filter((l) => l.section === "fees").map(rowOf);

  return (
    <CustomerDocument company={company} title={title} meta={meta} boxes={boxes} pdfHref={`/api/pdf/invoice/${token}`} backHref={`/invoice/${token}`} computerGenerated={isTax}>
      {isProforma ? <div className="rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-4 py-3 text-sm"><span className="font-bold">This is not a tax invoice.</span> It shows what is due for the work approved. The tax invoice is issued on full payment.</div> : null}
      {paid ? <div className="rounded-lg border-2 border-[#111113] p-3 text-center text-lg font-extrabold">Paid, thank you</div> : null}
      {services.length || fees.length ? <DocLines title="Services" rows={[...services, ...fees]} discount={invoice.discount_aed ? { label: "Discount on labour and services", amount: invoice.discount_aed } : null} subtotalLabel="Services subtotal" /> : null}
      {parts.length ? <DocLines title="Spare parts" rows={parts} subtotalLabel="Spare parts subtotal" /> : null}
      <DocTotals
        rows={[
          { label: "Gross amount", value: money(invoice.subtotal_aed) },
          ...(invoice.discount_aed ? [{ label: "Discount", value: `− ${money(invoice.discount_aed)}`, bold: true }] : []),
          ...(invoice.warranty_credit_aed ? [{ label: "Warranty repair, no charge", value: `− ${money(invoice.warranty_credit_aed)}`, bold: true }] : []),
          ...(rounding ? [{ label: rounding < 0 ? "Discount (rounding)" : "Rounding", value: `${rounding < 0 ? "− " : ""}${money(Math.abs(rounding))}` }] : []),
          { label: "Taxable amount", value: money(invoice.taxable_aed) },
          { label: "VAT 5%", value: money(invoice.vat_aed) },
        ]}
        total={{ label: "Total AED", value: money(invoice.total_aed) }}
        after={payable && bal.paid ? [{ label: "Paid", value: `− ${money(bal.paid)}` }] : []}
        box={payable ? (paid ? { label: "Paid in full", value: null, note: bal.paidAt ? `Final payment received ${formatDate(bal.paidAt)}` : null } : { label: bal.state === "cheque_pending" ? "Cheque pending" : "Balance due", value: aed(bal.balance) }) : null}
      />
      {live.length ? (
        <DocSection title="Payments received">
          <div className="text-sm divide-y divide-line">
            {live.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 py-1.5"><span>{p.number} · {formatDate(p.received_at)} · {METHOD_LABELS[p.method]}{p.method === "cheque" && p.cheque_status === "pending" ? " (pending clearance)" : ""}</span><span className="font-bold">{aed(p.amount_aed)}</span></div>
            ))}
          </div>
        </DocSection>
      ) : null}
      {invoice.notes ? <div className="rounded-control border border-line p-3 text-sm whitespace-pre-wrap">{invoice.notes}</div> : null}
    </CustomerDocument>
  );
}
