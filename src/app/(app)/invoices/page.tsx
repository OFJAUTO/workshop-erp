import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel, Input } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { verifyPaymentAction, updateBankCharges } from "./actions";
import { Button } from "@/components/ui";
import { INVOICE_SELECT, PAYMENT_SELECT, PAYMENT_STATE_LABELS, invoiceBalance, toInvoice, toPayment, type InvoiceRow } from "@/lib/invoice-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

type JobRow = { id: string; job_number: string; status: string; ready_to_invoice_at: string | null; stage_entered_at: string; inspection_fee_due: boolean; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; customer: { full_name: string; company_name: string | null } | null };

/** Invoices: cars ready to invoice, then every invoice with what is paid, part paid, unpaid or waiting on a cheque. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; show?: string }> }) {
  const staff = await requirePermission("viewInvoices");
  const role = staff.role_id as RoleId;
  const settings = await getSettings();
  const { message, error, show } = await searchParams;
  const admin = createAdminClient();
  const [{ data: jobs }, { data: invRows }, { data: payRows }] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, ready_to_invoice_at, stage_entered_at, inspection_fee_due, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name)").eq("is_open", true).in("status", ["ready", "pending_payment", "in_delivery"]).order("stage_entered_at"),
    admin.from("invoices").select(INVOICE_SELECT + ", job:jobs(job_number, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)), customer:customers(full_name, company_name)").eq("is_active", true).order("issued_at", { ascending: false }).limit(200),
    admin.from("payments").select(PAYMENT_SELECT).eq("is_active", true).not("invoice_id", "is", null),
  ]);
  const invoices = ((invRows ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ inv: toInvoice(r), job: r.job as { job_number: string; vehicle: JobRow["vehicle"] } | null, customer: r.customer as { full_name: string; company_name: string | null } | null }));
  const payments = ((payRows ?? []) as Record<string, unknown>[]).map(toPayment);
  const invoicedJobs = new Set(invoices.filter((i) => (i.inv.kind === "tax_invoice" || (i.inv.kind === "proforma" && !i.inv.converted_to)) && i.inv.status === "issued").map((i) => i.inv.job_id));
  const toInvoiceList = ((jobs ?? []) as unknown as JobRow[]).filter((j) => !invoicedJobs.has(j.id));
  const stateOf = (inv: InvoiceRow) => (inv.kind === "tax_invoice" || (inv.kind === "proforma" && !inv.converted_to) ? invoiceBalance(inv, payments.filter((p) => p.invoice_id === inv.id)) : null);
  const filtered = invoices.filter((i) => {
    if (i.inv.kind === "proforma" && i.inv.converted_to) return false;
    const s = stateOf(i.inv);
    if (show === "unpaid") return s && s.state !== "paid";
    if (show === "paid") return s && s.state === "paid";
    return true;
  });
  const unpaidTotal = invoices.reduce((a, i) => a + (stateOf(i.inv)?.balance ?? 0), 0);
  // Payments recorded by advisors that accounts have not ticked yet; after three days the owner sees them in red.
  const toVerify = payments.filter((p) => p.status === "recorded" && !p.verified_at).sort((a, b) => (a.received_at < b.received_at ? -1 : 1));
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const oldLimit = Date.now() - 3 * 86400000;
  const invoiceOf = new Map(invoices.map((i) => [i.inv.id, i]));
  const tone = (state: string | undefined) => (state === "paid" ? "green" : state === "part_paid" ? "amber" : state === "cheque_pending" ? "amber" : state === "unpaid" ? "red" : "neutral");

  return (
    <>
      <LiveRefresh tables={["invoices", "payments", "jobs"]} pollMs={60000} />
      <PageHeader
        title="Invoices"
        subtitle={`${invoices.filter((i) => i.inv.kind === "tax_invoice").length === 1 ? "1 tax invoice" : `${invoices.filter((i) => i.inv.kind === "tax_invoice").length} tax invoices`} · AED ${unpaidTotal.toLocaleString("en-GB", { minimumFractionDigits: 2 })} outstanding`}
        actions={can(role, "exportAccounts") ? <a href="/api/export/accounts" className="inline-flex items-center justify-center rounded-control font-bold bg-white text-ink border border-line-strong hover:bg-canvas min-h-14 px-6 text-base">Export for the accountants</a> : undefined}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {can(role, "issueInvoices") && !staff.viewingAs ? (
        <details className="rounded-card border border-line bg-white px-5 py-3">
          <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">Bank charges: card {Number(settings.bank_charge_card_percent) || 0}% · link {Number(settings.bank_charge_link_percent) || 0}% · cash {Number(settings.bank_charge_cash_percent) || 0}% · cheque {Number(settings.bank_charge_cheque_percent) || 0}%</summary>
          <form action={updateBankCharges} className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
            {([["bank_charge_card_percent", "Card %"], ["bank_charge_link_percent", "Payment link %"], ["bank_charge_cash_percent", "Cash %"], ["bank_charge_cheque_percent", "Cheque %"]] as const).map(([k, l]) => (
              <label key={k} className="flex flex-col gap-1 text-xs font-semibold text-muted">{l}<Input name={k} defaultValue={String(settings[k] ?? 0)} inputMode="decimal" required /></label>
            ))}
            <Button type="submit" tone="secondary" size="md">Save</Button>
            <p className="col-span-full text-xs text-muted">Taken off each payment as it is recorded (split payments each at their own rate). Quotations assume the highest rate until the money comes in.</p>
          </form>
        </details>
      ) : null}

      {can(role, "verifyPayments") && toVerify.length ? (
        <section className="flex flex-col gap-3">
          <SectionLabel right={`${toVerify.length}`}>Payments to verify</SectionLabel>
          {toVerify.map((p) => {
            const inv = p.invoice_id ? invoiceOf.get(p.invoice_id) : null;
            const old = Date.parse(p.received_at) < oldLimit;
            return (
              <Card key={p.id} className={`flex flex-wrap items-center gap-3 ${old ? "border-red-bar" : ""}`}>
                <span className="font-extrabold">{p.number}</span>
                <span className="font-semibold">{inv?.inv.number ?? "deposit"}{inv?.job?.vehicle ? ` · ${formatPlate(inv.job.vehicle)}` : ""}</span>
                <span className="text-sm text-muted">{formatDateTime(p.received_at)} · {p.method}</span>
                <span className="font-semibold">AED {p.amount_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                {old ? <Badge tone="red">Not verified for more than 3 days</Badge> : null}
                {!staff.viewingAs ? <form action={verifyPaymentAction.bind(null, p.id)} className="ml-auto"><input type="hidden" name="return_to" value="/invoices" /><Button type="submit" size="md" tone="secondary">Verified: the money is in</Button></form> : null}
              </Card>
            );
          })}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${toInvoiceList.length}`}>To invoice</SectionLabel>
        {toInvoiceList.length === 0 ? <p className="text-sm text-muted">No car waiting for an invoice.</p> : null}
        {toInvoiceList.map((j) => (
          <Card key={j.id} className={`flex flex-wrap items-center gap-3 ${j.ready_to_invoice_at ? "border-ink" : ""}`}>
            <span className="font-extrabold">{j.vehicle ? formatPlate(j.vehicle) : j.job_number}</span>
            <span className="font-semibold">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · {j.job_number}</span>
            <span className="text-sm text-muted">{j.customer?.company_name ?? j.customer?.full_name}</span>
            {j.ready_to_invoice_at ? <Badge tone="ink">Ready to invoice since {formatDateTime(j.ready_to_invoice_at)}</Badge> : <Badge tone="neutral">Ready, advisor has not marked it yet</Badge>}
            {j.inspection_fee_due ? <Badge tone="red">Inspection fee</Badge> : null}
            <span className="ml-auto">{can(role, "issueInvoices") ? <LinkButton href={`/jobs/${j.id}/invoice`} size="md">Issue the invoice</LinkButton> : <LinkButton href={`/jobs/${j.id}`} tone="secondary" size="md">Job card</LinkButton>}</span>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SectionLabel right={`${filtered.length}`}>Issued</SectionLabel>
          <span className="ml-auto flex gap-1 text-xs font-bold">
            {[["", "All"], ["unpaid", "Unpaid or part paid"], ["paid", "Paid"]].map(([v, l]) => (
              <Link key={v} href={v ? `/invoices?show=${v}` : "/invoices"} className={`rounded-control px-3 py-1.5 ${(show ?? "") === v ? "bg-ink text-white" : "bg-chip"}`}>{l}</Link>
            ))}
          </span>
        </div>
        {filtered.length === 0 ? <Empty title="No invoices yet" /> : null}
        {filtered.map(({ inv, job, customer }) => {
          const s = stateOf(inv);
          return (
            <Link key={inv.id} href={`/invoices/${inv.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 hover:border-ink">
                <span className="font-extrabold">{inv.number}</span>
                <Badge tone="outline">{inv.kind === "tax_invoice" ? "Tax invoice" : inv.kind === "proforma" ? "Proforma, not a tax invoice" : "Credit note"}</Badge>
                <span className="font-semibold">{job?.vehicle ? formatPlate(job.vehicle) : ""} · {job?.job_number ?? ""}</span>
                <span className="text-sm text-muted">{customer?.company_name ?? customer?.full_name}</span>
                {s ? <Badge tone={tone(s.state)}>{PAYMENT_STATE_LABELS[s.state]}{s.state !== "paid" ? ` · AED ${s.balance.toLocaleString("en-GB", { minimumFractionDigits: 2 })} due` : ""}</Badge> : null}
                {inv.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : null}
                <span className="ml-auto text-sm font-semibold">AED {inv.total_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                <span className="text-xs text-muted">{formatDate(inv.issued_at)}</span>
              </Card>
            </Link>
          );
        })}
      </section>
    </>
  );
}
