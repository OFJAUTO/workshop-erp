import { awaitsBank, duplicateWords, pendingLine } from "@/lib/bank-status";
import { loadBankWaiting } from "@/lib/bank-posting";
import { dubaiToday } from "@/lib/card-settlements";
import { BankAnswerHost, BankRow } from "@/components/BankPosting";
import { SlipTile } from "@/components/PaymentReport";
import { bankPostingReady } from "@/lib/schema-ready";
import { VinCopy } from "@/components/VinCopy";
import { signJobFiles } from "@/lib/work-data";
import { PositionsLine } from "@/components/PositionsLine";
import { notFound } from "next/navigation";
import { CarHeaderThumb } from "@/components/CarHeaderThumb";
import { Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { detailsWithoutHours, formatDateTime, formatDayTime, hoursQty } from "@/lib/format";
import { INVOICE_LINE_SELECT, INVOICE_SELECT, METHOD_LABELS, PAYMENT_SELECT, buildInvoiceDraft, creditsOnDocs, invoiceBalance, nextDocumentNumber, toInvoice, toInvoiceLine, toPayment, type PaymentRow } from "@/lib/invoice-data";
import { loadJobCard, vehicleTitle } from "@/lib/job-data";
import { STATUS_LABELS } from "@/lib/jobs";
import { PAYMENT_METHOD_LABELS, methodsFor, moneyState, type MoneyInvoice, type MoneyStepKey, bankWaitWords } from "@/lib/money-steps";
import { ngeniusConfigured } from "@/lib/ngenius";
import { currentPaymentLink, paymentLinksOf } from "@/lib/payment-links";
import { can, type RoleId } from "@/lib/roles";
import { getSettings, bankFeesOf } from "@/lib/settings";
import { getSiteUrl, PRODUCTION_SITE_URL } from "@/lib/site";
import { shortFor } from "@/lib/short-links";
import { greetingNameOf } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { PaymentForm } from "@/app/(app)/invoices/[id]/PaymentForm";
import { addPayNow, customerSaysPaid, issueInvoice, markReadyToInvoice, recordPayment, roundInvoice, setPaymentLink, undoPaymentAction, verifyPaymentAction } from "@/app/(app)/invoices/actions";
import { RoundOff } from "@/components/RoundOff";
import { roundoffLimitsOf } from "@/lib/roundoff";
import { UndoButton } from "@/components/UndoButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { DEFAULT_UNDO_MINUTES } from "@/lib/money-undo";
import { ReadySendControl } from "../ReadySendControl";
import { DepositReceiptSend } from "@/components/DepositReceiptSend";
import { RecordDeposit } from "@/components/RecordDeposit";
import { DepositRequestSend } from "../DepositRequestSend";
import { depositState } from "@/lib/deposits";
import { STAGE_BOX_CLASS, STAGE_BOX_TITLE, type StageBoxState } from "@/lib/stage-style";
import { RecordPaymentButton } from "@/components/RecordPaymentHost";
import { UnallocatedList } from "@/components/UnallocatedList";
import { jobMoneyOf, unallocatedOf } from "@/lib/customer-money";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PaymentReportButton, PaymentReportLines, ReportMethodWords } from "@/components/PaymentReport";
import { loadReports } from "@/lib/payment-reports";
import { firstName, stillOwes } from "@/lib/payment-report-rules";
import { paymentReportsReady } from "@/lib/schema-ready";
import { reasonsFor } from "@/lib/reasons";
import { AuthCodeMissing } from "@/components/AuthCodeMissing";
import { authCodeMissing, realAuthCode } from "@/lib/auth-code";

export const dynamic = "force-dynamic";

/** Money on screen: two decimals and thousands separators. */
const m = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type LiveInvoice = MoneyInvoice & { id: string; total_aed: number; subtotal_aed: number; discount_aed: number; warranty_credit_aed: number | null; taxable_aed: number; vat_aed: number; issued_at: string; issue_reason: string | null };

/**
 * The money side of one job (rebuilt 21 October 2026, 1.3): a slim step bar (Deposit when asked ·
 * Proforma · Payment · Tax invoice · Gate-out, the stage colours, explanations behind the tooltip), the
 * money summary with the BALANCE DUE, one black "what to do now" action by stage and role, the payments
 * and receipts with proof thumbnails, and the documents. The invoice stays a straight copy of the
 * approved quotation. Only accounts and the owner record money; advisors see status and send links.
 */
export default async function BuildInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("viewInvoices");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [card, settings, site] = await Promise.all([loadJobCard(supabase, id), getSettings(), getSiteUrl()]);
  if (!card) notFound();
  const undoMinutes = Number((settings as unknown as Record<string, unknown>).money_undo_minutes) || DEFAULT_UNDO_MINUTES;
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
  // 5 November 2026 (J-00970): once a document is ISSUED, the Lines box shows ITS OWN lines and
  // totals - never the quotation draft's (a declined-all car has no approved quotation, and the
  // draft read "None · 0.00" while the tax invoice said 1,500.00).
  const { data: liveLineRows } = live ? await admin.from("invoice_lines").select(INVOICE_LINE_SELECT).eq("invoice_id", live.id).eq("is_active", true).order("position") : { data: [] };
  const liveLines = ((liveLineRows ?? []) as Record<string, unknown>[]).map(toInvoiceLine);
  const payments = ((livePays ?? []) as Record<string, unknown>[]).map(toPayment);
  // 3 November 2026: what credit notes took off the tax invoice is not owed (the same rule as the job card and the list).
  const liveCredit = taxInvoice ? ((await creditsOnDocs([taxInvoice.id])).get(taxInvoice.id) ?? 0) : 0;
  const bal = live ? invoiceBalance(live, payments, live === taxInvoice ? liveCredit : 0) : null;
  const allDeposits = ((deposits ?? []) as Record<string, unknown>[]).map(toPayment);
  const depositRows = allDeposits.filter((p) => p.status === "recorded");
  // The client keys already spent on this job (any status): a payment form still holding one starts a new key, so the
  // next payment is never taken for the one already recorded.
  const spentKeys = [...payments, ...allDeposits].map((p) => p.client_key).filter((k): k is string => !!k && !k.startsWith("ngenius:"));
  // The deposit receipt goes to the customer with the quotation's own link token and the message from Settings.
  const { data: approvedQ } = await createAdminClient().from("quotations").select("number, token").eq("job_id", id).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  const dep = await depositState(id);
  const quoteToken = approvedQ?.token ?? null;
  const depositMessage = (amount: number, link: string) =>
    String(settings.whatsapp_deposit_receipt_template ?? "")
      .replaceAll("[name]", greetingNameOf(card.customer))
      .replaceAll("[make model]", vehicleTitle(card.vehicle))
      .replaceAll("[plate]", formatPlate(card.vehicle))
      .replaceAll("[amount]", m(amount))
      .replaceAll("[link]", link);
  // The proforma, tax invoice and deposit receipt links go out short, made before the page renders.
  const proformaShort = proforma?.token ? await shortFor(`${PRODUCTION_SITE_URL}/proforma/${proforma.token}`) : null;
  const taxShort = taxInvoice?.token ? await shortFor(`${PRODUCTION_SITE_URL}/invoice/${taxInvoice.token}`) : null;
  const depositShorts = new Map<string, string>();
  for (const p of depositRows) depositShorts.set(p.id, await shortFor(`${PRODUCTION_SITE_URL}/api/pdf/receipt/${p.id}${quoteToken ? `?q=${quoteToken}` : ""}`));
  // The card slips and transfer proofs, signed for one hour.
  const proofUrls = await signJobFiles([...payments, ...depositRows].map((p) => p.proof_path).filter((x): x is string => !!x));
  const creditDays = Number(creditCust?.credit_terms_days) || 0;
  // 2 November 2026, section 3: payments advisors took and sent to accounts (they record them or query them back).
  const reportsOn = await paymentReportsReady();
  const jobReports = reportsOn ? await loadReports({ jobId: id, settings }) : [];
  const waitingReport = jobReports.find((r) => r.status === "waiting") ?? null;
  // THE job money (3 November 2026): before the proforma "Paid so far · Balance" is the approved total less every cleared
  // payment on the job (deposit documents included, a cheque only once cleared) - the same figures as the job card.
  const jobMoney = await jobMoneyOf(id, settings);
  // "Cheque" or "Transfer": what waits for the bank on this job (9 November 2026).
  const waitingNow = [...payments, ...depositRows].filter((p) => p.status === "recorded" && awaitsBank(p));
  const pendingWord = waitingNow.length && waitingNow.every((p) => p.method === "transfer") ? "Transfer" : "Cheque";
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
    pendingWord,
    needsInvoice: draft.lines.length > 0,
    creditDays,
    declinedOut: !!stepJob?.declined_out_at,
    waitingHours: Number(settings.payment_waiting_hours) || 24,
    reported: waitingReport ? { by: firstName(waitingReport.reporter) } : null,
    advance: !live && jobMoney ? { paid: jobMoney.paid, left: jobMoney.balance } : null,
  });
  const links = live ? await paymentLinksOf(live.id) : [];
  const payLink = currentPaymentLink(links);
  const nextTax = proforma && !taxInvoice ? await nextDocumentNumber("tax_invoice", settings) : null;
  // Section 12: deposits (no invoice yet) are people's work too - without them in this lookup a cash
  // deposit used to fall back to a provider name on screen.
  const everyPayment = [...payments, ...depositRows];
  // 9 November 2026: a cheque or transfer already waiting for the bank that covers the balance asks why another payment.
  const bankWaiting = everyPayment.filter((p) => p.status === "recorded" && awaitsBank(p)).map((p) => ({ method: p.method, number: p.number, amount: p.amount_aed }));
  // The cheques and transfers of this job still waiting for the bank, with their buttons (owner and accounts).
  const bankRows = bankWaiting.length ? await loadBankWaiting({ jobIds: [id] }) : [];
  const bankProofs = await signJobFiles(bankRows.map((r) => r.proofPath).filter((x): x is string => !!x));
  const todayDubai = dubaiToday();
  const bankReady = await bankPostingReady();
  // The money waiting for the bank covers what is due: the one step is clearing it (never recording it again).
  const bankCovers = bankWaiting.length > 0 && !!bal && bankWaiting.reduce((x, p) => x + p.amount, 0) + 0.005 >= bal.balance;
  const bankLine = pendingLine({ paid: bal?.paid ?? 0, pending: bankWaiting, balance: bal?.balance ?? null });
  const pendingBank = duplicateWords(bankWaiting, bal?.balance ?? null);
  const { data: people } = everyPayment.length ? await admin.from("staff").select("id, display_name, role_id").in("id", Array.from(new Set(everyPayment.flatMap((p) => [p.received_by, p.verified_by]).filter((x): x is string => !!x)))) : { data: [] };
  const personOf = new Map((people ?? []).map((p) => [p.id, p]));
  const acting = !staff.viewingAs && job.is_open;
  const canRecord = can(role, "recordPayments") && acting;
  const canSend = can(role, "sendApproval") && acting;
  const canVerify = can(role, "verifyPayments") && acting;
  // 1 November 2026: recording is ALWAYS possible for accounts and the owner - before the proforma, and after the car left.
  const mayPay = can(role, "recordPayments") && !staff.viewingAs;
  // The owner in View as sees the Record payment buttons greyed ("View as is read-only").
  const viewPay = can(role, "recordPayments") && !!staff.viewingAs;
  const mayReport = role === "service_advisor" && !staff.viewingAs && reportsOn;
  // THE rule for the advisor's button, the same as the job card's: something is owed (open or gone alike).
  const reportMoney = mayReport ? jobMoney : null;
  const reportBalance = reportMoney?.balance ?? null;
  const reportOwes = stillOwes(reportMoney);
  // A report waits: every other Record button on this page names itself "a different payment" (the report has its own).
  const otherPay = waitingReport ? "Record a different payment" : null;
  const credit = mayPay ? await unallocatedOf({ customerId: job.customer_id }) : [];
  const phoneDigits = (customer?.phone ?? "").replace(/[^\d]/g, "");
  const customerName = customer?.company_name ?? customer?.full_name ?? "Customer";
  const fillCar = (t: string) => t.replaceAll("[make model]", [vehicle.make?.name, vehicle.model?.name].filter(Boolean).join(" ")).replaceAll("[plate]", formatPlate(vehicle)).replaceAll("[advisor]", staff.display_name).replaceAll("[name]", greetingNameOf(customer)).replaceAll("[bank]", "");
  const readyTemplate = fillCar(settings.whatsapp_ready_template);
  const invoiceTemplate = fillCar(String(settings.whatsapp_invoice_template ?? ""));
  const bankCharges = bankFeesOf(settings);
  const shownLines = live ? liveLines : draft.lines;
  const services = shownLines.filter((l) => l.section !== "parts");
  const parts = shownLines.filter((l) => l.section === "parts");
  const liveRounding = live ? Math.round((live.taxable_aed - (live.subtotal_aed - live.discount_aed - (live.warranty_credit_aed || 0))) * 100) / 100 : 0;
  const here = `/jobs/${id}/invoice`;
  const unpaid = !!live && (bal?.balance ?? 0) > 0.005;
  const payNowOn = !!payLink && !payLink.paid_at && unpaid;

  const stateOf = (k: MoneyStepKey): "done" | "current" | "later" => (money.done.includes(k) ? "done" : money.current === k ? "current" : "later");
  const chipTone = money.chip.tone === "ink" ? "ink" : money.chip.tone;
  const gateReady = money.action === "gate_out";

  // The slim step bar: Deposit (only when asked) → Proforma → Payment → Tax invoice → Gate-out, the
  // stage colours, the old explanation sentences behind the tooltip. While a deposit is short and no
  // proforma exists, the deposit is the one amber box and the rest wait.
  const depRequested = dep.required > 0;
  const depShort = depRequested && dep.short;
  const demote = depShort && !live;
  const barState = (k: MoneyStepKey): StageBoxState => (demote ? "later" : stateOf(k));
  const barSteps: { key: string; label: string; state: StageBoxState; info: string }[] = [
    ...(depRequested ? [{ key: "deposit", label: "Deposit", state: (!dep.short ? "done" : "current") as StageBoxState, info: `Asked on ${dep.quotationNumbers.join(", ")}: AED ${m(dep.required)}; AED ${m(dep.received)} received. Only accounts or the owner record it; Parts wait for it (the owner can approve the LPO without it).` }] : []),
    { key: "proforma_sent", label: "Proforma", state: barState("proforma_sent"), info: "Prepared by itself when the car is Ready; the advisor sends it with the expected payment method. Money can be recorded before it is sent (a customer at the counter)." },
    { key: "payment", label: "Payment", state: barState("payment"), info: "Only accounts or the owner record money. Card and transfer payments need their proof photo; more than the balance goes to the owner for approval." },
    { key: "tax_invoice", label: "Tax invoice", state: barState("tax_invoice"), info: `Created by itself the moment the proforma is paid in full${nextTax ? ` (it will be ${nextTax})` : ""}. A tax invoice is never cancelled or deleted; corrections are by credit note, approved by the owner.` },
    { key: "released", label: "Gate-out", state: barState("released"), info: "After full payment, or on the customer's credit terms. The advisor or accounts gate the car out." },
  ];

  const totalDue = live ? live.total_aed : draft.totals.total;
  const paidSoFar = live ? (bal?.paid ?? 0) : (jobMoney?.paid ?? 0);
  const balanceDue = live ? (bal?.balance ?? 0) : (jobMoney?.balance ?? 0);
  const chequeClearing = live ? (bal?.pendingAmount ?? 0) : (jobMoney?.pendingCheque ?? 0);
  const atMoneyStage = !!live || ["ready", "pending_payment", "in_delivery"].includes(job.status);
  const balTone = balanceDue <= 0.005 && paidSoFar > 0 ? "text-green-text" : balanceDue > 0.005 && atMoneyStage ? "text-red" : "";
  const outstandingDeposit = Math.max(0, Math.round((dep.required - dep.received) * 100) / 100);
  const depositPanel = { jobId: id, plate: formatPlate(vehicle), car: vehicleTitle(vehicle), customer: customerName, quote: dep.quotationNumbers.join(", "), requested: dep.required, received: dep.received, outstanding: outstandingDeposit };
  const depositRequestMessage = String(settings.whatsapp_deposit_request_template ?? "")
    .replaceAll("[name]", greetingNameOf(customer))
    .replaceAll("[make model]", vehicleTitle(vehicle))
    .replaceAll("[plate]", formatPlate(vehicle))
    .replaceAll("[amount]", outstandingDeposit.toLocaleString("en-GB", { minimumFractionDigits: 2 }))
    .replaceAll("[quotation]", dep.quotationNumbers.join(", "));

  const paymentLine = (p: PaymentRow, isDeposit: boolean) => {
    const by = p.received_by ? personOf.get(p.received_by) : null;
    const counter = !!by && by.role_id !== "owner" && by.role_id !== "accounts";
    const struck = p.status === "voided" || p.status === "reversed";
    const needsBank = p.status === "recorded" && !p.verified_at && (counter || p.method === "cash");
    return (
      <li key={p.id} className={`py-2 flex flex-wrap items-center gap-3 text-sm ${struck ? "text-muted line-through" : ""}`} data-payment-row={p.number} {...(isDeposit ? { "data-deposit-row": p.number } : {})}>
        <span className="font-semibold">{p.number}</span>
        <span className="text-muted">{formatDayTime(p.received_at)}</span>
        <Badge tone={p.status === "pending_owner" ? "amber" : awaitsBank(p) ? "amber" : struck ? "red" : "neutral"}>{METHOD_LABELS[p.method]}{p.method === "cheque" && p.cheque_status ? ` · ${p.cheque_status}` : ""}{isDeposit ? " · deposit" : ""}</Badge>
        {/* 3 November 2026: a card or link payment with no real auth code is flagged; owner and accounts add it here. */}
        {!struck && authCodeMissing(p) ? <AuthCodeMissing paymentId={p.id} number={p.number} method={p.method} code={p.auth_code ?? null} canAdd={mayPay} /> : realAuthCode(p.auth_code) ? <span className="text-xs text-muted" data-auth-shown>Auth {realAuthCode(p.auth_code)}</span> : p.reference ? <span className="text-xs text-muted">{p.reference}</span> : null}
        {/* Only the actual method ever shows; a payment with no recorder came through Pay now. */}
        {by?.display_name ? <span className="text-xs text-muted" data-paid-by>by {by.display_name}</span> : p.client_key?.startsWith("ngenius:") ? <span className="text-xs text-muted" data-paid-by>paid online (Pay now)</span> : null}
        <span className="ml-auto font-semibold">AED {m(p.amount_aed)}</span>
        {needsBank ? <Badge tone="amber">{p.method === "cash" ? "Cash: to confirm & bank" : "Recorded by advisor, to confirm"}</Badge> : null}
        {needsBank && canVerify ? <form action={verifyPaymentAction.bind(null, p.id)}><input type="hidden" name="return_to" value={here} /><Button type="submit" size="md" tone="secondary" {...(isDeposit ? { "data-confirm-deposit": "" } : { "data-confirm-counter": "" })}>Confirmed &amp; banked</Button></form> : null}
        {p.status === "pending_owner" ? <Badge tone="amber">Waiting for the owner</Badge> : null}
        {p.status === "recorded" && !staff.viewingAs && (role === "owner" || p.received_by === staff.id) && p.created_at ? <UndoButton at={p.created_at} minutes={undoMinutes} done="Payment recorded" action={undoPaymentAction.bind(null, p.id, here)} /> : null}
        {p.status === "recorded" ? <a href={`/api/pdf/receipt/${p.id}`} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Receipt</a> : null}
        {p.proof_path && proofUrls[p.proof_path] ? (
          // 9 November 2026: a proof that is a PDF (a cheque scan) shows as a PDF tile that opens it, never a broken picture.
          <span className="inline-flex" data-proof-link><SlipTile url={proofUrls[p.proof_path] ?? null} path={p.proof_path} label={p.method === "card" ? "Card slip" : p.method === "cheque" ? "Cheque" : "Proof"} hook={p.number} size="h-12 w-12" /></span>
        ) : null}
        {isDeposit && p.status === "recorded" ? <DepositReceiptSend number={p.number} message={depositMessage(p.amount_aed, depositShorts.get(p.id) ?? `${site}/api/pdf/receipt/${p.id}`)} phoneDigits={phoneDigits} pdfHref={`/api/pdf/receipt/${p.id}`} fileName={`OFJ Receipt ${p.number}.pdf`} jobId={id} /> : null}
      </li>
    );
  };

  return (
    <>
      <LiveRefresh tables={["payments", "invoices", "jobs", ...(reportsOn ? ["payment_reports"] : [])]} jobId={id} />
      <BankAnswerHost />
      <PageHeader
        picture={<CarHeaderThumb vehicleId={job.vehicle_id} />}
        title={`Invoice · ${formatPlate(vehicle)}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span>{vehicleTitle(vehicle)} · {job.job_number} · {STATUS_LABELS[job.status]} · {customerName}</span><VinCopy vin={vehicle.vin} /><Badge tone={chipTone}>{money.chip.text}</Badge>{money.waitingHours ? <Badge tone="red">Waiting {money.waitingHours} h</Badge> : null}</span>}
        actions={<><LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton>{live && can(role, "viewInvoices") ? <LinkButton href={`/invoices/${live.id}`} tone="secondary" size="lg">Full record</LinkButton> : null}</>}
      />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {draft.lines.length === 0 && !live ? <Notice tone="error">No approved quotation on this job and no inspection fee due. Nothing to invoice.</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-3" data-money-steps>
          <Card className="flex flex-col gap-2" data-money-bar>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${barSteps.length}, minmax(0, 1fr))` }}>
              {barSteps.map((b) => (
                <div key={b.key} data-step={b.key} data-state={b.state} title={b.info} className={`min-h-11 rounded-control px-1 py-1 flex items-center justify-center gap-1 text-center text-xs leading-tight ${STAGE_BOX_CLASS[b.state]} ${STAGE_BOX_TITLE[b.state]} ${b.state === "current" ? "font-bold" : "font-semibold"}`}>
                  <span>{b.state === "done" ? "✓ " : ""}{b.label}</span>
                  <span aria-hidden className="opacity-50">ⓘ</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex flex-col gap-2" data-money-summary>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-money-figures>
              <div className="flex flex-col"><span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Total incl. VAT</span><span className="text-xl sm:text-2xl font-extrabold">AED {m(totalDue)}</span></div>
              {depRequested ? (
                <div className="flex flex-col"><span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Deposit</span><span className="text-xl sm:text-2xl font-extrabold">AED {m(dep.received)}<span className="text-sm font-semibold text-muted"> of {m(dep.required)}</span></span></div>
              ) : null}
              <div className="flex flex-col"><span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Paid so far</span><span className="text-xl sm:text-2xl font-extrabold">AED {m(paidSoFar)}</span></div>
              <div className="flex flex-col"><span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Balance due</span><span className={`text-xl sm:text-2xl font-extrabold ${balTone}`} data-balance>{live && !unpaid ? "Paid in full" : `AED ${m(balanceDue)}`}</span></div>
            </div>
            {bankLine ? <p className="text-sm font-semibold text-amber-text" data-bank-pending-line>{bankLine}</p> : chequeClearing ? <p className="text-sm font-semibold text-amber-text">Cheque of AED {m(chequeClearing)} pending clearance.</p> : null}
            {bal?.credited ? <p className="text-sm font-semibold text-muted" data-credit-note-off>Credit notes AED {m(bal.credited)} taken off the balance.</p> : null}
            {proforma && !taxInvoice && acting && ["owner", "accounts", "service_advisor"].includes(role) ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2" data-invoice-roundoff>
                <RoundOff docWords="proforma" baseTotal={draft.totals.total} baseNet={draft.totals.taxable} rounding={Math.round(((proforma as unknown as { taxable_aed: number }).taxable_aed - draft.totals.taxable) * 100) / 100} appliedTotal={proforma.total_aed} vatPercent={draft.vatPercent} isOwner={role === "owner"} limits={roundoffLimitsOf(settings)} approvedCap={draft.quotationNumbers.length ? draft.totals.total : null} refuseOverLimit apply={roundInvoice.bind(null, proforma.id)} />
                <span className="text-xs text-muted">Adjusts the amount before VAT; VAT stays exactly {draft.vatPercent}%. The tax invoice is born from these figures.</span>
              </div>
            ) : null}
            {live && !unpaid ? <p className="text-sm font-bold text-green-text">Paid in full{bal?.paidAt ? ` · ${formatDayTime(bal.paidAt)}` : ""}{taxInvoice && !taxInvoice.sent_at ? " · gate-out opens after the tax invoice is sent." : ""}</p> : null}
            {taxInvoice && unpaid ? <p className="text-sm font-semibold text-amber-text">Tax invoice issued before full payment{taxInvoice.issue_reason ? `: ${taxInvoice.issue_reason}` : ""}. The balance is still due.</p> : null}
          </Card>

          <Card id="bank" className="flex flex-col gap-2 border-ink" data-what-now>
            <SectionLabel>What to do now</SectionLabel>
            {waitingReport && (mayPay || viewPay) ? (
              <div className="flex flex-wrap items-center gap-2 rounded-control border-2 border-amber-bar bg-amber-soft p-3" data-what-now-report>
                <span className="min-w-[12rem] flex-1 text-sm font-semibold">Payment reported by {firstName(waitingReport.reporter)} · AED {m(waitingReport.amount)} · <ReportMethodWords r={waitingReport} /> – record it.</span>
                <RecordPaymentButton jobId={id} reportId={waitingReport.id} readOnly={viewPay} size="md" label="Record it" />
              </div>
            ) : null}
            {(() => {
              if (!job.is_open) {
                return live && unpaid && (mayPay || viewPay) ? (
                  <div className="flex flex-col gap-2" data-late-record>
                    <p className="text-sm font-semibold">The car has left with AED {m(bal?.balance ?? 0)} still due on {live.number}. Record the payment when it arrives.</p>
                    <div><RecordPaymentButton jobId={id} readOnly={viewPay} size="lg" label={otherPay ?? "Record payment"} /></div>
                  </div>
                ) : <p className="text-sm text-muted">The car has left. Nothing to do here.</p>;
              }
              if (depShort && !live) {
                return (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold">Deposit of AED {m(outstandingDeposit)} to receive ({dep.quotationNumbers.join(", ")}).</p>
                    {canRecord ? <div><RecordDeposit d={depositPanel} charges={bankCharges} /></div> : null}
                    {canSend && !canRecord ? <div className="flex flex-col gap-1"><DepositRequestSend jobId={id} message={depositRequestMessage} phoneDigits={phoneDigits} requestedAt={(job as { deposit_requested_at?: string | null }).deposit_requested_at ?? null} /><span className="text-xs text-muted">Only accounts or the owner record the money.</span></div> : null}
                    {!canRecord && !canSend ? (viewPay ? <div><RecordPaymentButton jobId={id} readOnly size="md" label="Record the deposit" /></div> : <p className="text-sm text-muted">Waiting for the deposit: accounts record it when it arrives.</p>) : null}
                  </div>
                );
              }
              if (!live && money.action === "prepare_proforma" && can(role, "markReadyToInvoice") && acting) {
                return <form action={markReadyToInvoice.bind(null, id)}><Button type="submit" size="lg" className="w-full sm:w-auto">Prepare the proforma</Button></form>;
              }
              if (live && unpaid && bankCovers) {
                return (
                  <div className="flex flex-col gap-2" data-what-now-bank>
                    <p className="text-sm font-semibold" data-bank-wait-words>{bankWaitWords(pendingWord)}</p>
                    {proforma && !proforma.sent_at && canSend ? <ReadySendControl jobId={id} size="md" token={proforma.token} shortLink={proformaShort} kind="proforma" siteUrl={site} messageTemplate={readyTemplate} phoneDigits={phoneDigits} sentAt={proforma.sent_at} expectedMethod={proforma.expected_payment_method ?? null} payNowAvailable={ngeniusConfigured()} payNowOn={payNowOn} charges={bankCharges} pdf={proforma.token ? { href: `/api/pdf/invoice/${proforma.token}`, fileName: `OFJ Proforma ${proforma.number}.pdf` } : null} /> : null}
                    {canRecord ? <ul className="divide-y divide-line">{bankRows.map((r) => <BankRow key={r.id} row={r} today={todayDubai} canSave={acting} ready={bankReady} proofUrl={r.proofPath ? (bankProofs[r.proofPath] ?? null) : null} />)}</ul> : <p className="text-xs text-muted">Accounts mark it cleared when it is on the bank statement; the payment counts then.</p>}
                    {canRecord ? (
                      <details className="border-t border-line pt-2" data-record-block data-folded>
                        <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold text-muted">Record a different payment</summary>
                        <div className="pt-2"><PaymentForm invoiceId={live!.id} jobId={null} proofJobId={id} spentKeys={spentKeys} balance={bal!.balance} action={recordPayment} returnTo={here} charges={bankCharges} methods={methodsFor(role)} expected={proforma?.expected_payment_method ?? null} invoiceNumber={live!.number} isProforma={live!.kind === "proforma"} nextTaxNumber={nextTax} isOwner={role === "owner"} pendingBank={pendingBank} /></div>
                      </details>
                    ) : null}
                  </div>
                );
              }
              if (proforma && unpaid && !proforma.sent_at) {
                return (
                  <div className="flex flex-col gap-2">
                    {canSend ? <ReadySendControl jobId={id} size="lg" token={proforma.token} shortLink={proformaShort} kind="proforma" siteUrl={site} messageTemplate={readyTemplate} phoneDigits={phoneDigits} sentAt={proforma.sent_at} expectedMethod={proforma.expected_payment_method ?? null} payNowAvailable={ngeniusConfigured()} payNowOn={payNowOn} charges={bankCharges} pdf={proforma.token ? { href: `/api/pdf/invoice/${proforma.token}`, fileName: `OFJ Proforma ${proforma.number}.pdf` } : null} /> : <p className="text-sm text-muted">The advisor sends {proforma.number} to the customer.</p>}
                    {canRecord ? (
                      <details className="border-t border-line pt-2" data-record-block data-folded>
                        <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold text-muted">{otherPay ? `${otherPay} (not the one ${firstName(waitingReport?.reporter)} reported)` : "Record a payment before the proforma is sent"}</summary>
                        <div className="pt-2"><PaymentForm invoiceId={live!.id} jobId={null} proofJobId={id} spentKeys={spentKeys} balance={bal!.balance} action={recordPayment} returnTo={here} charges={bankCharges} methods={methodsFor(role)} expected={proforma?.expected_payment_method ?? null} invoiceNumber={live!.number} isProforma={live!.kind === "proforma"} nextTaxNumber={nextTax} isOwner={role === "owner"} pendingBank={pendingBank} /></div>
                      </details>
                    ) : viewPay ? <div><RecordPaymentButton jobId={id} readOnly size="md" label="Record a payment" /></div> : null}
                  </div>
                );
              }
              if (live && unpaid && canRecord) {
                const form = <PaymentForm invoiceId={live!.id} jobId={null} proofJobId={id} spentKeys={spentKeys} balance={bal!.balance} action={recordPayment} returnTo={here} charges={bankCharges} methods={methodsFor(role)} expected={proforma?.expected_payment_method ?? null} invoiceNumber={live!.number} isProforma={live!.kind === "proforma"} nextTaxNumber={nextTax} isOwner={role === "owner"} pendingBank={pendingBank} />;
                // A payment an advisor sent waits: "Record it" above opens it with his slip; this form is for a DIFFERENT
                // payment, folded so the reported one is never recorded twice by mistake.
                if (waitingReport) {
                  return (
                    <details className="border-t border-line pt-2" data-record-block data-folded>
                      <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold text-muted">{otherPay} (not the one {firstName(waitingReport.reporter)} reported)</summary>
                      <div className="pt-2 flex flex-col gap-2">
                        {creditDays ? <p className="text-sm font-semibold">Credit terms: {creditDays} days. The car may leave; record the payment here when it arrives.</p> : null}
                        {form}
                      </div>
                    </details>
                  );
                }
                return (
                  <div className="flex flex-col gap-2" data-record-block>
                    {creditDays ? <p className="text-sm font-semibold">Credit terms: {creditDays} days. The car may leave; record the payment here when it arrives.</p> : <p className="text-sm font-semibold">Record the payment against {live!.number}.</p>}
                    {form}
                    {creditDays && can(role, "gateOut") && acting ? <div><LinkButton href={`/jobs/${id}/gate-out`} size="md" tone="secondary">Gate out on credit</LinkButton></div> : null}
                  </div>
                );
              }
              if (live && unpaid) {
                // The owner in View as accounts sees the button accounts have, greyed - never "Waiting for accounts".
                if (viewPay && !waitingReport) return <div className="flex flex-col gap-2"><p className="text-sm font-semibold">Record the payment against {live.number}.</p><div><RecordPaymentButton jobId={id} readOnly size="lg" label="Record payment" /></div></div>;
                if (viewPay) return null;
                return (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted" data-waiting-accounts>{proforma?.sent_at ? `Proforma sent ${formatDayTime(proforma.sent_at)} · ` : ""}{proforma?.expected_payment_method ? `Expected: ${PAYMENT_METHOD_LABELS[proforma.expected_payment_method] ?? proforma.expected_payment_method} · ` : ""}Waiting for accounts to record the payment.</p>
                    {canSend && proforma ? <ReadySendControl jobId={id} size="md" token={proforma.token} shortLink={proformaShort} kind="proforma" siteUrl={site} messageTemplate={readyTemplate} phoneDigits={phoneDigits} sentAt={proforma.sent_at} expectedMethod={proforma.expected_payment_method ?? null} payNowAvailable={ngeniusConfigured()} payNowOn={payNowOn} charges={bankCharges} pdf={proforma.token ? { href: `/api/pdf/invoice/${proforma.token}`, fileName: `OFJ Proforma ${proforma.number}.pdf` } : null} /> : null}
                  </div>
                );
              }
              if (taxInvoice && !unpaid && !taxInvoice.sent_at) {
                return (
                  <div className="flex flex-col gap-2">
                    {canSend ? <ReadySendControl jobId={id} size="lg" token={taxInvoice.token} shortLink={taxShort} kind="tax_invoice" siteUrl={site} messageTemplate={invoiceTemplate} phoneDigits={phoneDigits} sentAt={taxInvoice.sent_at} pdf={taxInvoice.token ? { href: `/api/pdf/invoice/${taxInvoice.token}`, fileName: `OFJ Tax invoice ${taxInvoice.number}.pdf` } : null} /> : <p className="text-sm text-muted">The advisor sends {taxInvoice.number} to the customer.</p>}
                    <p className="text-xs text-muted">After the tax invoice is sent, the car is gated out.</p>
                  </div>
                );
              }
              if (gateReady) {
                return can(role, "gateOut") && acting ? <LinkButton href={`/jobs/${id}/gate-out`} size="lg" className="w-full sm:w-auto">Gate out</LinkButton> : <p className="text-sm">Ready: the advisor or accounts gate the car out.</p>;
              }
              return canRecord ? (
                <div className="flex flex-col gap-2" data-advance-record>
                  <p className="text-sm font-semibold">No proforma yet{draft.lines.length ? ` · balance AED ${m(balanceDue)}` : ""}. A payment now is recorded as an advance (no VAT) with its own receipt, and comes off the invoice by itself.</p>
                  <div><RecordPaymentButton jobId={id} size={otherPay ? "md" : "lg"} tone={otherPay ? "secondary" : "primary"} label={otherPay ?? "Record a payment"} /></div>
                </div>
              ) : viewPay ? (
                <div><RecordPaymentButton jobId={id} readOnly size="lg" label={otherPay ?? "Record a payment"} /></div>
              ) : <p className="text-sm text-muted">Nothing to do yet – the proforma is created by itself when the car is Ready.</p>;
            })()}
            {proforma && !taxInvoice && role === "owner" && acting ? (
              <details className="text-xs" data-issue-early>
                <summary className="cursor-pointer min-h-11 flex items-center font-semibold text-muted underline underline-offset-4">Issue the tax invoice early (owner only, with a reason)</summary>
                <form action={issueInvoice.bind(null, id)} className="mt-2 flex flex-col gap-2 max-w-md">
                  <Textarea name="reason" rows={2} required placeholder="Reason for issuing before full payment (accounts are told)" />
                  <div>
                    <ConfirmSubmit
                      label="Issue the tax invoice now"
                      tone="secondary"
                      size="md"
                      title="Issue the tax invoice before full payment?"
                      lines={[`The tax invoice for ${job.job_number} is numbered now, in place of the proforma`, `balance still to pay AED ${m(bal?.balance ?? 0)}`, "accounts are told and it goes to Zoho Books"]}
                      live={[{ label: "Reason:", field: "reason" }]}
                      confirmLabel="Yes, issue the tax invoice"
                      hook="issue-tax"
                    />
                  </div>
                </form>
              </details>
            ) : null}
          </Card>

          {credit.length ? (
            <Card className="flex flex-col gap-2 border-amber-bar" data-credit-offer>
              <SectionLabel right={`AED ${m(credit.filter((p) => p.status === "recorded").reduce((a, p) => a + p.amount_aed, 0))}`}>Customer credit, not allocated</SectionLabel>
              <p className="text-xs text-muted">Money this customer paid earlier that is not on any job yet. Allocate it here and it comes off {live ? <span className="whitespace-nowrap">{live.number}</span> : "this job’s invoice"} by itself.</p>
              <UnallocatedList rows={credit} canAllocate={mayPay} target={{ key: live ? `inv:${live.id}` : `job:${id}`, title: job.job_number, balance: live ? (bal?.balance ?? 0) : draft.lines.length ? balanceDue : null }} />
            </Card>
          ) : null}
          <Card className="flex flex-col gap-2" data-payments-card>
            <SectionLabel right={`${depositRows.length + payments.length}`}>Payments &amp; receipts</SectionLabel>
            {depositRows.length + payments.length === 0 ? <p className="text-sm text-muted">No money received yet.</p> : (
              <ul className="divide-y divide-line">
                {depositRows.map((p) => paymentLine(p, true))}
                {payments.map((p) => paymentLine(p, false))}
              </ul>
            )}
            {jobReports.length || proforma?.customer_says_paid_at || (mayReport && reportOwes) ? (
              <div className="flex flex-col gap-2 border-t border-line pt-3" data-says-paid-section>
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Customer says paid</span>
                <PaymentReportLines reports={jobReports} viewerId={staff.id} canRecord={can(role, "recordPayments")} canReport={role === "service_advisor" || role === "owner"} readOnly={!!staff.viewingAs} balance={reportBalance} expected={proforma?.expected_payment_method ?? null} isOwner={role === "owner"} reasons={reasonsFor(settings, "payment_query")} />
                {mayReport && reportOwes ? (
                  <div className="flex flex-col gap-1">
                    <div><PaymentReportButton jobId={id} balance={reportBalance} expected={proforma?.expected_payment_method ?? null} /></div>
                    <span className="text-xs text-muted">Took the money at the counter? Send it to accounts with the photo of the slip, receipt or transfer; they record it and you are told.</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {proforma?.customer_says_paid_at ? <p className="text-xs text-muted">Customer said paid {formatDateTime(proforma.customer_says_paid_at)}{proforma.customer_says_paid_method ? ` by ${PAYMENT_METHOD_LABELS[proforma.customer_says_paid_method] ?? proforma.customer_says_paid_method}` : ""}. Accounts check the bank and record it.</p> : null}
            {!reportsOn && live && unpaid && acting && !proforma?.customer_says_paid_at && (role === "service_advisor" || role === "owner") ? (
              <form action={customerSaysPaid.bind(null, live.id)} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <input type="hidden" name="return_to" value={here} />
                <input type="hidden" name="method" value={proforma?.expected_payment_method ?? ""} />
                <Input name="note" placeholder="Note (optional): reference, time, bank" className="max-w-xs" />
                <Button type="submit" size="md" tone="secondary" data-customer-says-paid>Customer says paid</Button>
                <span className="text-xs text-muted">Accounts are asked to check the bank. Nothing is released by it.</span>
              </form>
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
                  {proforma?.sent_at && !payNowOn && ngeniusConfigured() && canSend ? <form action={addPayNow.bind(null, proforma.id)}><input type="hidden" name="return_to" value={here} /><Button type="submit" size="md" tone="secondary" data-add-pay-now>Add Pay now and resend</Button></form> : null}
                </div>
              </details>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-1" data-documents>
            <SectionLabel>Documents</SectionLabel>
            {approvedQ?.token ? <p className="text-sm flex flex-wrap items-center gap-2"><a href={`/api/pdf/quote/${approvedQ.token}`} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">Quotation {approvedQ.number}</a><span className="text-xs text-muted">approved · PDF</span></p> : null}
            {invoices.map((i) => <p key={i.id} className="text-sm flex flex-wrap items-center gap-2"><LinkButton href={`/invoices/${i.id}`} tone="secondary" size="md">{i.number}</LinkButton>{i.token ? <a href={`/api/pdf/invoice/${i.token}`} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">PDF</a> : null}<span className="text-xs text-muted">{i.kind === "tax_invoice" ? "Tax invoice" : i.kind === "proforma" ? (i.converted_to ? "Proforma, became the tax invoice" : i.deposit_for_quotation_id ? "Deposit proforma" : "Proforma") : "Credit note"} · {formatDayTime(i.issued_at)}</span>{i.status === "cancelled" ? <Badge tone="red">Cancelled</Badge> : null}</p>)}
            {[...depositRows, ...payments].filter((p) => p.status === "recorded").map((p) => <p key={p.id} className="text-sm flex flex-wrap items-center gap-2"><a href={`/api/pdf/receipt/${p.id}`} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">Receipt {p.number}</a><span className="text-xs text-muted">AED {m(p.amount_aed)}</span></p>)}
            {!approvedQ?.token && invoices.length === 0 && depositRows.length + payments.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : null}
          </Card>
          <Card className="flex flex-col gap-2" data-lines-source={live ? "invoice" : "draft"}>
            <SectionLabel right={live ? `${live.number}'s own lines` : draft.quotationNumbers.length ? `a copy of ${draft.quotationNumbers.join(", ")}` : undefined}>Lines</SectionLabel>
            <p className="text-xs text-muted">{live ? `Exactly what is on ${live.number} - these lines and totals ARE the document's.` : "Exactly what the customer approved: the same lines, discount and total. Nothing to choose or type here. A change needs a revised quotation or the owner."}</p>
            {[{ title: "Services", ls: services }, { title: "Spare parts", ls: parts }].map(({ title, ls }) => (
              <div key={title} className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{title}</span>
                {ls.length === 0 ? <p className="text-sm text-muted">None</p> : null}
                <ul className="divide-y divide-line text-sm">
                  {ls.map((l, i) => (
                    <li key={i} className="py-1.5 flex flex-wrap items-center gap-3">
                      <span className="flex-1 min-w-40 font-semibold uppercase">{l.description}{l.section === "fees" ? <Badge tone="red">Fee</Badge> : null}<PositionsLine positions={l.positions} />{(l.hours === null ? l.details : detailsWithoutHours(l.details)) ? <span className="block whitespace-pre-line text-xs font-normal normal-case text-muted">{l.hours === null ? l.details : detailsWithoutHours(l.details)}</span> : null}</span>
                      <span className="text-muted w-16 text-right">{l.hours !== null ? hoursQty(l.hours) : `× ${l.quantity}`}</span>
                      <span className="w-24 text-right font-semibold">{l.amount_aed === 0 ? "Free" : `AED ${m(l.amount_aed)}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {live ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm border-t border-line pt-2" data-lines-total={m(live.total_aed)}>
                <dt className="text-muted">Gross amount</dt><dd className="text-right">AED {m(live.subtotal_aed)}</dd>
                {live.discount_aed ? <><dt className="font-bold">Discount</dt><dd className="text-right font-bold">− AED {m(live.discount_aed)}</dd></> : null}
                {live.warranty_credit_aed ? <><dt className="font-bold">Warranty repair, no charge</dt><dd className="text-right font-bold">− AED {m(live.warranty_credit_aed)}</dd></> : null}
                {liveRounding ? <><dt className="text-muted">Rounding</dt><dd className="text-right">{liveRounding < 0 ? "− " : ""}AED {m(Math.abs(liveRounding))}</dd></> : null}
                <dt className="text-muted">Taxable amount</dt><dd className="text-right">AED {m(live.taxable_aed)}</dd>
                <dt className="text-muted">VAT</dt><dd className="text-right">AED {m(live.vat_aed)}</dd>
                <dt className="text-lg font-extrabold">Total</dt><dd className="text-right text-lg font-extrabold">AED {m(live.total_aed)}</dd>
              </dl>
            ) : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm border-t border-line pt-2" data-lines-total={m(draft.totals.total)}>
                <dt className="text-muted">Gross amount</dt><dd className="text-right">AED {m(draft.totals.gross)}</dd>
                {draft.totals.discount ? <><dt className="font-bold">Discount ({draft.totals.discountPercent}%), as quoted</dt><dd className="text-right font-bold">− AED {m(draft.totals.discount)}</dd></> : null}
                {draft.totals.warrantyCredit ? <><dt className="font-bold">Warranty repair, no charge</dt><dd className="text-right font-bold">− AED {m(draft.totals.warrantyCredit)}</dd></> : null}
                {draft.totals.rounding ? <><dt className="text-muted">Rounding, as quoted</dt><dd className="text-right">{draft.totals.rounding < 0 ? "− " : ""}AED {m(Math.abs(draft.totals.rounding))}</dd></> : null}
                <dt className="text-muted">Taxable amount</dt><dd className="text-right">AED {m(draft.totals.taxable)}</dd>
                <dt className="text-muted">VAT {draft.vatPercent}%</dt><dd className="text-right">AED {m(draft.totals.vat)}</dd>
                <dt className="text-lg font-extrabold">Total</dt><dd className="text-right text-lg font-extrabold">AED {m(draft.totals.total)}</dd>
                {paidSoFar ? <><dt className="text-muted">Paid so far (advances), applied on issue</dt><dd className="text-right">AED {m(paidSoFar)}</dd></> : null}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
