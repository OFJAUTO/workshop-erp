import { notFound } from "next/navigation";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { INVOICE_SELECT, PAYMENT_SELECT, buildInvoiceDraft, toInvoice, toPayment, type LabourMode } from "@/lib/invoice-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { PaymentForm } from "@/app/(app)/invoices/[id]/PaymentForm";
import { InvoiceOptions } from "./InvoiceOptions";
import { issueInvoice, recordPayment } from "@/app/(app)/invoices/actions";

export const dynamic = "force-dynamic";

/** Money on screen: two decimals and thousands separators. */
const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Build the invoice from the approved quotations: itemised or combined labour, the Consumables line,
 * the discount or an agreed total, then issue the tax invoice or a proforma. Prices cannot change here.
 */
export default async function BuildInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string; labour?: string; consumables?: string; agreed?: string; discount?: string }> }) {
  const staff = await requirePermission("viewInvoices");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [card, settings] = await Promise.all([loadJobCard(supabase, id), getSettings()]);
  if (!card) notFound();
  const { job, vehicle, customer } = card;
  const labourMode: LabourMode = sp.labour === "combined" ? "combined" : "itemised";
  const consumables = sp.consumables === "1" ? Number(settings.consumables_default_aed) || 0 : sp.consumables ? Number(sp.consumables) || 0 : 0;
  const agreedTotal = sp.agreed ? Number(sp.agreed) || null : null;
  const discountPercent = sp.discount !== undefined && sp.discount !== "" ? Number(sp.discount) : null;
  const admin = createAdminClient();
  const [draft, { data: existing }, { data: deposits }] = await Promise.all([
    buildInvoiceDraft(id, settings, { labourMode, consumables, agreedTotal, discountPercent }),
    admin.from("invoices").select(INVOICE_SELECT).eq("job_id", id).eq("is_active", true).order("issued_at", { ascending: false }),
    admin.from("payments").select(PAYMENT_SELECT).eq("job_id", id).eq("is_active", true).is("invoice_id", null),
  ]);
  const invoices = ((existing ?? []) as Record<string, unknown>[]).map(toInvoice);
  const taxInvoice = invoices.find((i) => i.kind === "tax_invoice" && i.status === "issued") ?? null;
  const depositRows = ((deposits ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded");
  const depositTotal = depositRows.reduce((a, p) => a + p.amount_aed, 0);
  const canIssue = can(role, "issueInvoices") && !staff.viewingAs && job.is_open && !taxInvoice;
  const services = draft.lines.filter((l) => l.section !== "parts");
  const parts = draft.lines.filter((l) => l.section === "parts");

  return (
    <>
      <PageHeader title={`Invoice · ${formatPlate(vehicle)}`} subtitle={`${vehicleTitle(vehicle)} · ${job.job_number} · ${STATUS_LABELS[job.status]} · ${customer?.company_name ?? customer?.full_name ?? ""}`} actions={<><LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton><LinkButton href="/invoices" tone="secondary" size="lg">Invoices</LinkButton></>} />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {taxInvoice ? <Notice tone="info">{taxInvoice.number} is issued for this job ({formatDateTime(taxInvoice.issued_at)}). Corrections are by credit note. <LinkButton href={`/invoices/${taxInvoice.id}`} tone="secondary" size="md">Open it</LinkButton></Notice> : null}
      {!job.ready_to_invoice_at && !taxInvoice ? <Notice tone="info">The advisor has not marked this car ready to invoice yet. You can still prepare it.</Notice> : null}
      {draft.quotationNumbers.length === 0 && !job.inspection_fee_due ? <Notice tone="error">No approved quotation on this job and no inspection fee due. Nothing to invoice.</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Options</SectionLabel>
            <InvoiceOptions labourMode={labourMode} consumables={!!consumables} consumablesDefault={Number(settings.consumables_default_aed) || 0} agreed={sp.agreed ?? ""} discount={sp.discount ?? ""} quotedDiscount={draft.totals.discountPercent} />
            {draft.totals.agreedTotalProblem ? <p className="text-sm font-semibold text-red">{draft.totals.agreedTotalProblem}</p> : null}
            {draft.totals.agreedTotalApplied ? <p className="text-sm font-semibold text-green">Agreed total applied: discount {draft.totals.discountPercent}% on labour and services (limit {settings.discount_limit_percent}%).</p> : null}
            {draft.totals.warrantyCredit ? <p className="text-sm font-semibold">Warranty repair: the work and parts show at their normal value, then &quot;Warranty repair, no charge&quot; brings the total to zero.</p> : null}
          </Card>

          <Card className="flex flex-col gap-2">
            <SectionLabel right={draft.quotationNumbers.length ? `from ${draft.quotationNumbers.join(", ")}` : undefined}>Lines</SectionLabel>
            {[{ title: "Services", ls: services }, { title: "Spare parts", ls: parts }].map(({ title, ls }) => (
              <div key={title} className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{title}</span>
                {ls.length === 0 ? <p className="text-sm text-muted">None</p> : null}
                <ul className="divide-y divide-line text-sm">
                  {ls.map((l, i) => (
                    <li key={i} className="py-1.5 flex flex-wrap items-center gap-3">
                      <span className="flex-1 min-w-48 font-semibold">{l.description}{l.part_number ? <span className="text-muted font-normal"> · {l.part_number}</span> : null}{l.section === "fees" ? <Badge tone="red">Fee</Badge> : null}</span>
                      <span className="text-muted w-20 text-right">{l.hours !== null ? `${l.hours.toFixed(1)} h` : `× ${l.quantity}`}</span>
                      <span className="w-24 text-right">{m(l.unit_price)}</span>
                      <span className="w-28 text-right font-semibold">{l.amount_aed === 0 ? "Complimentary" : `AED ${m(l.amount_aed)}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm border-t border-line pt-2">
              <dt className="text-muted">Gross amount</dt><dd className="text-right">AED {m(draft.totals.gross)}</dd>
              {draft.totals.discount ? <><dt className="font-bold">Discount on labour and services ({draft.totals.discountPercent}%)</dt><dd className="text-right font-bold">− AED {m(draft.totals.discount)}</dd></> : null}
              {draft.totals.warrantyCredit ? <><dt className="font-bold">Warranty repair, no charge</dt><dd className="text-right font-bold">− AED {m(draft.totals.warrantyCredit)}</dd></> : null}
              <dt className="text-muted">Taxable amount</dt><dd className="text-right">AED {m(draft.totals.taxable)}</dd>
              <dt className="text-muted">VAT {draft.vatPercent}%</dt><dd className="text-right">AED {m(draft.totals.vat)}</dd>
              <dt className="text-lg font-extrabold">Total</dt><dd className="text-right text-lg font-extrabold">AED {m(draft.totals.total)}</dd>
              {depositTotal ? <><dt className="text-muted">Deposits received, applied on issue</dt><dd className="text-right">AED {m(depositTotal)}</dd></> : null}
            </dl>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {canIssue && draft.lines.length ? (
            <Card className="flex flex-col gap-3 border-ink">
              <SectionLabel>Issue</SectionLabel>
              <form action={issueInvoice.bind(null, id)} className="flex flex-col gap-2">
                <input type="hidden" name="labour_mode" value={labourMode} />
                {consumables ? <><input type="hidden" name="consumables" value="on" /><input type="hidden" name="consumables_aed" value={String(consumables)} /></> : null}
                <input type="hidden" name="agreed_total" value={sp.agreed ?? ""} />
                <input type="hidden" name="discount_percent" value={sp.discount ?? ""} />
                <Textarea name="notes" rows={2} placeholder="Note on the invoice (optional)" />
                <Button type="submit" name="kind" value="tax_invoice" size="lg" className="w-full">Issue the tax invoice</Button>
                <Button type="submit" name="kind" value="proforma" tone="secondary" size="md" className="w-full">Issue a proforma (for a deposit)</Button>
              </form>
            </Card>
          ) : null}
          {invoices.filter((i) => i.kind !== "tax_invoice").length ? (
            <Card className="flex flex-col gap-1">
              <SectionLabel>Earlier documents</SectionLabel>
              {invoices.filter((i) => i.kind !== "tax_invoice").map((i) => <p key={i.id} className="text-sm"><LinkButton href={`/invoices/${i.id}`} tone="secondary" size="md">{i.number}</LinkButton></p>)}
            </Card>
          ) : null}
          {can(role, "recordPayments") && !staff.viewingAs && !taxInvoice && job.is_open ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Deposit before the invoice</SectionLabel>
              {depositRows.map((p) => <p key={p.id} className="text-sm">{p.number} · AED {m(p.amount_aed)} by {p.method} · {formatDateTime(p.received_at)}</p>)}
              <PaymentForm invoiceId={null} jobId={id} balance={null} action={recordPayment} bankChargeCard={Number(settings.bank_charge_card_percent) || 0} bankChargeLink={Number(settings.bank_charge_link_percent) || 0} returnTo={`/jobs/${id}/invoice?labour=${labourMode}&consumables=${sp.consumables ?? ""}&agreed=${sp.agreed ?? ""}&discount=${sp.discount ?? ""}`} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
