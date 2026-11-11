import { ApprovalsHere } from "@/components/ApprovalsHere";
import { countsAsPaid } from "@/lib/bank-status";
import { OwnerReviewCard, SendForOwner } from "./OwnerReviewCard";
import { accountsLimitOf, loadReviews, lpoReviewReady, reviewLog } from "@/lib/lpo-review";
import { LpoInvoicesCard } from "./LpoInvoicesCard";
import { lpoInvoiceGross, lpoInvoiceState, lpoInvoicesReady } from "@/lib/lpo-invoices";
import Link from "next/link";
import { SupplierPayBox } from "@/components/SupplierPayBox";
import { advancesOf, openInvoicesOf, paymentsOnPo, supplierPaymentsReadyNow } from "@/lib/supplier-payments";
import { SupplierPaymentHistory } from "@/components/SupplierPaymentHistory";
import { CopyVin } from "@/components/CopyVin";
import { JobAdvisorTag } from "@/components/JobAdvisorTag";
import { jobAdvisorOf } from "@/lib/job-advisor";
import { PositionsLine } from "@/components/PositionsLine";
import { approvedQuotations } from "@/lib/quote-data";
import { notFound } from "next/navigation";
import { Badge, Button, Card, ChoiceButtons, DescriptionList, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { SUPPLIER_PAY_METHODS, readZohoMap } from "@/lib/zoho-sync";
import { SupplierProofUpload } from "./SupplierProofUpload";
import { requirePermission } from "@/lib/auth";
import { endedLinesOf } from "@/lib/part-endings-server";
import { formatDate, formatDateTime } from "@/lib/format";
import { PAYMENT_SELECT, toPayment } from "@/lib/invoice-data";
import { loadJobLpos, lpoDiff, lpoProblemsFor, mainSupplierStates, refusalReasonOf, refusalsReady } from "@/lib/lpo";
import { lpoSelectRows } from "@/lib/lpo-select-data";
import { lpoProblemAdvice } from "@/lib/part-cost-check";
import { invoiceEditReady, invoiceHref, invoiceVatReady, loadInvoiceEdits } from "@/lib/supplier-invoices";
import { approvedVsInvoiced } from "@/lib/supplier-invoice-rows";
import { loadPartsChanges } from "@/lib/parts-changes-data";
import { InvoiceEditHistory, SupplierInvoiceEditButton } from "@/components/SupplierInvoiceEdit";
import { supplierNeedsTrn } from "@/lib/supplier-rules";
import { realPartNumber } from "@/lib/parts-rows";
import { changeWords } from "@/lib/price-change";
import { PO_STATUS_LABELS, loadPurchaseOrder, partUnitsOf } from "@/lib/parts-data";
import { partTypeText } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { reasonsFor } from "@/lib/reasons";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { signJobFiles } from "@/lib/work-data";
import { decidePurchaseOrder, receivePurchaseOrder, supplierInvoice, editSupplierInvoice, decideInvoiceCheck, markSupplierPaid, refusePoLineAction, reverseSupplierPaid, undoSupplierPaid } from "../../order-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { SlipTile } from "@/components/PaymentReport";
import { UndoButton } from "@/components/UndoButton";
import { DEFAULT_UNDO_MINUTES, undoSecondsLeft } from "@/lib/money-undo";
import { InvoiceFiles } from "./InvoiceFiles";
import { emailSupplierLpo, markSupplierOrdered, setPartExpectedDate } from "../../lpo-actions";
import { gmailConfigured } from "@/lib/gmail";
import { SupplierLpoCard } from "../../SupplierLpoCard";
import { DecideForm, ReceiveForm, SupplierDecide, SupplierInvoiceForm } from "./PoForms";
import { LpoSendControl } from "./LpoSendControl";
import { getSiteUrl } from "@/lib/site";

import { SupplierAmount } from "@/components/SupplierAmount";
import { addSupplierMoney, originalNetOf, supplierMoney, supplierMoneyText } from "@/lib/supplier-money";
import { supplierChargesVat } from "@/lib/supplier-rules";
import { JobTechnicianTag } from "@/components/JobTechnicianTag";
import { jobTechniciansFor } from "@/lib/job-technician";
import { openReturnsOnPo } from "@/lib/purchase-returns";

export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * One LPO. The main LPO (every supplier, grouped with a subtotal each and a grand total) is approved here with
 * one tap; its supplier LPOs (LPO-00012-1, -2, -3) are sent, marked ordered, received and invoiced here.
 */
export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string; approval?: string }> }) {
  const staff = await requirePermission("viewPurchaseOrders");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error, approval } = await searchParams;
  const bundle = await loadPurchaseOrder(id);
  if (!bundle) notFound();
  const { po, lines, job, names, parts } = bundle;
  const isMain = po.kind === "main";
  const admin = createAdminClient();
  const [{ data: q }, { data: pays }, settings, lpos] = await Promise.all([
    po.job_id ? approvedQuotations(po.job_id).then((qs) => ({ data: qs.length ? { deposit_aed: qs.reduce((a, q) => a + q.deposit_aed, 0), number: qs.map((q) => q.number).join(", ") } : null })) : Promise.resolve({ data: null }),
    po.job_id ? admin.from("payments").select(PAYMENT_SELECT).eq("job_id", po.job_id).eq("is_active", true) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    getSettings(),
    isMain ? loadJobLpos(po.job_id) : Promise.resolve(null),
  ]);
  const depositRequired = Number(q?.deposit_aed) || 0;
  const depositReceived = ((pays ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded" && (countsAsPaid(p))).reduce((a, p) => a + p.amount_aed, 0);
  let depositShort = depositRequired > 0 && depositReceived + 0.005 < depositRequired ? `Deposit AED ${depositRequired.toLocaleString("en-GB")} not received yet${depositReceived > 0 ? ` (AED ${depositReceived.toLocaleString("en-GB")} received so far)` : ""}. Quotation ${q?.number}.` : null;
  // Part 4 (4 November 2026): an LPO on a HELD job ("Order parts now" before the car arrives) with
  // NOTHING paid on the estimate - the owner sees the warning and can approve anyway with a reason.
  if (!depositShort && po.job_id) {
    const { data: heldJob } = await admin.from("jobs").select("id, status, estimate_id").eq("id", po.job_id).maybeSingle();
    if (heldJob?.status === "booked" && heldJob.estimate_id) {
      const { estimateMoneyOf } = await import("@/lib/estimate-money");
      const m = await estimateMoneyOf(String(heldJob.estimate_id)).catch(() => null);
      if (m && m.paid <= 0.005) depositShort = `NO ADVANCE received on ${m.number} (AED 0.00 of ${m.total.toLocaleString("en-GB", { minimumFractionDigits: 2 })} paid) – the car is not here yet.`;
    }
  }
  const canApprove = can(role, "approvePurchaseOrders") && (role === "owner" || staff.is_head_accountant) && !staff.viewingAs;
  const canManage = can(role, "managePurchaseOrders") && !staff.viewingAs;
  const canPay = (role === "owner" || role === "accounts") && !staff.viewingAs;
  // Supplier payments are for the owner and accounts only (10 November 2026, Section 5): the parts desk sees nothing about payments.
  const seesPay = role === "owner" || role === "accounts";
  // Supplier invoice edit (5 November 2026, the Gargash case): the typed VAT, the Edit button and the who/when record.
  const invoiceEntered = !isMain && po.supplier_invoice_status === "received" && !!po.supplier_invoice_number;
  const editOn = invoiceEntered && canPay ? await invoiceEditReady() : false;
  const invoiceVat = invoiceEntered && (await invoiceVatReady()) ? (((await admin.from("purchase_orders").select("supplier_invoice_vat_aed").eq("id", po.id).maybeSingle()).data as { supplier_invoice_vat_aed?: number | null } | null)?.supplier_invoice_vat_aed ?? null) : null;
  const invoiceEdits = !isMain ? await loadInvoiceEdits([po.id]) : [];
  // One LPO, several supplier invoices (10 November 2026, Section 3).
  const invReady = !isMain ? await lpoInvoicesReady() : false;
  const invState = !isMain && invoiceEntered ? await lpoInvoiceState(po.id) : null;
  const lineDesc = new Map(lines.map((l) => [l.id, l.description]));
  const vsApproved = invoiceEntered ? approvedVsInvoiced(Number(po.total_cost_aed) || 0, po.supplier_invoice_amount) : null;
  const scanUrl = po.supplier_invoice_path ? (await signJobFiles([po.supplier_invoice_path]))[po.supplier_invoice_path] : null;
  // Every file of the supplier invoice (several pages photographed one by one are fine), removed ones left out.
  const { data: invFileRows } = !isMain && po.job_id ? await admin.from("job_files").select("id, storage_path, content_type, caption").eq("job_id", po.job_id).eq("kind", "supplier_invoice").eq("ref_id", po.id).is("removed_at", null).order("created_at") : { data: [] };
  const invUrls = await signJobFiles(((invFileRows ?? []) as { storage_path: string }[]).map((r) => r.storage_path));
  const invoiceFiles = ((invFileRows ?? []) as { id: string; storage_path: string; content_type: string | null; caption: string | null }[]).map((r) => ({ id: r.id, path: r.storage_path, url: invUrls[r.storage_path] ?? null, caption: r.caption, contentType: r.content_type }));
  // Supplier payments: the account each method pays from (the mapping; empty = the general paid-from) and the proof.
  const zmap = readZohoMap(settings);
  const paidFromWords = SUPPLIER_PAY_METHODS.map((m) => `${m.label}: ${zmap.paidFromBy?.[m.key] || zmap.paidFrom || "not mapped yet"}`).join(" · ");
  const paidMethodLabel = SUPPLIER_PAY_METHODS.find((m) => m.key === po.supplier_paid_method)?.label ?? "Bank transfer";
  const proofUrl = po.supplier_paid_proof_path ? (await signJobFiles([po.supplier_paid_proof_path]))[po.supplier_paid_proof_path] : null;
  const paidByName = po.supplier_paid_by ? ((await admin.from("staff").select("display_name").eq("id", po.supplier_paid_by).maybeSingle()).data?.display_name ?? null) : null;
  const payMissing: string[] = [];
  if (po.supplier_invoice_status !== "received" || !po.supplier_invoice_number) payMissing.push("the invoice number");
  if (!po.supplier_invoice_date) payMissing.push("the invoice date");
  if (!invoiceFiles.length && !po.supplier_invoice_path && po.job_id) payMissing.push("the scan or photo");
  const today = todayIso();
  const typeOf = (partId: string) => { const p = bundle.parts.find((x) => x.id === partId); return p ? partTypeText(p) : null; };
  const formLines = lines.map((l) => ({ id: l.id, description: l.description, part_number: l.part_number, quantity: l.quantity, received_qty: l.received_qty, unit_cost: l.unit_cost, flag: l.flag, invoice_check: l.invoice_check }));
  const v = job?.vehicle;
  const site = await getSiteUrl();
  const supplierEmailOf = new Map<string, string | null>(((lpos?.suppliers ?? []).length ? (await admin.from("suppliers").select("id, email").in("id", (lpos?.suppliers ?? []).map((s) => s.po.supplier_id).filter((x): x is string => !!x))).data ?? [] : []).map((s) => [s.id as string, (s.email as string | null) ?? null]));
  const supplierDigits = (bundle.supplier?.phone ?? "").replace(/[^\d]/g, "");
  const sendable = !isMain && po.status !== "pending_approval" && po.status !== "cancelled" && !!po.verify_token;
  // A later request continues the car's first LPO family, so its supplier LPOs are found by their parts too.
  const mainPartIds = new Set(lines.map((l) => l.part_item_id).filter(Boolean));
  const children = (lpos?.suppliers ?? []).filter((s) => s.po.parent_id === po.id || s.lines.some((l) => mainPartIds.has(l.part_item_id)));
  // Approve each supplier separately (8 November 2026): while the request waits, only the suppliers still waiting are
  // listed under "Parts by supplier"; the approved ones are their own LPO cards above.
  const pendingMain = isMain && po.status === "pending_approval";
  // Send for owner approval (10 November 2026, Section 4).
  const reviews = await loadReviews([po.id]);
  const reviewEntries = (await reviewLog(reviews)).map((e) => { const r = reviews.find((x) => x.id === e.id)!; return { ...e, status: r.status, auto: r.auto }; });
  const waitingOwnerAll = reviews.some((r) => r.status === "waiting" && !r.supplier);
  const waitingOwnerOf = (sup: string) => reviews.some((r) => r.status === "waiting" && (!r.supplier || r.supplier.trim().toLowerCase() === sup.trim().toLowerCase()));
  const reviewOn = await lpoReviewReady();
  const accountsLimit = accountsLimitOf(settings as unknown as Record<string, unknown>);
  const onMainIds = new Set(parts.map((p) => p.id));
  const groupLines = pendingMain ? lines.filter((l) => onMainIds.has(l.part_item_id)) : lines;
  const supplierStates = pendingMain ? await mainSupplierStates(po.id) : [];
  const repeatedPn = pendingMain && po.job_id ? (await lpoSelectRows(po.job_id)).repeated : new Map<string, string>();
  // Each line's unit (pieces, litres, sets) for the cards' "× 8 L" and the supplier copy.
  const unitOfPart = await partUnitsOf([...children.flatMap((s) => s.lines.map((l) => l.part_item_id)), ...bundle.lines.map((l) => l.part_item_id ?? "")]);
  // The main LPO while it waits: the lines grouped by supplier (the parts still point at it), a subtotal each.
  const groups = (() => {
    const m = new Map<string, typeof lines>();
    for (const l of groupLines) {
      const sup = (parts.find((p) => p.id === l.part_item_id)?.supplier ?? "").trim() || "Supplier to confirm";
      m.set(sup, [...(m.get(sup) ?? []), l]);
    }
    const chargesOf = (s: string) => bundle.charges.filter((c) => c.supplier_name.trim().toLowerCase() === s.toLowerCase());
    return Array.from(m.entries()).map(([supplier, ls]) => ({ supplier, lines: ls, charges: chargesOf(supplier), subtotal: ls.reduce((a, l) => a + l.quantity * l.unit_cost, 0) + chargesOf(supplier).reduce((a, c) => a + c.amount_aed, 0) }));
  })();
  const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  // Supplier amounts with VAT (5 November 2026, Mathew): THE one calculation (lib/supplier-money.ts). VAT only for a
  // supplier that is VAT registered with a TRN (never Our stock), 5% of the LPO total rounded half up; the entered
  // invoice's own VAT replaces the estimate; a cancelled LPO shows its original amount struck through.
  const { data: groupSups } = isMain ? await admin.from("suppliers").select("name, trn, vat_registered") : { data: [] as { name: string; trn: string | null; vat_registered: boolean | null }[] };
  const vatOfSupplierName = (name: string) => supplierChargesVat(((groupSups ?? []) as { name: string; trn: string | null; vat_registered: boolean | null }[]).find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? { name, trn: null, vat_registered: null });
  const chargesVat = isMain ? vatOfSupplierName(po.supplier_name) : supplierChargesVat({ name: po.supplier_name, trn: bundle.supplier?.trn ?? null, vat_registered: bundle.supplier?.vat_registered ?? null });
  const { data: everyLine } = po.status === "cancelled" ? await admin.from("purchase_order_lines").select("quantity, unit_cost").eq("po_id", po.id) : { data: [] as { quantity: number; unit_cost: number }[] };
  const cancelled = po.status === "cancelled";
  const originalNet = cancelled ? originalNetOf((everyLine ?? []) as { quantity: number; unit_cost: number }[]) : 0;
  const ownMoney = supplierMoney(cancelled && originalNet > 0 ? originalNet : Number(po.total_cost_aed) || 0, { chargesVat });
  // B3: what "Paid to supplier" pays ("AED 1,092.00 incl. VAT (1,040.00 + VAT 52.00)") and the undo window.
  const payNet = Number(po.supplier_invoice_amount ?? po.total_cost_aed) || 0;
  const payMoney = supplierMoney(payNet, { chargesVat, typedVat: invoiceVat });
  const payVat = payMoney.vat;
  const payWords = supplierMoneyText(payMoney);
  const groupMoney = (g: { supplier: string; subtotal: number }) => supplierMoney(g.subtotal, { chargesVat: vatOfSupplierName(g.supplier) });
  const grandMoney = cancelled ? ownMoney : addSupplierMoney(groups.map(groupMoney));
  const undoMinutes = Number((settings as unknown as Record<string, unknown>).money_undo_minutes) || DEFAULT_UNDO_MINUTES;
  // 1 November 2026 (LPO-00038): one line can be refused on its own; refused lines stay listed, greyed, with the reason.
  const refusalsOn = await refusalsReady();
  const canRefuseLine = canApprove && refusalsOn && po.status === "pending_approval" && lines.length > 0;
  const { data: refusedRows } = refusalsOn ? await admin.from("part_items").select("id, description, supplier, quantity, confirmed_quantity, cost_aed, refused_at, refused_by, refused_reason, replacement_part_id").eq("refused_po_id", po.id).order("refused_at") : { data: [] };
  // 2 November 2026: a line with no real price cannot be approved. Shown where the approver is: on the line itself,
  // and inside the Approve box (Approve stays off until it is fixed), never only at the top of the page.
  const lineProblems = po.status === "pending_approval" && po.job_id ? await lpoProblemsFor(po.job_id, lines.map((l) => l.part_item_id).filter((x): x is string => !!x)) : new Map<string, { words: string; fix: "confirm" | "price" | "stock" }>();
  const problemList = Array.from(lineProblems.values());
  const problemAdvice = problemList.length ? lpoProblemAdvice(problemList, true) : "";
  const refusedBy = new Map(((refusedRows ?? []).length ? (await admin.from("staff").select("id, display_name").in("id", (refusedRows ?? []).map((r) => r.refused_by as string).filter(Boolean))).data ?? [] : []).map((s) => [s.id as string, s.display_name as string]));
  // Lines whose part was given its ending (3 November 2026): cancelled ones are off the LPO, returned or kept ones stay on it.
  const endedByPo = await endedLinesOf([po.id, ...children.map((s) => s.po.id)]);
  const endedHere = endedByPo.get(po.id) ?? [];
  const endedOfLine = new Map(endedHere.filter((e) => e.onLpo).map((e) => [e.lineId, e]));
  const cancelledHere = endedHere.filter((e) => !e.onLpo);
  // Fix 2.2 (4 November 2026): this LPO replaces a refused one - the owner sees what changed, highlighted.
  const { data: replacedRaw } = isMain && po.status === "pending_approval" ? await admin.from("purchase_orders").select("id, number, notes").eq("superseded_by", po.id).limit(1).maybeSingle() : { data: null };
  let resendDiff: { number: string; reason: string; added: string[]; removed: string[]; changed: string[] } | null = null;
  if (replacedRaw) {
    const { data: oldL } = await admin.from("purchase_order_lines").select("description, quantity, unit_cost").eq("po_id", replacedRaw.id).eq("is_active", true);
    const d = lpoDiff((oldL ?? []) as { description: string; quantity: number; unit_cost: number }[], lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_cost: l.unit_cost })));
    resendDiff = { number: replacedRaw.number as string, reason: refusalReasonOf(replacedRaw.notes as string | null), ...d };
  }
  // Fix 2.3: lines that changed AFTER the LPO was sent for approval - the owner always decides on the current list.
  let sentChanges: string[] = [];
  if (isMain && po.status === "pending_approval") {
    const { data: allL } = await admin.from("purchase_order_lines").select("description, is_active, created_at, updated_at").eq("po_id", po.id).order("position");
    const sentAt = new Date(po.created_at).getTime();
    sentChanges = (allL ?? []).flatMap((l) => {
      const name = String(l.description).toUpperCase();
      if (l.is_active === false) return [`removed: ${name}`];
      if (new Date(l.created_at as string).getTime() > sentAt + 90_000) return [`added: ${name}`];
      if (new Date(l.updated_at as string).getTime() > new Date(l.created_at as string).getTime() + 90_000) return [`changed: ${name}`];
      return [];
    });
  }
  // Parts changed after the customer's approval: shown to the approver on a waiting main LPO, old vs new.
  const afterApproval = isMain && po.status === "pending_approval" && po.job_id ? await loadPartsChanges(po.job_id) : null;
  // A refused LPO is not a dead end: this page says so, and names the version that replaced it once Parts resend.
  const refusedHere = po.status === "cancelled" && /refused/i.test(String(po.notes ?? ""));
  // The car's advisor next to the job (6 November 2026, Peter): staff only, never on the supplier copy.
  const advisor = po.job_id ? await jobAdvisorOf(po.job_id) : null;
  // Purchase returns on this LPO (8 November 2026): the invoice check warns while an invoice may still charge them.
  const returnsHere = !isMain ? await openReturnsOnPo(po.id) : [];
  const technicians = po.job_id ? ((await jobTechniciansFor([po.job_id])).get(po.job_id) ?? null) : null;
  // Supplier payments with their amount (6 November 2026): the box replaces "Paid to supplier" once the tables are applied.
  // eslint-disable-next-line react-hooks/purity -- a server page: the clock is read once per request
  const todayDubai = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const payHistory = po.kind !== "main" ? await paymentsOnPo(po.id) : [];
  const payNew = po.kind !== "main" && (await supplierPaymentsReadyNow()) ? { invoices: await openInvoicesOf(po.supplier_id ?? null, po.supplier_name), advances: await advancesOf(po.supplier_id ?? null, po.supplier_name) } : null;
  const { data: replacedBy } = refusedHere && po.superseded_by ? await admin.from("purchase_orders").select("id, number").eq("id", po.superseded_by).maybeSingle() : { data: null };

  return (
    <>
      <ApprovalsHere staff={staff} poId={po.id} highlight={approval ?? null} />
      <PageHeader
        title={isMain ? `${po.number} · all suppliers` : `${po.number} · ${po.supplier_name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {/* 11 November 2026 (Section 1): a stock purchase says so, never an empty car line, a stray dot or "No VIN". */}
            {po.job_id ? <span>{v ? `${formatPlate(v)} · ${[v.make?.name, v.model?.name].filter(Boolean).join(" ")}` : ""}</span> : <span className="font-extrabold uppercase" data-lpo-stock-header>Stock purchase – no car</span>}
            {job?.job_number ? <span>· {job.job_number}</span> : null}
            {po.job_id && advisor ? <JobAdvisorTag jobId={po.job_id} jobWords={`${job?.job_number ?? ""}${v ? ` · ${formatPlate(v)}` : ""}`} advisor={advisor} canAsk={!staff.viewingAs} /> : null}
            {po.job_id ? <JobTechnicianTag jobId={po.job_id} technicians={technicians} /> : null}
            <Badge tone={po.status === "pending_approval" ? "amber" : po.status === "received" ? "green" : po.status === "cancelled" ? "neutral" : "ink"}>{isMain && po.status === "approved" ? "Approved" : PO_STATUS_LABELS[po.status]}</Badge>
            {po.supplier_invoice_status === "to_follow" ? <Badge tone="amber">Invoice missing</Badge> : null}
            {seesPay && po.supplier_paid_at ? <Badge tone="green">Paid to supplier</Badge> : null}
            {!isMain && (po.supplier_invoice_status === "received" || po.supplier_invoice_status === "to_follow") && ["owner", "accounts", "parts"].includes(role) ? <Link href={invoiceHref(po)} className="text-sm font-bold underline underline-offset-4" data-lpo-invoice-link>{po.supplier_invoice_number ? `INV ${po.supplier_invoice_number}` : "Invoice"} in Supplier invoices</Link> : null}
          </span>
        }
        actions={
          <>
            {po.job_id ? <CopyVin vin={v?.vin} /> : null}
            <LinkButton href="/parts/orders" tone="secondary" size="lg">All LPOs</LinkButton>
            {job ? <LinkButton href={`/parts/${job.id}#lpo`} tone="secondary" size="lg">Parts page</LinkButton> : null}
            {job ? <LinkButton href={`/jobs/${job.id}`} tone="secondary" size="lg">Job card</LinkButton> : null}
            {sendable ? (
              <a href={`/api/pdf/po/${po.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap bg-white text-ink border border-line-strong hover:bg-canvas min-h-14 px-6 text-base">Supplier copy (PDF)</a>
            ) : null}
            {sendable && canManage ? <LpoSendControl poId={po.id} number={po.number} dateText={formatDate(po.approved_at ?? po.created_at)} link={`${site}/api/pdf/lpo/${po.verify_token}`} phoneDigits={supplierDigits} sentAt={po.sent_at} /> : null}
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {/* C1, 1 November 2026: a VAT-registered supplier without a TRN - its bill cannot go to Zoho until it is typed. */}
      {!isMain && bundle.supplier && supplierNeedsTrn({ name: po.supplier_name, trn: bundle.supplier.trn, vat_registered: bundle.supplier.vat_registered }) ? (
        <div data-no-trn>
          <Notice tone="error">{po.supplier_name} is ticked VAT registered but has no TRN: its bill cannot go to Zoho Books. Type the 15-digit TRN on <Link href="/parts/suppliers" className="font-bold underline underline-offset-4">Parts &gt; Suppliers</Link> (or untick VAT registered); the bill then goes back in the queue and is sent with the next Sync to Zoho.</Notice>
        </div>
      ) : null}
      {returnsHere.length ? (
        <div data-pr-invoice-warning>
          <Notice tone="info">{returnsHere.map((r) => `${r.number}: ${r.description.toUpperCase()} × ${r.quantity} ${r.status === "credited" || r.status === "refunded" ? `went back (${r.status === "credited" ? `credit note ${r.creditNumber ?? ""}` : "refunded"})` : "is going back"}`).join(" · ")}. {po.supplier_invoice_status === "received" ? "Check the supplier's invoice: a returned part must be credited, never paid twice." : "When the supplier's invoice arrives, check it does not still charge the returned part (or that the credit note covers it)."} <Link href="/parts/returns" className="font-bold underline">Purchase returns</Link></Notice>
        </div>
      ) : null}
      {canApprove || role === "owner" ? <OwnerReviewCard action={decidePurchaseOrder.bind(null, po.id)} entries={reviewEntries} isOwner={role === "owner" && !staff.viewingAs} pending={po.status === "pending_approval"} /> : null}
      {po.status === "pending_approval" ? <Notice tone="info">{isMain ? "Waiting for the owner or the head accountant. Approve each supplier on its own (its LPO is made at once), or Approve all." : "Waiting for the owner or the head accountant. The PDF cannot be downloaded or sent before approval."}</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {isMain && children.length ? (
            <section className="flex flex-col gap-3" data-supplier-lpos>
              <SectionLabel right={`${children.length}`}>Supplier LPOs</SectionLabel>
              {children.map((s) => (
                <SupplierLpoCard key={s.po.id} po={{ id: s.po.id, number: s.po.number, chargesVat: vatOfSupplierName(s.po.supplier_name), supplier_name: s.po.supplier_name, status: s.po.status, ordered_at: s.po.ordered_at, verify_token: s.po.verify_token, sent_at: s.po.sent_at, emailed_at: s.po.emailed_at, emailed_to: s.po.emailed_to, total_cost_aed: s.po.total_cost_aed, lines: s.lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, positions: bundle.parts.find((x) => x.id === l.part_item_id)?.positions ?? null, unit: unitOfPart.get(l.part_item_id ?? "") ?? null, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })), charges: s.charges, ended: endedByPo.get(s.po.id) ?? [] }} vin={v?.vin ?? null} canManage={canManage} onOrdered={markSupplierOrdered.bind(null, s.po.id)} onSetDate={setPartExpectedDate} supplierEmail={supplierEmailOf.get(s.po.supplier_id ?? "") ?? null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, s.po.id)} jobId={po.job_id} />
              ))}
            </section>
          ) : null}

          {pendingMain && supplierStates.length ? (
            <p className="text-base font-bold" data-supplier-states>{supplierStates.filter((x) => x.state === "approved").length} of {supplierStates.length} supplier{supplierStates.length === 1 ? "" : "s"} approved · {supplierStates.filter((x) => x.state === "waiting").length} waiting{supplierStates.some((x) => x.state === "refused") ? ` · ${supplierStates.filter((x) => x.state === "refused").length} refused (replacement to come)` : ""}</p>
          ) : null}
          {isMain && (pendingMain ? groups.length > 0 : !children.length) ? (
            <Card className="flex flex-col gap-3" data-main-lpo>
              <SectionLabel right={`${groups.length} supplier${groups.length === 1 ? "" : "s"}`}>Parts by supplier</SectionLabel>
              {groups.map((g) => (
                <div key={g.supplier} className="flex flex-col gap-1" data-lpo-group={g.supplier}>
                  <span className="text-sm font-extrabold">{g.supplier}</span>
                  <ul className="divide-y divide-line text-sm">
                    {g.lines.map((l) => (
                      <li key={l.id} className="py-1.5 flex flex-wrap items-center gap-2">
                        <span className="flex flex-col"><span className="font-semibold uppercase">{l.description}</span><PositionsLine positions={bundle.parts.find((x) => x.id === l.part_item_id)?.positions} /></span>
                        {typeOf(l.part_item_id) ? <Badge tone="outline">{typeOf(l.part_item_id)}</Badge> : null}
                        {realPartNumber(l.part_number) ? <span className="text-muted">{realPartNumber(l.part_number)}</span> : null}
                        <span className="text-muted">× {l.quantity} at {money(l.unit_cost)}</span>
                        <span className="ml-auto font-semibold">{money(l.quantity * l.unit_cost)}</span>
                        {lineProblems.get(l.part_item_id) ? <span className="basis-full text-xs font-bold text-red" data-lpo-line-problem={l.id}>Not a real price yet: {lineProblems.get(l.part_item_id)?.words.replace(/^[^:]*:\s*/, "")}</span> : null}
                        {canRefuseLine ? (
                          <details className="basis-full" data-refuse-line={l.id}>
                            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center text-xs font-bold text-red underline underline-offset-4 [&::-webkit-details-marker]:hidden">Refuse this line</summary>
                            <form action={refusePoLineAction.bind(null, po.id, l.id)} className="mt-1 flex flex-wrap items-center gap-2">
                              <Input name="reason" required minLength={3} placeholder="Why? e.g. wrong supplier for this car" className="min-w-[14rem] flex-1" textCase="sentence" aria-label="Why the line is refused" data-refuse-reason />
                              <Button type="submit" size="md" tone="danger" data-refuse-send>Refuse line</Button>
                            </form>
                          </details>
                        ) : null}
                      </li>
                    ))}
                    {g.charges.map((c) => (
                      <li key={c.id} className="py-1.5 flex flex-wrap items-center gap-2" data-lpo-charge>
                        <Badge tone="outline">Other charge</Badge>
                        <span className="font-semibold uppercase">{c.description}</span>
                        <span className="ml-auto font-semibold">{money(c.amount_aed)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-2 rounded-control bg-chip px-3 py-1.5 text-sm"><span className="text-muted">Subtotal · {g.supplier}</span><span data-lpo-subtotal><SupplierAmount money={groupMoney(g)} cancelled={cancelled} size="sm" /></span></div>
                  {pendingMain && canApprove && (groups.length > 1 || supplierStates.length > 1) ? (() => {
                    const blockedLine = g.lines.find((l) => lineProblems.get(l.part_item_id) || repeatedPn.get(l.part_item_id));
                    const blocked = blockedLine ? (repeatedPn.get(blockedLine.part_item_id) ?? `${blockedLine.description.toUpperCase()}: not a real price yet`) : null;
                    if (role !== "owner" && waitingOwnerOf(g.supplier)) return <p className="text-sm font-semibold text-amber-bar" data-supplier-waiting-owner={g.supplier}>{g.supplier}: waiting for the owner.</p>;
                    return (
                      <div className="flex flex-col gap-2">
                        <SupplierDecide action={decidePurchaseOrder.bind(null, po.id)} supplier={g.supplier} amount={supplierMoneyText(groupMoney(g))} blocked={blocked} depositShort={depositShort} isOwner={role === "owner"} reasons={reasonsFor(settings, "deposit_override")} />
                        {role !== "owner" && reviewOn ? <SendForOwner action={decidePurchaseOrder.bind(null, po.id)} supplier={g.supplier} /> : null}
                      </div>
                    );
                  })() : null}
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 border-t border-line pt-2 text-base"><span className="font-bold">{cancelled ? "Grand total (cancelled, not counted)" : "Grand total"}</span><span data-lpo-grand-total><SupplierAmount money={grandMoney} cancelled={cancelled} /></span></div>
              {canRefuseLine ? <p className="text-xs text-muted">One wrong line? Refuse just that line with its reason: Parts are told to replace it, and the replacement joins this LPO by itself.</p> : null}
              {po.notes ? <p className="text-sm whitespace-pre-wrap text-muted">{po.notes}</p> : null}
            </Card>
          ) : null}

          {!isMain ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel right={`${lines.length} line${lines.length === 1 ? "" : "s"}`}>Lines</SectionLabel>
              <ul className="divide-y divide-line text-sm">
                {lines.map((l) => {
                  const part = parts.find((p) => p.id === l.part_item_id);
                  const late = l.expected_date && l.expected_date < today && l.received_qty < l.quantity;
                  return (
                    <li key={l.id} className="py-2 flex flex-wrap items-center gap-2">
                      <span className="flex flex-col"><span className="font-semibold uppercase">{l.description}</span><PositionsLine positions={part?.positions} /></span>
                      {typeOf(l.part_item_id) ? <Badge tone="outline">{typeOf(l.part_item_id)}</Badge> : null}
                      {realPartNumber(l.part_number) ? <span className="text-muted">{realPartNumber(l.part_number)}</span> : null}
                      <span className="text-muted">× {l.quantity} at AED {l.unit_cost.toFixed(2)}</span>
                      {lineProblems.get(l.part_item_id) ? <span className="basis-full text-xs font-bold text-red" data-lpo-line-problem={l.id}>Not a real price yet: {lineProblems.get(l.part_item_id)?.words.replace(/^[^:]*:\s*/, "")}</span> : null}
                      {l.expected_date ? <Badge tone={late ? "red" : "neutral"}>{late ? "Late, " : ""}expected {formatDate(l.expected_date)}</Badge> : null}
                      {l.received_qty > 0 ? <Badge tone={l.received_qty >= l.quantity ? "green" : "amber"}>received {l.received_qty}</Badge> : null}
                      {l.flag ? <Badge tone="red">{l.flag === "wrong" ? "Wrong part" : "Damaged"}: {l.flag_note}</Badge> : null}
                      {changeWords(l) ? <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${l.invoice_check === "mismatch" || l.invoice_check === "disputed" ? "border border-red-bar text-red" : "border border-amber-bar bg-amber-soft text-amber-text"}`} data-price-change>{changeWords(l)}{l.invoice_check === "accepted" ? " · accepted" : l.invoice_check === "disputed" ? " · queried with the supplier" : l.invoice_check === "mismatch" ? " · waits for the owner" : ""}</span> : null}
                      {l.invoice_check === "mismatch" && role === "owner" && !staff.viewingAs ? (
                        <form action={decideInvoiceCheck.bind(null, l.id)} className="flex gap-1" data-invoice-check={l.id}>
                          <Button type="submit" name="decision" value="accept" size="md" data-price-ok>OK</Button>
                          <Button type="submit" name="decision" value="dispute" size="md" tone="secondary" data-price-query>Query with supplier</Button>
                        </form>
                      ) : null}
                      {part?.label_code ? <span className="ml-auto text-xs text-muted">label {part.label_code}</span> : null}
                      {part?.issue_status === "confirmed" ? <Badge tone="green">Issued</Badge> : null}
                      {endedOfLine.get(l.id) ? <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${endedOfLine.get(l.id)!.state === "return_pending" ? "border-amber-bar bg-amber-soft text-amber-text" : "border-line-strong text-ink"}`} data-lpo-line-ended={endedOfLine.get(l.id)!.state}>{endedOfLine.get(l.id)!.words}</span> : null}
                    </li>
                  );
                })}
                {cancelledHere.map((e) => (
                  <li key={e.lineId} className="py-2 flex flex-wrap items-center gap-2 text-muted" data-lpo-line-cancelled={e.lineId}>
                    <span className="font-semibold uppercase line-through">{e.description}</span>
                    {e.partNumber ? <span className="line-through">{e.partNumber}</span> : null}
                    <span className="line-through">× {e.quantity} at AED {e.unitCost.toFixed(2)}</span>
                    <span className="rounded-full border border-line-strong px-2 py-0.5 text-xs font-bold text-ink">{e.words}</span>
                  </li>
                ))}
                {bundle.charges.map((c) => (
                  <li key={c.id} className="py-2 flex flex-wrap items-center gap-2" data-lpo-charge>
                    <Badge tone="outline">Other charge</Badge>
                    <span className="font-semibold uppercase">{c.description}</span>
                    <span className="text-muted">AED {c.amount_aed.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-line pt-2" data-lpo-lines-total>
                <span className="font-bold">{cancelled ? "Total (cancelled, not counted)" : "Total"}</span>
                <SupplierAmount money={ownMoney} cancelled={cancelled} />
              </div>
              {po.notes ? <p className="text-sm whitespace-pre-wrap text-muted">{po.notes}</p> : null}
            </Card>
          ) : null}

          {(refusedRows ?? []).length ? (
            <Card className="flex flex-col gap-2" data-refused-lines>
              <SectionLabel right={`${(refusedRows ?? []).length}`}>Refused lines</SectionLabel>
              <ul className="divide-y divide-line text-sm">
                {(refusedRows ?? []).map((r) => (
                  <li key={r.id as string} className="py-1.5 flex flex-wrap items-center gap-2 opacity-70" data-refused-line>
                    <span className="font-semibold uppercase line-through">{r.description as string}</span>
                    {r.supplier ? <span className="text-muted">{r.supplier as string}</span> : null}
                    <span className="rounded-full border border-red-bar px-2 py-0.5 text-xs font-bold text-red">Refused by {refusedBy.get(r.refused_by as string) ?? "the owner"}{r.refused_reason ? ` – ${r.refused_reason}` : ""}</span>
                    <span className="ml-auto text-xs text-muted">{r.replacement_part_id ? "Replacement added" : "Waiting for a replacement from Parts"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {refusedHere ? (
            <Card className="flex flex-col gap-2 border-red-bar" data-lpo-refused-note>
              <SectionLabel>Refused</SectionLabel>
              <p className="text-sm font-semibold">{refusalReasonOf(po.notes) ? `Reason: ${refusalReasonOf(po.notes)}` : "Refused (no reason was written)."}</p>
              {replacedBy ? (
                <p className="text-sm">Replaced by <Link href={`/parts/orders/${replacedBy.id}`} className="font-bold underline underline-offset-4" data-lpo-replaced-by>{replacedBy.number as string}</Link>, which carries the current list.</p>
              ) : (
                <p className="text-sm text-muted">This is not a dead end: Parts fix the list on the <Link href={`/parts/${po.job_id}#lpo`} className="font-semibold underline underline-offset-4">Parts page</Link> and press &quot;Send for approval again&quot;.</p>
              )}
            </Card>
          ) : null}
          {resendDiff ? (
            <Card className="flex flex-col gap-2 border-ink" data-lpo-diff>
              <SectionLabel>Sent again after a refusal</SectionLabel>
              <p className="text-sm">Replaces the refused <span className="font-bold">{resendDiff.number}</span>{resendDiff.reason ? ` (your reason: ${resendDiff.reason})` : ""}. What changed:</p>
              {resendDiff.added.length || resendDiff.removed.length || resendDiff.changed.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {resendDiff.added.map((a) => <li key={`a-${a}`} className="rounded-control bg-green-soft px-2 py-1 font-semibold" data-lpo-diff-added>+ {a}</li>)}
                  {resendDiff.removed.map((r) => <li key={`r-${r}`} className="rounded-control bg-chip px-2 py-1 text-muted line-through" data-lpo-diff-removed>− {r}</li>)}
                  {resendDiff.changed.map((c) => <li key={`c-${c}`} className="rounded-control bg-amber-soft px-2 py-1 font-semibold" data-lpo-diff-changed>~ {c}</li>)}
                </ul>
              ) : <p className="text-sm text-muted" data-lpo-diff-same>Same parts at the same prices.</p>}
            </Card>
          ) : null}
          {/* Parts changed after the customer's approval (5 November 2026, J-00985): what the approver decides on, old vs new. */}
          {afterApproval?.words ? (
            <Card className="flex flex-col gap-2 !border-amber-bar" data-lpo-after-approval>
              <SectionLabel>Changes since the customer&apos;s approval</SectionLabel>
              <p className="text-sm font-bold" data-lpo-after-approval-words>{afterApproval.words}</p>
              <ul className="flex flex-col gap-1 text-sm">
                {afterApproval.added.map((a) => <li key={a.id} className="rounded-control bg-green-soft px-2 py-1 font-semibold" data-lpo-change="added">+ NEW · {a.description.toUpperCase()} × {a.qty} · AED {a.total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</li>)}
                {afterApproval.changed.map((x) => <li key={x.id} className="rounded-control bg-amber-soft px-2 py-1 font-semibold" data-lpo-change="changed">~ CHANGED · {x.description.toUpperCase()} · old AED {x.oldTotal.toLocaleString("en-GB", { minimumFractionDigits: 2 })} → new AED {x.newTotal.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</li>)}
                {afterApproval.removed.map((x) => <li key={x.id} className="rounded-control bg-chip px-2 py-1 text-muted" data-lpo-change="removed"><span className="line-through">− {x.description.toUpperCase()}</span> · was AED {x.oldTotal.toLocaleString("en-GB", { minimumFractionDigits: 2 })}{x.reason ? ` · ${x.reason}` : ""}</li>)}
              </ul>
              <p className="text-xs text-muted">Old = what the customer approved. The customer&apos;s quotation is not changed by approving this; the advisor decides whether to revise it.</p>
            </Card>
          ) : null}
          {sentChanges.length && po.status === "pending_approval" ? (
            <Card className="flex flex-col gap-1 border-amber-bar" data-lpo-updated-note>
              <SectionLabel>Updated after sending</SectionLabel>
              <p className="text-sm">{sentChanges.slice(0, 10).join(" · ")}{sentChanges.length > 10 ? " · …" : ""}. The list and total above are the current ones.</p>
            </Card>
          ) : null}
          {po.status === "pending_approval" && canApprove ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Approve this LPO</SectionLabel>
              {role !== "owner" && waitingOwnerAll ? (
                <p className="text-sm font-semibold text-amber-bar" data-lpo-waiting-owner>Waiting for the owner: his decision or answer comes as a bell.</p>
              ) : (
                <>
                  {role !== "owner" && accountsLimit > 0 && (isMain ? grandMoney : ownMoney).gross > accountsLimit ? <p className="text-sm font-semibold text-amber-bar" data-above-limit>Above your approval limit (AED {accountsLimit.toLocaleString("en-GB", { minimumFractionDigits: 2 })} incl. VAT): Approve sends it to the owner.</p> : null}
                  <DecideForm action={decidePurchaseOrder.bind(null, po.id)} problems={problemList.map((p) => p.words)} problemAdvice={problemAdvice} depositShort={depositShort} isOwner={role === "owner"} reasons={reasonsFor(settings, "deposit_override")} summary={[po.number, po.supplier_name, supplierMoneyText(isMain ? grandMoney : ownMoney), `${lines.length} line${lines.length === 1 ? "" : "s"}`]} />
                  {role !== "owner" && reviewOn ? <SendForOwner action={decidePurchaseOrder.bind(null, po.id)} /> : null}
                </>
              )}
            </Card>
          ) : null}
          {!isMain && po.status === "approved" ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Send it, then Ordered</SectionLabel>
              <p className="text-sm text-muted">Copy the text or send the PDF to {po.supplier_name}, then press Ordered: the arrival dates follow from the availability entered at pricing, and any date can be changed with a tap.</p>
              <SupplierLpoCard po={{ id: po.id, number: po.number, chargesVat, supplier_name: po.supplier_name, status: po.status, ordered_at: po.ordered_at, verify_token: po.verify_token, sent_at: po.sent_at, emailed_at: po.emailed_at, emailed_to: po.emailed_to, total_cost_aed: po.total_cost_aed, lines: lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, positions: bundle.parts.find((x) => x.id === l.part_item_id)?.positions ?? null, unit: unitOfPart.get(l.part_item_id ?? "") ?? null, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })), charges: bundle.charges, ended: endedHere }} vin={v?.vin ?? null} canManage={canManage} onOrdered={markSupplierOrdered.bind(null, po.id)} onSetDate={setPartExpectedDate} supplierEmail={bundle.supplier?.email ?? null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, po.id)} jobId={po.job_id} />
            </Card>
          ) : null}
          {(po.status === "ordered" || po.status === "partly_received") && canManage ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Receive the delivery</SectionLabel>
              <ReceiveForm lines={formLines} action={receivePurchaseOrder.bind(null, po.id)} invoiceOpen={po.supplier_invoice_status !== "received"} />
            </Card>
          ) : null}
          {/* Supplier invoices are scanned and entered by the owner and accounts ONLY (4 November 2026). */}
          {!isMain && po.status === "received" && po.supplier_invoice_status !== "received" ? (
            <Card className={`flex flex-col gap-2 ${po.supplier_invoice_status === "to_follow" ? "!border-amber-bar" : ""}`}>
              <SectionLabel>Supplier invoice{po.supplier_invoice_status === "to_follow" ? " · with accounts" : ""}</SectionLabel>
              {po.supplier_invoice_status === "to_follow" ? <p className="text-sm font-semibold text-amber-bar" data-invoice-missing>{canPay ? `Collect the supplier's invoice from Parts, scan it and enter it here (or on the Supplier invoices page).` : `Invoice with accounts: they collect the supplier's paper from the desk and scan it. Keep it ready for them.`}</p> : null}
              {canPay ? <SupplierInvoiceForm jobId={po.job_id} poId={po.id} lines={formLines} action={supplierInvoice.bind(null, po.id)} poTotal={po.total_cost_aed} lpoDate={String(po.approved_at ?? po.created_at ?? "").slice(0, 10) || null} /> : null}
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {invState ? (
            <LpoInvoicesCard
              poId={po.id}
              jobId={po.job_id}
              canPay={canPay}
              ready={invReady}
              summary={invState.summary}
              coverage={invState.coverage}
              first={{ number: po.supplier_invoice_number, amount: po.supplier_invoice_amount, vat: invState.po.supplier_invoice_vat_aed }}
              extras={invState.extras.map((e) => ({ id: e.id, number: e.number, date: e.invoice_date, amount: e.amount_aed, vat: e.vat_aed, gross: lpoInvoiceGross(e, invState.chargesVat), lines: e.lines.map((c) => ({ lineId: c.line_id, description: lineDesc.get(c.line_id) ?? "", qty: c.qty })), checked: !!e.checked_at, paid: seesPay && !!e.paid_at, query: e.query, inZoho: !!e.zoho_bill_id }))}
              paid={seesPay && !!po.supplier_paid_at}
              today={today}
            />
          ) : null}
          <Card className="flex flex-col gap-2">
            <SectionLabel>Record</SectionLabel>
            <DescriptionList
              items={[
                { label: isMain ? "Sent for approval" : "Raised", value: `${formatDateTime(po.created_at)} by ${po.created_by ? (names.get(po.created_by) ?? "") : ""}` },
                { label: "Approved", value: po.approved_at ? `${formatDateTime(po.approved_at)} by ${po.approved_by ? (names.get(po.approved_by) ?? "") : ""}` : null },
                { label: "Deposit override", value: po.deposit_override_reason },
                { label: "Ordered", value: po.ordered_at ? `${formatDateTime(po.ordered_at)} by ${po.ordered_by ? (names.get(po.ordered_by) ?? "") : ""}` : null },
                { label: "Sent to supplier", value: po.sent_at ? `${formatDateTime(po.sent_at)} by ${po.sent_by ? (names.get(po.sent_by) ?? "") : ""}${po.sent_method ? ` (${po.sent_method})` : ""}` : null },
                { label: "Received", value: po.received_at ? formatDateTime(po.received_at) : null },
                { label: "Supplier invoice", value: po.supplier_invoice_status === "received" ? `${po.supplier_invoice_number}${po.supplier_invoice_date ? ` dated ${formatDate(po.supplier_invoice_date)}` : ""}${po.supplier_invoice_amount ? ` · ${payWords}` : ""} · entered ${formatDateTime(po.supplier_invoice_at)}` : po.supplier_invoice_status === "to_follow" ? "Missing (to follow)" : null },
                { label: "Paid to supplier", value: seesPay && po.supplier_paid_at ? `${formatDateTime(po.supplier_paid_at)} by ${po.supplier_paid_by ? (names.get(po.supplier_paid_by) ?? "") : ""}${po.supplier_paid_reference ? ` · ${po.supplier_paid_reference}` : ""}` : null },
                ...(po.parent_id ? [{ label: "Main LPO", value: <Link href={`/parts/orders/${po.parent_id}`} className="underline underline-offset-4 font-semibold">{po.number.replace(/-\d+$/, "")}</Link> }] : []),
                ...(scanUrl ? [{ label: "Scan", value: <a href={scanUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 font-semibold">Open the supplier invoice</a> }] : []),
              ]}
            />
            {vsApproved ? <p className="text-sm font-bold" data-invoice-vs-approved>{vsApproved}</p> : null}
            {/* The owner and accounts edit an entered invoice with a compulsory remark (5 November 2026); others never see the button and the server refuses them too. */}
            {editOn ? (
              <SupplierInvoiceEditButton
                action={editSupplierInvoice.bind(null, po.id)}
                back={`/parts/orders/${po.id}`}
                poNumber={po.number}
                number={po.supplier_invoice_number ?? ""}
                date={String(po.supplier_invoice_date ?? "").slice(0, 10)}
                amount={po.supplier_invoice_amount}
                vat={po.supplier_invoice_amount ? payVat : invoiceVat}
                lpoTotal={Number(po.total_cost_aed) || 0}
                lines={lines.map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity) || 0, price: Number(l.invoice_unit_cost ?? l.unit_cost) || 0 }))}
                paid={!!po.supplier_paid_at}
                chargesVat={chargesVat}
              />
            ) : null}
            <InvoiceEditHistory entries={invoiceEdits} />
          </Card>
          {/* The payment box of every supplier LPO, a stock order (no car) included: "Pay on the LPO" lands here. */}
          {seesPay && !isMain && po.status !== "pending_approval" && po.status !== "cancelled" && (po.supplier_invoice_status !== "none" || invoiceFiles.length > 0 || po.status === "received") ? (
            <Card className="flex flex-col gap-3 scroll-mt-4" id="paid" data-supplier-pay>
              <SectionLabel>{po.job_id ? <>Invoice files &amp; payment</> : "Payment"}</SectionLabel>
              <SupplierPaymentHistory rows={payHistory} canChange={canPay} />
              {po.job_id ? <InvoiceFiles jobId={po.job_id} poId={po.id} files={invoiceFiles} canEdit={canPay} /> : <p className="text-xs text-muted" data-stock-order-pay>Stock order (no car): the supplier invoice is the one entered when the order was received.</p>}
              {po.supplier_paid_at ? (
                <div className="flex flex-col gap-2">
                {!staff.viewingAs && (role === "owner" || po.supplier_paid_by === staff.id) ? <UndoButton at={po.supplier_paid_at} minutes={undoMinutes} done="Payment to the supplier recorded" action={undoSupplierPaid.bind(null, po.id)} /> : null}
                <div className="flex flex-wrap items-center gap-2" data-paid-line>
                  <p className="text-sm font-semibold">Paid to {po.supplier_name} · {paidMethodLabel} · {formatDateTime(po.supplier_paid_at)}{po.supplier_paid_reference ? ` · ${po.supplier_paid_reference}` : ""}{paidByName ? ` · by ${paidByName}` : ""}</p>
                  {po.supplier_paid_proof_path ? (
                    <span className="inline-flex items-center gap-2 rounded-control border border-line bg-chip px-2 py-1.5" data-paid-proof>
                      <SlipTile url={proofUrl} path={po.supplier_paid_proof_path} label={`Proof of payment · ${po.number}`} hook={`lpo-proof-${po.id}`} />
                      <span className="text-xs font-bold uppercase tracking-[0.06em]">Proof of payment</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2" data-paid-proof-missing>
                      <Badge tone="red">Proof missing – upload</Badge>
                      {canPay ? <SupplierProofUpload poId={po.id} /> : null}
                    </span>
                  )}
                </div>
                {canPay && !payHistory.length && undoSecondsLeft(po.supplier_paid_at, undoMinutes) <= 0 ? (
                  <details data-reverse-paid>
                    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-bold text-red underline underline-offset-4 [&::-webkit-details-marker]:hidden">Reverse this payment</summary>
                    <form action={reverseSupplierPaid.bind(null, po.id)} className="mt-2 flex flex-wrap items-center gap-2">
                      <Input name="reason" required minLength={5} placeholder="Why? (logged)" className="w-72" textCase="sentence" aria-label="Why reverse the payment" />
                      <ConfirmSubmit label="Reverse" title="Reverse the payment to the supplier?" lines={[`${po.supplier_name} · ${po.number}`, "the LPO goes back to unpaid (logged with the reason); if it already reached Zoho Books, the payment is taken back there too"]} live={[{ label: "reason:", field: "reason" }]} confirmLabel="Yes, reverse it" tone="danger" size="md" hook="supplier-reverse" />
                    </form>
                  </details>
                ) : null}
                </div>
              ) : canPay ? (
                payMissing.length ? (
                  <p className="text-sm font-semibold text-amber-bar" data-pay-blocked>Cannot be marked paid yet: {payMissing.join(", ")} first. No payment without the full invoice on file.</p>
                ) : payNew ? (
                  <SupplierPayBox key={payHistory.length} supplierId={po.supplier_id ?? null} supplierName={po.supplier_name} invoices={payNew.invoices} advances={payNew.advances} preselect={po.id} today={todayDubai} paidFromWords={paidFromWords} proofScope={po.id} />
                ) : (
                  <form action={markSupplierPaid.bind(null, po.id)} className="flex flex-col gap-3" data-pay-form>
                    <div data-pay-method>
                      <span className="text-xs font-semibold text-muted">How was it paid?</span>
                      <ChoiceButtons name="method" defaultValue="transfer" columns={4} options={SUPPLIER_PAY_METHODS.map((m) => ({ value: m.key, label: m.label }))} />
                      <p className="text-xs text-muted pt-1">Paid from in Zoho — {paidFromWords}</p>
                    </div>
                    <label className="flex flex-col gap-1 max-w-md"><span className="text-xs font-semibold text-muted">Payment reference (optional)</span><Input name="reference" placeholder="transfer ref, cheque no…" /></label>
                    {/* The proof sits apart from the money button, so a tap on one is never a tap on the other (B3). */}
                    <div className="flex flex-col gap-1 rounded-control border border-dashed border-line-strong p-3" data-pay-proof-area>
                      <span className="text-xs font-semibold text-muted">Proof (bank slip, card slip, receipt) – optional now, or add it later</span>
                      <SupplierProofUpload poId={po.id} inForm />
                    </div>
                    <div className="border-t border-line pt-3">
                      <ConfirmSubmit label="Paid to supplier" title="Record the payment to the supplier?" lines={[`Record payment to ${po.supplier_name}`, `invoice ${po.supplier_invoice_number ?? ""}`, payWords]} live={[{ field: "method" }, { label: "ref", field: "reference" }, { field: "proof_path", proof: true }]} confirmLabel="Yes, record payment" hook="supplier-paid" />
                    </div>
                  </form>
                )
              ) : (
                <p className="text-xs text-muted">Accounts mark it paid once the number, the date and the scan are on file.</p>
              )}
            </Card>
          ) : null}
          {(po.status === "received" || po.status === "partly_received") && po.job_id ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel>Next for the workshop</SectionLabel>
              {/* Section 8 (6 November 2026): this LPO's labels as the 50 × 25 mm PDF, one label a page; the sheet to pick fewer. */}
              <a href={`/api/pdf/part-labels?po=${po.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-lpo-labels-pdf>Print the QR labels</a>
              <LinkButton href={`/parts/labels/${po.job_id}`} tone="secondary" size="md">Pick which labels</LinkButton>
              {canManage ? <LinkButton href={`/parts/issue/${po.job_id}`} size="md">Issue the parts</LinkButton> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
