import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, DescriptionList, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { METHOD_LABELS, PAYMENT_STATE_LABELS, invoiceBalance, loadInvoice } from "@/lib/invoice-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site";
import { formatPlate } from "@/lib/types";
import { issueCreditNote, recordPayment, requestCreditNote, setChequeStatus } from "../actions";
import { PaymentForm } from "./PaymentForm";

export const dynamic = "force-dynamic";

/** Money on screen: two decimals and thousands separators. */
const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const KIND_LABELS = { tax_invoice: "Tax invoice", proforma: "Proforma invoice", credit_note: "Credit note" } as const;

/** One invoice: the lines, the payments with receipts, record a payment, cheque status, credit notes, PDF and the customer link. */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("viewInvoices");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error } = await searchParams;
  const [bundle, settings, site] = await Promise.all([loadInvoice(id), getSettings(), getSiteUrl()]);
  if (!bundle) notFound();
  const { invoice, lines, payments, customer, vehicle, job, creditNotes } = bundle;
  const live = payments.filter((p) => p.status === "recorded");
  const bal = invoiceBalance(invoice, live);
  const canPay = can(role, "recordPayments") && !staff.viewingAs && invoice.kind === "tax_invoice" && invoice.status === "issued";
  const seesCost = role === "owner" || role === "accounts";
  const cost = lines.reduce((a, l) => a + l.cost_aed, 0);
  const credited = creditNotes.filter((c) => c.status === "issued").reduce((a, c) => a + c.total_aed, 0);

  return (
    <>
      <PageHeader
        title={`${invoice.number} · ${KIND_LABELS[invoice.kind]}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{vehicle ? `${formatPlate(vehicle)} · ${[vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ")}` : ""}</span>
            {job ? <span>· {job.job_number}</span> : null}
            <span>· {customer?.company_name ?? customer?.full_name}</span>
            {invoice.kind === "tax_invoice" ? <Badge tone={bal.state === "paid" ? "green" : bal.state === "unpaid" ? "red" : "amber"}>{PAYMENT_STATE_LABELS[bal.state]}</Badge> : null}
            {invoice.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href="/invoices" tone="secondary" size="lg">Invoices</LinkButton>
            {job ? <LinkButton href={`/jobs/${job.id}`} tone="secondary" size="lg">Job card</LinkButton> : null}
            <a href={`/api/pdf/invoice-by-id/${invoice.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-control font-bold bg-ink text-white hover:bg-black min-h-14 px-6 text-base">PDF</a>
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Notice tone="info">An issued invoice is locked. Corrections are by credit note, approved by the owner.{invoice.token ? ` Customer link: ${site}/invoice/${invoice.token}` : ""}</Notice>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <SectionLabel>Lines</SectionLabel>
            {(["services", "fees", "parts"] as const).map((section) => {
              const ls = lines.filter((l) => l.section === section);
              if (!ls.length) return null;
              return (
                <div key={section} className="flex flex-col gap-1">
                  <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{section === "parts" ? "Spare parts" : section === "fees" ? "Fees" : "Services"}</span>
                  <ul className="divide-y divide-line text-sm">
                    {ls.map((l) => (
                      <li key={l.id} className="py-1.5 flex flex-wrap items-center gap-3">
                        <span className="flex-1 min-w-48 font-semibold">{l.description}{l.part_number ? <span className="text-muted font-normal"> · {l.part_number}</span> : null}{l.details && l.hours === null ? <span className="block text-xs text-muted font-normal">{l.details}</span> : null}</span>
                        <span className="text-muted w-20 text-right">{l.hours !== null ? `${l.hours.toFixed(1)} h` : `× ${l.quantity}`}</span>
                        <span className="w-24 text-right">{m(l.unit_price)}</span>
                        <span className="w-28 text-right font-semibold">{l.amount_aed === 0 ? "Complimentary" : `AED ${m(l.amount_aed)}`}</span>
                        {seesCost && l.cost_aed ? <span className="w-24 text-right text-xs text-muted">cost {m(l.cost_aed)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm border-t border-line pt-2">
              <dt className="text-muted">Gross amount</dt><dd className="text-right">AED {m(invoice.subtotal_aed)}</dd>
              {invoice.discount_aed ? <><dt className="font-bold">Discount{invoice.discount_note ? ` (${invoice.discount_note})` : ""}</dt><dd className="text-right font-bold">− AED {m(invoice.discount_aed)}</dd></> : null}
              <dt className="text-muted">Taxable amount</dt><dd className="text-right">AED {m(invoice.taxable_aed)}</dd>
              <dt className="text-muted">VAT</dt><dd className="text-right">AED {m(invoice.vat_aed)}</dd>
              <dt className="text-lg font-extrabold">Total</dt><dd className="text-right text-lg font-extrabold">AED {m(invoice.total_aed)}</dd>
              {invoice.kind === "tax_invoice" ? <><dt className="text-muted">Paid</dt><dd className="text-right">AED {m(bal.paid)}</dd><dt className="font-bold">{bal.state === "paid" ? "Paid in full" : "Balance due"}</dt><dd className="text-right font-bold">{bal.state === "paid" ? (bal.paidAt ? formatDate(bal.paidAt) : "") : `AED ${m(bal.balance)}`}</dd></> : null}
              {seesCost && invoice.kind === "tax_invoice" ? <><dt className="text-xs text-muted">Parts and other costs on the lines</dt><dd className="text-right text-xs text-muted">AED {m(cost)}</dd></> : null}
            </dl>
          </Card>

          {invoice.kind === "tax_invoice" ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel right={`${live.length}`}>Payments</SectionLabel>
              {payments.length === 0 ? <p className="text-sm text-muted">Nothing received yet.</p> : null}
              <ul className="divide-y divide-line text-sm">
                {payments.map((p) => (
                  <li key={p.id} className={`py-2 flex flex-wrap items-center gap-3 ${p.status === "reversed" ? "opacity-60 line-through" : ""}`}>
                    <span className="font-semibold">{p.number}</span>
                    <span>{formatDateTime(p.received_at)}</span>
                    <Badge tone={p.method === "cheque" && p.cheque_status === "pending" ? "amber" : p.status === "reversed" ? "red" : "neutral"}>{METHOD_LABELS[p.method]}{p.method === "cheque" ? ` · ${p.cheque_status}` : ""}{p.is_deposit ? " · deposit" : ""}</Badge>
                    <span className="text-muted">{p.method === "cheque" ? `${p.cheque_number} · ${p.cheque_bank} · ${p.cheque_date}` : p.reference}</span>
                    <span className="ml-auto font-semibold">AED {m(p.amount_aed)}</span>
                    {p.bank_charge_aed && seesCost ? <span className="text-xs text-muted">charge {m(p.bank_charge_aed)}</span> : null}
                    <a href={`/api/pdf/receipt/${p.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Receipt</a>
                    {canPay && p.method === "cheque" && p.cheque_status === "pending" ? (
                      <form action={setChequeStatus.bind(null, p.id)} className="flex gap-1">
                        <Button type="submit" name="status" value="cleared" size="md" tone="secondary">Cleared</Button>
                        <Button type="submit" name="status" value="bounced" size="md" tone="danger">Bounced</Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canPay && bal.balance > 0 ? (
                <div className="border-t border-line pt-3">
                  <PaymentForm invoiceId={invoice.id} jobId={null} balance={bal.balance} action={recordPayment} bankChargeCard={Number(settings.bank_charge_card_percent) || 0} bankChargeLink={Number(settings.bank_charge_link_percent) || 0} />
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <SectionLabel>Record</SectionLabel>
            <DescriptionList
              items={[
                { label: "Issued", value: `${formatDateTime(invoice.issued_at)} by ${bundle.issuedByName ?? ""}` },
                { label: "Advisor", value: bundle.preparedByName },
                { label: "Labour", value: invoice.labour_mode === "combined" ? "Combined into one line" : "Itemised per job" },
                { label: "Agreed total", value: invoice.agreed_total_aed ? `AED ${m(invoice.agreed_total_aed)}` : null },
                { label: "Customer", value: customer ? <Link href={`/customers/${customer.id}`} className="underline underline-offset-4 font-semibold">{customer.company_name ?? customer.full_name}</Link> : null },
                { label: "Notes", value: invoice.notes },
                ...(invoice.credit_of ? [{ label: "Credit against", value: <Link href={`/invoices/${invoice.credit_of}`} className="underline underline-offset-4 font-semibold">the original invoice</Link> }] : []),
              ]}
            />
          </Card>
          {invoice.kind === "tax_invoice" ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel right={creditNotes.length ? `${creditNotes.length}` : undefined}>Credit notes</SectionLabel>
              {creditNotes.map((c) => (
                <p key={c.id} className="text-sm"><Link href={`/invoices/${c.id}`} className="font-semibold underline underline-offset-4">{c.number}</Link> · AED {m(c.total_aed)} · {formatDate(c.issued_at)}</p>
              ))}
              {credited ? <p className="text-xs text-muted">Credited so far AED {m(credited)} with VAT.</p> : null}
              {can(role, "approveCreditNotes") && !staff.viewingAs ? (
                <form action={issueCreditNote.bind(null, invoice.id)} className="flex flex-col gap-2 border-t border-line pt-2">
                  <Input name="amount" inputMode="decimal" placeholder="Amount before VAT" required />
                  <Textarea name="description" rows={2} placeholder="What is corrected (shown on the credit note)" required />
                  <Button type="submit" tone="secondary" size="md">Issue a credit note</Button>
                </form>
              ) : can(role, "issueInvoices") && !staff.viewingAs ? (
                <form action={requestCreditNote.bind(null, invoice.id)} className="flex flex-col gap-2 border-t border-line pt-2">
                  <Textarea name="reason" rows={2} placeholder="What needs correcting (the owner approves)" required />
                  <Button type="submit" tone="secondary" size="md">Ask the owner for a credit note</Button>
                </form>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
