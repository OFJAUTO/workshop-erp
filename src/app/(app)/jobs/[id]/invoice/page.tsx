import { notFound } from "next/navigation";
import { CarHeaderThumb } from "@/components/CarHeaderThumb";
import { Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime, formatDayTime } from "@/lib/format";
import { INVOICE_SELECT, METHOD_LABELS, PAYMENT_SELECT, buildInvoiceDraft, invoiceBalance, nextDocumentNumber, toInvoice, toPayment, type PaymentRow } from "@/lib/invoice-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS } from "@/lib/jobs";
import { PAYMENT_METHOD_LABELS, methodsFor, moneyState, type MoneyInvoice, type MoneyStepKey } from "@/lib/money-steps";
import { ngeniusConfigured } from "@/lib/ngenius";
import { currentPaymentLink, paymentLinksOf } from "@/lib/payment-links";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { PaymentForm } from "@/app/(app)/invoices/[id]/PaymentForm";
import { addPayNow, customerSaysPaid, issueInvoice, markReadyToInvoice, recordPayment, setPaymentLink, verifyPaymentAction } from "@/app/(app)/invoices/actions";
import { ReadySendControl } from "../ReadySendControl";
import { DepositReceiptSend } from "@/components/DepositReceiptSend";

export const dynamic = "force-dynamic";

/** Money on screen: two decimals and thousands separators. */
const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type LiveInvoice = MoneyInvoice & { id: string; total_aed: number; issued_at: string; issue_reason: string | null };

/**
 * The money side of one job in four numbered steps: 1 PROFORMA SENT, 2 PAYMENT, 3 TAX INVOICE, 4 READY FOR GATE-OUT.
 * Only the current step has the black button; done steps are pale green with a tick, later steps grey. The invoice
 * is always a straight copy of the approved quotation: nothing to choose or type here.
 */
export default async function BuildInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("viewInvoices");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [card, settings, site] = await Promise.all([loadJobCard(supabase, id), getSettings(), getSiteUrl()]);
  if (!card) notFound();
  const { job, vehicle, customer } = card;
  const admin = createAdminClient();
  const [draft, { data: existing }, { data: deposits }, { data: creditCust }, { data: stepJob }] = await Promise.all([
    buildInvoiceDraft(id, settings),
    admin.from("invoices").select(INVOICE_SELECT + ", expected_payment_method, customer_says_paid_at, customer_says_paid_method, pay_now_enabled, sent_at").eq("job_id", id).eq("is_active", true).order("issued_at", { ascending: false }),
    admin.from("payments").select(PAYMENT_SELECT).eq("job_id", id).eq("is_active", true).is("invoice_id", null),
    admin.from("customers").select("credit_terms_days").eq("id", job.customer_id).maybeSingle(),
    admin.from("jobs").select("declined_out_at").eq("id", id).maybeSingle(),
  ]);
  const invoices = ((existing ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...toInvoice(r), expected_payment_method: (r.expected_payment_method as string | null) ?? null, customer_says_paid_at: (r.customer_says_paid_at as string | null) ?? null, customer_says_paid_method: (r.customer_says_paid_method as string | null) ?? null, pay_now_enabled: !!r.pay_now_enabled, sent_at: (r.sent_at as string | null) ?? null }));
  const taxInvoice = (invoices.find((i) => i.kind === "tax_invoice" && i.status === "issued") ?? null) as LiveInvoice | null;
  const proforma = (invoices.find((i) => i.kind === "proforma" && i.status === "issued" && !i.converted_to && !i.deposit_for_quotation_id) ?? null) as (LiveInvoice & { customer_says_paid_method: string | null }) | null;
  const live = taxInvoice ?? proforma;
  const { data: livePays } = live ? await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", live.id).eq("is_active", true).order("received_at") : { data: [] };
  const payments = ((livePays ?? []) as Record<string, unknown>[]).map(toPayment);
  const bal = live ? invoiceBalance(live, payments) : null;
  const depositRows = ((deposits ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded");
  const depositTotal = depositRows.reduce((a, p) => a + p.amount_aed, 0);
  // The deposit receipt goes to the customer with the quotation's own link token and the message from Settings.
  const { data: approvedQ } = await createAdminClient().from("quotations").select("token").eq("job_id", id).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  const quoteToken = approvedQ?.token ?? null;
  const depositMessage = (amount: number, link: string) =>
    String(settings.whatsapp_deposit_receipt_template ?? "")
      .replaceAll("[name]", card.customer?.full_name ?? "")
      .replaceAll("[make model]", vehicleTitle(card.vehicle))
      .replaceAll("[plate]", formatPlate(card.vehicle))
      .replaceAll("[amount]", m(amount))
      .replaceAll("[link]", link);
  const creditDays = Number(creditCust?.credit_terms_days) || 0;
  const money = moneyState({
    jobStatus: job.status,
    isOpen: job.is_open,
    gatedOutAt: job.gated_out_at,
    proforma,
    taxInvoice,
    total: live?.total_aed ?? 0,
    paid: bal?.paid ?? 0,
    balance: bal?.balance ?? 0,
    chequePending: bal?.pendingAmount ?? 0,
    needsInvoice: draft.lines.length > 0,
    creditDays,
    declinedOut: !!stepJob?.declined_out_at,
    waitingHours: Number(settings.payment_waiting_hours) || 24,
  });
  const links = live ? await paymentLinksOf(live.id) : [];
  const payLink = currentPaymentLink(links);
  const nextTax = proforma && !taxInvoice ? await nextDocumentNumber("tax_invoice", settings) : null;
  const { data: people } = payments.length ? await admin.from("staff").select("id, display_name, role_id").in("id", Array.from(new Set(payments.flatMap((p) => [p.received_by, p.verified_by]).filter((x): x is string => !!x)))) : { data: [] };
  const personOf = new Map((people ?? []).map((p) => [p.id, p]));
  const acting = !staff.viewingAs && job.is_open;
  const canRecord = can(role, "recordPayments") && acting;
  const canSend = can(role, "sendApproval") && acting;
  const canVerify = can(role, "verifyPayments") && acting;
  const phoneDigits = (customer?.phone ?? "").replace(/[^\d]/g, "");
  const customerName = customer?.company_name ?? customer?.full_name ?? "Customer";
  const fillCar = (t: string) => t.replaceAll("[make model]", [vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ")).replaceAll("[plate]", formatPlate(vehicle)).replaceAll("[advisor]", staff.display_name).replaceAll("[name]", customerName).replaceAll("[bank]", "");
  const readyTemplate = fillCar(settings.whatsapp_ready_template);
  const invoiceTemplate = fillCar(String(settings.whatsapp_invoice_template ?? ""));
  const bankCharges = { cash: Number(settings.bank_charge_cash_percent) || 0, card: Number(settings.bank_charge_card_percent) || 0, link: Number(settings.bank_charge_link_percent) || 0, cheque: Number(settings.bank_charge_cheque_percent) || 0, transfer: Number(settings.bank_charge_transfer_percent) || 0 };
  const services = draft.lines.filter((l) => l.section !== "parts");
  const parts = draft.lines.filter((l) => l.section === "parts");
  const here = `/jobs/${id}/invoice`;
  const unpaid = !!live && (bal?.balance ?? 0) > 0.005;
  const payNowOn = !!payLink && !payLink.paid_at && unpaid;

  const stateOf = (k: MoneyStepKey): "done" | "current" | "later" => (money.done.includes(k) ? "done" : money.current === k ? "current" : "later");
  const stepClass = (s: "done" | "current" | "later") => (s === "done" ? "bg-green-soft/50 border-green" : s === "current" ? "bg-white ring-2 ring-ink border-ink" : "bg-canvas border-line opacity-80");
  // Plain helpers that return markup (not components): the lint rule forbids components made during render.
  const stepNumber = (n: number, s: "done" | "current" | "later") => (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${s === "done" ? "bg-green text-white" : s === "current" ? "bg-ink text-white" : "bg-chip text-muted"}`}>{s === "done" ? "✓" : n}</span>
  );
  const chipTone = money.chip.tone === "ink" ? "ink" : money.chip.tone;

  const paymentLine = (p: PaymentRow) => {
    const by = p.received_by ? personOf.get(p.received_by) : null;
    const counter = !!by && by.role_id !== "owner" && by.role_id !== "accounts";
    const struck = p.status === "voided" || p.status === "reversed";
    return (
      <li key={p.id} className={`py-2 flex flex-wrap items-center gap-3 text-sm ${struck ? "text-muted line-through" : ""}`} data-payment-row={p.number}>
        <span className="font-semibold">{p.number}</span>
        <span className="text-muted">{formatDayTime(p.received_at)}</span>
        <Badge tone={p.status === "pending_owner" ? "amber" : p.method === "cheque" && p.cheque_status === "pending" ? "amber" : struck ? "red" : "neutral"}>{METHOD_LABELS[p.method]}{p.method === "cheque" && p.cheque_status ? ` · ${p.cheque_status}` : ""}</Badge>
        {p.reference ? <span className="text-xs text-muted">{p.reference}</span> : null}
        <span className="text-xs text-muted">by {by?.display_name ?? "Network International"}</span>
        <span className="ml-auto font-semibold">AED {m(p.amount_aed)}</span>
        {p.status === "recorded" && !p.verified_at && counter ? <Badge tone="amber">Recorded by advisor, to confirm</Badge> : null}
        {p.status === "recorded" && !p.verified_at && counter && canVerify ? <form action={verifyPaymentAction.bind(null, p.id)}><input type="hidden" name="return_to" value={here} /><Button type="submit" size="md" tone="secondary" data-confirm-counter>Confirmed</Button></form> : null}
        {p.status === "pending_owner" ? <Badge tone="amber">Waiting for the owner</Badge> : null}
        {p.status === "recorded" ? <a href={`/api/pdf/receipt/${p.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Receipt</a> : null}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        picture={<CarHeaderThumb vehicleId={job.vehicle_id} />}
        title={`Invoice · ${formatPlate(vehicle)}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span>{vehicleTitle(vehicle)} · {job.job_number} · {STATUS_LABELS[job.status]} · {customerName}</span><Badge tone={chipTone}>{money.chip.text}</Badge>{money.waitingHours ? <Badge tone="red">Waiting {money.waitingHours} h</Badge> : null}</span>}
        actions={<><LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton>{live && can(role, "viewInvoices") ? <LinkButton href={`/invoices/${live.id}`} tone="secondary" size="lg">Full record</LinkButton> : null}</>}
      />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {draft.lines.length === 0 && !live ? <Notice tone="error">No approved quotation on this job and no inspection fee due. Nothing to invoice.</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-3" data-money-steps>
          {/* 1. PROFORMA SENT */}
          {(() => {
            const s = stateOf("proforma_sent");
            return (
              <Card className={`flex flex-col gap-3 ${stepClass(s)}`} data-step="proforma_sent" data-state={s}>
                <div className="flex items-center gap-3">{stepNumber(1, s)}<span className="text-xs font-extrabold uppercase tracking-[0.08em]">Proforma sent</span>
                  {proforma ? <span className="ml-auto text-sm font-semibold">{proforma.number}{proforma.sent_at ? ` · sent ${formatDayTime(proforma.sent_at)}` : " · not sent yet"}</span> : taxInvoice ? <span className="ml-auto text-sm font-semibold">Done</span> : null}
                </div>
                {proforma?.expected_payment_method ? <p className="text-sm">Expected payment: <strong>{PAYMENT_METHOD_LABELS[proforma.expected_payment_method] ?? proforma.expected_payment_method}</strong>{bankCharges[proforma.expected_payment_method as keyof typeof bankCharges] ? ` (${bankCharges[proforma.expected_payment_method as keyof typeof bankCharges]}% bank charge, internal)` : ""}</p> : null}
                {!live && money.action === "prepare_proforma" && can(role, "markReadyToInvoice") && acting ? (
                  <form action={markReadyToInvoice.bind(null, id)}><Button type="submit" size="lg" className="w-full sm:w-auto">Prepare the proforma</Button></form>
                ) : null}
                {!live && money.action !== "prepare_proforma" && !taxInvoice ? <p className="text-sm text-muted">The proforma is prepared by itself when the car is Ready.</p> : null}
                {proforma && canSend && unpaid ? (
                  <div className="flex flex-col gap-2">
                    <ReadySendControl jobId={id} size={s === "current" ? "lg" : "md"} token={proforma.token} kind="proforma" siteUrl={site} messageTemplate={readyTemplate} phoneDigits={phoneDigits} sentAt={proforma.sent_at} expectedMethod={proforma.expected_payment_method ?? null} payNowAvailable={ngeniusConfigured()} payNowOn={payNowOn} charges={bankCharges} pdf={proforma.token ? { href: `/api/pdf/invoice/${proforma.token}`, fileName: `OFJ Proforma ${proforma.number}.pdf` } : null} />
                    {proforma.sent_at && !payNowOn && ngeniusConfigured() ? <form action={addPayNow.bind(null, proforma.id)}><input type="hidden" name="return_to" value={here} /><Button type="submit" size="md" tone="secondary" data-add-pay-now>Add Pay now and resend</Button></form> : null}
                  </div>
                ) : null}
                {live && unpaid ? (
                  <details className="text-sm" data-payment-link-box>
                    <summary className="cursor-pointer min-h-11 flex items-center font-bold">{payNowOn ? (payLink?.provider === "ngenius" ? "Pay now is on the customer's page (Network International)" : "Pay now is on the customer's page (pasted link)") : "Payment link"}</summary>
                    <div className="mt-2 flex flex-col gap-2">
                      {payLink && !payLink.paid_at ? <p className="text-xs text-muted break-all">{payLink.provider === "ngenius" ? `Order for AED ${m(payLink.amount_aed ?? 0)} · ${payLink.opened_at ? `opened by the customer ${formatDateTime(payLink.opened_at)}` : "not opened yet"}` : `${payLink.url} · ${payLink.opened_at ? `opened ${formatDateTime(payLink.opened_at)}, works once` : "not opened yet"}`}</p> : null}
                      {can(role, "issueInvoices") || can(role, "sendApproval") ? (
                        <form action={setPaymentLink.bind(null, live.id)} className="flex flex-wrap items-center gap-2">
                          <Input name="payment_link_url" placeholder={payLink ? "Paste a new https:// link to replace it" : "Paste an https:// payment link"} className="max-w-md" />
                          <Button type="submit" tone="secondary" size="md">{payLink ? "Replace the link" : "Add Pay now to the customer page"}</Button>
                        </form>
                      ) : null}
                    </div>
                  </details>
                ) : null}
                {!live && canRecord ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer min-h-11 flex items-center font-bold">Deposit before the proforma{depositTotal ? ` · AED ${m(depositTotal)} received` : ""}</summary>
                    <div className="mt-2 flex flex-col gap-2">
                      {depositRows.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm" data-deposit-row={p.number}>
                          <span className="font-semibold">{p.number}</span>
                          <span>AED {m(p.amount_aed)} by {METHOD_LABELS[p.method]}</span>
                          <span className="text-muted">{formatDateTime(p.received_at)}</span>
                          <a href={`/api/pdf/receipt/${p.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Receipt</a>
                          <DepositReceiptSend number={p.number} message={depositMessage(p.amount_aed, `${site}/api/pdf/receipt/${p.id}${quoteToken ? `?q=${quoteToken}` : ""}`)} phoneDigits={(card.customer?.phone ?? "").replace(/[^\d]/g, "")} pdfHref={`/api/pdf/receipt/${p.id}`} fileName={`OFJ Receipt ${p.number}.pdf`} jobId={id} />
                        </div>
                      ))}
                      <PaymentForm invoiceId={null} jobId={id} balance={draft.lines.length ? Math.max(0, Math.round((draft.totals.total - depositTotal) * 100) / 100) : null} action={recordPayment} returnTo={here} charges={bankCharges} methods={methodsFor(role)} isOwner={role === "owner"} />
                    </div>
                  </details>
                ) : null}
              </Card>
            );
          })()}

          {/* 2. PAYMENT */}
          {(() => {
            const s = stateOf("payment");
            return (
              <Card className={`flex flex-col gap-3 ${stepClass(s)}`} data-step="payment" data-state={s}>
                <div className="flex items-center gap-3">{stepNumber(2, s)}<span className="text-xs font-extrabold uppercase tracking-[0.08em]">Payment</span>{proforma?.customer_says_paid_at ? <Badge tone="amber">Customer says paid, checking</Badge> : null}</div>
                {live && bal ? (
                  <div className="grid grid-cols-3 gap-3" data-money-figures>
                    <div className="flex flex-col"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Total</span><span className="text-xl sm:text-2xl font-extrabold">AED {m(live.total_aed)}</span></div>
                    <div className="flex flex-col"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Paid</span><span className="text-xl sm:text-2xl font-extrabold">AED {m(bal.paid)}</span></div>
                    <div className="flex flex-col"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Balance</span><span className={`text-xl sm:text-2xl font-extrabold ${bal.balance > 0 ? "text-red" : "text-green"}`} data-balance>AED {m(bal.balance)}</span></div>
                  </div>
                ) : <p className="text-sm text-muted">After the proforma.</p>}
                {bal?.pendingAmount ? <p className="text-sm font-semibold text-amber">Cheque of AED {m(bal.pendingAmount)} pending clearance.</p> : null}
                {payments.length ? <ul className="divide-y divide-line">{payments.map((p) => paymentLine(p))}</ul> : null}
                {live && unpaid && canRecord && !creditDays && (s === "current" || role === "owner") ? (
                  <div className="border-t border-line pt-3" data-record-block>
                    <PaymentForm invoiceId={live.id} jobId={null} balance={bal!.balance} action={recordPayment} returnTo={here} charges={bankCharges} methods={methodsFor(role)} expected={proforma?.expected_payment_method ?? null} invoiceNumber={live.number} isProforma={live.kind === "proforma"} nextTaxNumber={nextTax} isOwner={role === "owner"} />
                  </div>
                ) : live && unpaid && canRecord && !creditDays ? (
                  // Money can arrive before the proforma is sent (a customer at the counter): the form is there, folded.
                  <details className="border-t border-line pt-3" data-record-block data-folded>
                    <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold text-muted">Record a payment before the proforma is sent</summary>
                    <div className="pt-2">
                      <PaymentForm invoiceId={live.id} jobId={null} balance={bal!.balance} action={recordPayment} returnTo={here} charges={bankCharges} methods={methodsFor(role)} expected={proforma?.expected_payment_method ?? null} invoiceNumber={live.number} isProforma={live.kind === "proforma"} nextTaxNumber={nextTax} isOwner={role === "owner"} />
                    </div>
                  </details>
                ) : null}
                {live && unpaid && canRecord && creditDays ? (
                  <div className="border-t border-line pt-3" data-record-block>
                    <p className="text-sm font-semibold mb-2">Credit terms: {creditDays} days. The car may leave; record the payment here when it arrives.</p>
                    <PaymentForm invoiceId={live.id} jobId={null} balance={bal!.balance} action={recordPayment} returnTo={here} charges={bankCharges} methods={methodsFor(role)} expected={proforma?.expected_payment_method ?? null} invoiceNumber={live.number} isProforma={live.kind === "proforma"} nextTaxNumber={nextTax} isOwner={role === "owner"} />
                  </div>
                ) : null}
                {live && unpaid && acting && s === "current" && !proforma?.customer_says_paid_at && (role === "service_advisor" || role === "owner") ? (
                  <form action={customerSaysPaid.bind(null, live.id)} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <input type="hidden" name="return_to" value={here} />
                    <input type="hidden" name="method" value={proforma?.expected_payment_method ?? ""} />
                    <Input name="note" placeholder="Note (optional): reference, time, bank" className="max-w-xs" />
                    <Button type="submit" size="md" tone="secondary" data-customer-says-paid>Customer says paid</Button>
                    <span className="text-xs text-muted">Accounts are asked to check the bank. Nothing is released by it.</span>
                  </form>
                ) : null}
                {proforma?.customer_says_paid_at ? <p className="text-xs text-muted">Customer said paid {formatDateTime(proforma.customer_says_paid_at)}{proforma.customer_says_paid_method ? ` by ${PAYMENT_METHOD_LABELS[proforma.customer_says_paid_method] ?? proforma.customer_says_paid_method}` : ""}. Accounts check the bank and record it.</p> : null}
                {live && !unpaid ? <p className="text-sm font-bold text-green">Paid in full{bal?.paidAt ? ` · ${formatDayTime(bal.paidAt)}` : ""}</p> : null}
              </Card>
            );
          })()}

          {/* 3. TAX INVOICE */}
          {(() => {
            const s = stateOf("tax_invoice");
            return (
              <Card className={`flex flex-col gap-3 ${stepClass(s)}`} data-step="tax_invoice" data-state={s}>
                <div className="flex items-center gap-3">{stepNumber(3, s)}<span className="text-xs font-extrabold uppercase tracking-[0.08em]">Tax invoice</span>
                  {taxInvoice ? <span className="ml-auto text-sm font-semibold">{taxInvoice.number} · {formatDayTime(taxInvoice.issued_at)}{taxInvoice.sent_at ? ` · sent ${formatDayTime(taxInvoice.sent_at)}` : ""}</span> : null}
                </div>
                {!taxInvoice ? <p className="text-sm text-muted">Created by itself the moment {proforma?.number ?? "the proforma"} is paid in full{nextTax ? ` (it will be ${nextTax})` : ""}. A tax invoice can&apos;t be cancelled or deleted; corrections are by credit note, approved by the owner.</p> : null}
                {taxInvoice && canSend ? (
                  <ReadySendControl jobId={id} size={s === "current" ? "lg" : "md"} token={taxInvoice.token} kind="tax_invoice" siteUrl={site} messageTemplate={invoiceTemplate} phoneDigits={phoneDigits} sentAt={taxInvoice.sent_at} pdf={taxInvoice.token ? { href: `/api/pdf/invoice/${taxInvoice.token}`, fileName: `OFJ Tax invoice ${taxInvoice.number}.pdf` } : null} />
                ) : null}
                {taxInvoice && unpaid ? <p className="text-sm font-semibold text-amber">Issued before full payment{taxInvoice.issue_reason ? `: ${taxInvoice.issue_reason}` : ""}. The balance is still due.</p> : null}
                {proforma && !taxInvoice && role === "owner" && acting ? (
                  <details className="text-xs" data-issue-early>
                    <summary className="cursor-pointer min-h-11 flex items-center font-semibold text-muted underline underline-offset-4">Issue the tax invoice early (owner only, with a reason)</summary>
                    <form action={issueInvoice.bind(null, id)} className="mt-2 flex flex-col gap-2 max-w-md">
                      <Textarea name="reason" rows={2} required placeholder="Reason for issuing before full payment (accounts are told)" />
                      <div><Button type="submit" size="md" tone="secondary">Issue the tax invoice now</Button></div>
                    </form>
                  </details>
                ) : null}
              </Card>
            );
          })()}

          {/* 4. READY FOR GATE-OUT */}
          {(() => {
            const s = stateOf("released");
            const gateReady = money.action === "gate_out";
            return (
              <Card className={`flex flex-col gap-3 ${stepClass(s)}`} data-step="released" data-state={s}>
                <div className="flex items-center gap-3">{stepNumber(4, s)}<span className="text-xs font-extrabold uppercase tracking-[0.08em]">Ready for gate-out</span>{job.gated_out_at ? <span className="ml-auto text-sm font-semibold">Gated out {formatDayTime(job.gated_out_at)}</span> : null}</div>
                {!job.is_open ? <p className="text-sm text-muted">The car has left.</p> : gateReady && can(role, "gateOut") && acting ? (
                  <LinkButton href={`/jobs/${id}/gate-out`} size="lg" className="w-full sm:w-auto">Gate out</LinkButton>
                ) : gateReady ? <p className="text-sm">Ready: the advisor or accounts gate the car out.</p> : creditDays && live && unpaid ? (
                  <p className="text-sm">Credit terms ({creditDays} days): the car may leave; the balance is due after. {can(role, "gateOut") && acting ? <LinkButton href={`/jobs/${id}/gate-out`} size="md" tone="secondary">Gate out on credit</LinkButton> : null}</p>
                ) : (
                  <p className="text-sm text-muted">{unpaid ? "After full payment." : !live ? "After the proforma is paid." : "After the tax invoice is sent."}</p>
                )}
              </Card>
            );
          })()}
        </div>

        <div className="flex flex-col gap-4">
          {invoices.length ? (
            <Card className="flex flex-col gap-1">
              <SectionLabel>Documents</SectionLabel>
              {invoices.map((i) => <p key={i.id} className="text-sm flex flex-wrap items-center gap-2"><LinkButton href={`/invoices/${i.id}`} tone="secondary" size="md">{i.number}</LinkButton><span className="text-xs text-muted">{i.kind === "tax_invoice" ? "Tax invoice" : i.kind === "proforma" ? (i.converted_to ? "Proforma, became the tax invoice" : i.deposit_for_quotation_id ? "Deposit proforma" : "Proforma") : "Credit note"} · {formatDayTime(i.issued_at)}</span>{i.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : null}</p>)}
            </Card>
          ) : null}
          <Card className="flex flex-col gap-2">
            <SectionLabel right={draft.quotationNumbers.length ? `a copy of ${draft.quotationNumbers.join(", ")}` : undefined}>Lines</SectionLabel>
            <p className="text-xs text-muted">Exactly what the customer approved: the same lines, discount and total. Nothing to choose or type here. A change needs a revised quotation or the owner.</p>
            {[{ title: "Services", ls: services }, { title: "Spare parts", ls: parts }].map(({ title, ls }) => (
              <div key={title} className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{title}</span>
                {ls.length === 0 ? <p className="text-sm text-muted">None</p> : null}
                <ul className="divide-y divide-line text-sm">
                  {ls.map((l, i) => (
                    <li key={i} className="py-1.5 flex flex-wrap items-center gap-3">
                      <span className="flex-1 min-w-40 font-semibold">{l.description}{l.section === "fees" ? <Badge tone="red">Fee</Badge> : null}</span>
                      <span className="text-muted w-16 text-right">{l.hours !== null ? `${l.hours.toFixed(1)} h` : `× ${l.quantity}`}</span>
                      <span className="w-24 text-right font-semibold">{l.amount_aed === 0 ? "Free" : `AED ${m(l.amount_aed)}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm border-t border-line pt-2">
              <dt className="text-muted">Gross amount</dt><dd className="text-right">AED {m(draft.totals.gross)}</dd>
              {draft.totals.discount ? <><dt className="font-bold">Discount ({draft.totals.discountPercent}%), as quoted</dt><dd className="text-right font-bold">− AED {m(draft.totals.discount)}</dd></> : null}
              {draft.totals.warrantyCredit ? <><dt className="font-bold">Warranty repair, no charge</dt><dd className="text-right font-bold">− AED {m(draft.totals.warrantyCredit)}</dd></> : null}
              {draft.totals.rounding ? <><dt className="text-muted">Rounding, as quoted</dt><dd className="text-right">{draft.totals.rounding < 0 ? "− " : ""}AED {m(Math.abs(draft.totals.rounding))}</dd></> : null}
              <dt className="text-muted">Taxable amount</dt><dd className="text-right">AED {m(draft.totals.taxable)}</dd>
              <dt className="text-muted">VAT {draft.vatPercent}%</dt><dd className="text-right">AED {m(draft.totals.vat)}</dd>
              <dt className="text-lg font-extrabold">Total</dt><dd className="text-right text-lg font-extrabold">AED {m(draft.totals.total)}</dd>
              {depositTotal && !live ? <><dt className="text-muted">Deposits received, applied on issue</dt><dd className="text-right">AED {m(depositTotal)}</dd></> : null}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
