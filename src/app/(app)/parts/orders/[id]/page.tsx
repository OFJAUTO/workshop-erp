import Link from "next/link";
import { CopyVin } from "@/components/CopyVin";
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
import { loadJobLpos, lpoDiff, lpoProblemsFor, refusalReasonOf, refusalsReady } from "@/lib/lpo";
import { lpoProblemAdvice } from "@/lib/part-cost-check";
import { invoiceHref } from "@/lib/supplier-invoices";
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
import { decidePurchaseOrder, receivePurchaseOrder, supplierInvoice, decideInvoiceCheck, markSupplierPaid, refusePoLineAction, reverseSupplierPaid, undoSupplierPaid } from "../../order-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { UndoButton } from "@/components/UndoButton";
import { DEFAULT_UNDO_MINUTES, undoSecondsLeft } from "@/lib/money-undo";
import { InvoiceFiles } from "./InvoiceFiles";
import { emailSupplierLpo, markSupplierOrdered, setPartExpectedDate } from "../../lpo-actions";
import { gmailConfigured } from "@/lib/gmail";
import { SupplierLpoCard } from "../../SupplierLpoCard";
import { DecideForm, ReceiveForm, SupplierInvoiceForm } from "./PoForms";
import { LpoSendControl } from "./LpoSendControl";
import { getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * One LPO. The main LPO (every supplier, grouped with a subtotal each and a grand total) is approved here with
 * one tap; its supplier LPOs (LPO-00012-1, -2, -3) are sent, marked ordered, received and invoiced here.
 */
export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("viewPurchaseOrders");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error } = await searchParams;
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
  const depositReceived = ((pays ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared")).reduce((a, p) => a + p.amount_aed, 0);
  const depositShort = depositRequired > 0 && depositReceived + 0.005 < depositRequired ? `Deposit AED ${depositRequired.toLocaleString("en-GB")} not received yet${depositReceived > 0 ? ` (AED ${depositReceived.toLocaleString("en-GB")} received so far)` : ""}. Quotation ${q?.number}.` : null;
  const canApprove = can(role, "approvePurchaseOrders") && (role === "owner" || staff.is_head_accountant) && !staff.viewingAs;
  const canManage = can(role, "managePurchaseOrders") && !staff.viewingAs;
  const canPay = (role === "owner" || role === "accounts") && !staff.viewingAs;
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
  const children = (lpos?.suppliers ?? []).filter((s) => s.po.parent_id === po.id);
  // Each line's unit (pieces, litres, sets) for the cards' "× 8 L" and the supplier copy.
  const unitOfPart = await partUnitsOf([...children.flatMap((s) => s.lines.map((l) => l.part_item_id)), ...bundle.lines.map((l) => l.part_item_id ?? "")]);
  // The main LPO while it waits: the lines grouped by supplier (the parts still point at it), a subtotal each.
  const groups = (() => {
    const m = new Map<string, typeof lines>();
    for (const l of lines) {
      const sup = (parts.find((p) => p.id === l.part_item_id)?.supplier ?? "").trim() || "Supplier";
      m.set(sup, [...(m.get(sup) ?? []), l]);
    }
    const chargesOf = (s: string) => bundle.charges.filter((c) => c.supplier_name.trim().toLowerCase() === s.toLowerCase());
    return Array.from(m.entries()).map(([supplier, ls]) => ({ supplier, lines: ls, charges: chargesOf(supplier), subtotal: ls.reduce((a, l) => a + l.quantity * l.unit_cost, 0) + chargesOf(supplier).reduce((a, c) => a + c.amount_aed, 0) }));
  })();
  const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  // B3: what "Paid to supplier" pays ("AED 1,092.00 (1,040.00 + VAT 52.00)") and the undo window.
  const payNet = Number(po.supplier_invoice_amount ?? po.total_cost_aed) || 0;
  const payVat = Math.round(payNet * 5) / 100;
  const payWords = `${money(payNet + payVat)} (${payNet.toLocaleString("en-GB", { minimumFractionDigits: 2 })} + VAT ${payVat.toLocaleString("en-GB", { minimumFractionDigits: 2 })})`;
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
  // A refused LPO is not a dead end: this page says so, and names the version that replaced it once Parts resend.
  const refusedHere = po.status === "cancelled" && /refused/i.test(String(po.notes ?? ""));
  const { data: replacedBy } = refusedHere && po.superseded_by ? await admin.from("purchase_orders").select("id, number").eq("id", po.superseded_by).maybeSingle() : { data: null };

  return (
    <>
      <PageHeader
        title={isMain ? `${po.number} · all suppliers` : `${po.number} · ${po.supplier_name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{v ? `${formatPlate(v)} · ${[v.make?.name, v.model?.name].filter(Boolean).join(" ")}` : ""}</span>
            <span>· {job?.job_number}</span>
            <Badge tone={po.status === "pending_approval" ? "amber" : po.status === "received" ? "green" : po.status === "cancelled" ? "neutral" : "ink"}>{isMain && po.status === "approved" ? "Approved" : PO_STATUS_LABELS[po.status]}</Badge>
            {po.supplier_invoice_status === "to_follow" ? <Badge tone="amber">Invoice missing</Badge> : null}
            {po.supplier_paid_at ? <Badge tone="green">Paid to supplier</Badge> : null}
            {!isMain && (po.supplier_invoice_status === "received" || po.supplier_invoice_status === "to_follow") && ["owner", "accounts", "parts"].includes(role) ? <Link href={invoiceHref(po)} className="text-sm font-bold underline underline-offset-4" data-lpo-invoice-link>{po.supplier_invoice_number ? `INV ${po.supplier_invoice_number}` : "Invoice"} in Supplier invoices</Link> : null}
          </span>
        }
        actions={
          <>
            <CopyVin vin={v?.vin} />
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
      {po.status === "pending_approval" ? <Notice tone="info">{isMain ? "Waiting for the owner or the head accountant. One Approve covers every supplier; one LPO per supplier is made at approval." : "Waiting for the owner or the head accountant. The PDF cannot be downloaded or sent before approval."}</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {isMain && children.length ? (
            <section className="flex flex-col gap-3" data-supplier-lpos>
              <SectionLabel right={`${children.length}`}>Supplier LPOs</SectionLabel>
              {children.map((s) => (
                <SupplierLpoCard key={s.po.id} po={{ id: s.po.id, number: s.po.number, supplier_name: s.po.supplier_name, status: s.po.status, ordered_at: s.po.ordered_at, verify_token: s.po.verify_token, sent_at: s.po.sent_at, emailed_at: s.po.emailed_at, emailed_to: s.po.emailed_to, total_cost_aed: s.po.total_cost_aed, lines: s.lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, positions: bundle.parts.find((x) => x.id === l.part_item_id)?.positions ?? null, unit: unitOfPart.get(l.part_item_id ?? "") ?? null, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })), charges: s.charges, ended: endedByPo.get(s.po.id) ?? [] }} vin={v?.vin ?? null} canManage={canManage} onOrdered={markSupplierOrdered.bind(null, s.po.id)} onSetDate={setPartExpectedDate} supplierEmail={supplierEmailOf.get(s.po.supplier_id ?? "") ?? null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, s.po.id)} jobId={po.job_id} />
              ))}
            </section>
          ) : null}

          {isMain && !children.length ? (
            <Card className="flex flex-col gap-3" data-main-lpo>
              <SectionLabel right={`${money(po.total_cost_aed)} before VAT`}>Parts by supplier</SectionLabel>
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
                  <div className="flex items-center justify-between rounded-control bg-chip px-3 py-1.5 text-sm"><span className="text-muted">Subtotal · {g.supplier}</span><span className="font-bold" data-lpo-subtotal>{money(g.subtotal)}</span></div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line pt-2 text-base"><span className="font-bold">Grand total before VAT</span><span className="font-extrabold" data-lpo-grand-total>{money(po.total_cost_aed)}</span></div>
              {canRefuseLine ? <p className="text-xs text-muted">One wrong line? Refuse just that line with its reason: Parts are told to replace it, and the replacement joins this LPO by itself.</p> : null}
              {po.notes ? <p className="text-sm whitespace-pre-wrap text-muted">{po.notes}</p> : null}
            </Card>
          ) : null}

          {!isMain ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel right={`${money(po.total_cost_aed)} before VAT`}>Lines</SectionLabel>
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
                      {changeWords(l) ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${l.invoice_check === "mismatch" || l.invoice_check === "disputed" ? "border border-red-bar text-red" : "border border-amber-bar bg-amber-soft text-amber"}`} data-price-change>{changeWords(l)}{l.invoice_check === "accepted" ? " · accepted" : l.invoice_check === "disputed" ? " · queried with the supplier" : l.invoice_check === "mismatch" ? " · waits for the owner" : ""}</span> : null}
                      {l.invoice_check === "mismatch" && role === "owner" && !staff.viewingAs ? (
                        <form action={decideInvoiceCheck.bind(null, l.id)} className="flex gap-1" data-invoice-check={l.id}>
                          <Button type="submit" name="decision" value="accept" size="md" data-price-ok>OK</Button>
                          <Button type="submit" name="decision" value="dispute" size="md" tone="secondary" data-price-query>Query with supplier</Button>
                        </form>
                      ) : null}
                      {part?.label_code ? <span className="ml-auto text-xs text-muted">label {part.label_code}</span> : null}
                      {part?.issue_status === "confirmed" ? <Badge tone="green">Issued</Badge> : null}
                      {endedOfLine.get(l.id) ? <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${endedOfLine.get(l.id)!.state === "return_pending" ? "border-amber-bar bg-amber-soft text-amber" : "border-line-strong text-ink"}`} data-lpo-line-ended={endedOfLine.get(l.id)!.state}>{endedOfLine.get(l.id)!.words}</span> : null}
                    </li>
                  );
                })}
                {cancelledHere.map((e) => (
                  <li key={e.lineId} className="py-2 flex flex-wrap items-center gap-2 text-muted" data-lpo-line-cancelled={e.lineId}>
                    <span className="font-semibold uppercase line-through">{e.description}</span>
                    {e.partNumber ? <span className="line-through">{e.partNumber}</span> : null}
                    <span className="line-through">× {e.quantity} at AED {e.unitCost.toFixed(2)}</span>
                    <span className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-bold text-ink">{e.words}</span>
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
                    <span className="rounded-full border border-red-bar px-2 py-0.5 text-[11px] font-bold text-red">Refused by {refusedBy.get(r.refused_by as string) ?? "the owner"}{r.refused_reason ? ` – ${r.refused_reason}` : ""}</span>
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
          {sentChanges.length && po.status === "pending_approval" ? (
            <Card className="flex flex-col gap-1 border-amber-bar" data-lpo-updated-note>
              <SectionLabel>Updated after sending</SectionLabel>
              <p className="text-sm">{sentChanges.slice(0, 10).join(" · ")}{sentChanges.length > 10 ? " · …" : ""}. The list and total above are the current ones.</p>
            </Card>
          ) : null}
          {po.status === "pending_approval" && canApprove ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Approve this LPO</SectionLabel>
              <DecideForm action={decidePurchaseOrder.bind(null, po.id)} problems={problemList.map((p) => p.words)} problemAdvice={problemAdvice} depositShort={depositShort} isOwner={role === "owner"} reasons={reasonsFor(settings, "deposit_override")} summary={[po.number, po.supplier_name, `${money(po.total_cost_aed)} before VAT`, `${lines.length} line${lines.length === 1 ? "" : "s"}`]} />
            </Card>
          ) : null}
          {!isMain && po.status === "approved" ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Send it, then Ordered</SectionLabel>
              <p className="text-sm text-muted">Copy the text or send the PDF to {po.supplier_name}, then press Ordered: the arrival dates follow from the availability entered at pricing, and any date can be changed with a tap.</p>
              <SupplierLpoCard po={{ id: po.id, number: po.number, supplier_name: po.supplier_name, status: po.status, ordered_at: po.ordered_at, verify_token: po.verify_token, sent_at: po.sent_at, emailed_at: po.emailed_at, emailed_to: po.emailed_to, total_cost_aed: po.total_cost_aed, lines: lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, positions: bundle.parts.find((x) => x.id === l.part_item_id)?.positions ?? null, unit: unitOfPart.get(l.part_item_id ?? "") ?? null, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })), charges: bundle.charges, ended: endedHere }} vin={v?.vin ?? null} canManage={canManage} onOrdered={markSupplierOrdered.bind(null, po.id)} onSetDate={setPartExpectedDate} supplierEmail={bundle.supplier?.email ?? null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, po.id)} jobId={po.job_id} />
            </Card>
          ) : null}
          {(po.status === "ordered" || po.status === "partly_received") && canManage ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Receive the delivery</SectionLabel>
              <ReceiveForm lines={formLines} action={receivePurchaseOrder.bind(null, po.id)} jobId={po.job_id} poId={po.id} askInvoice={po.supplier_invoice_status !== "received"} poTotal={po.total_cost_aed} />
            </Card>
          ) : null}
          {!isMain && po.status === "received" && canManage && po.supplier_invoice_status !== "received" ? (
            <Card className={`flex flex-col gap-2 ${po.supplier_invoice_status === "to_follow" ? "!border-amber-bar" : ""}`}>
              <SectionLabel>Supplier invoice{po.supplier_invoice_status === "to_follow" ? " · missing" : ""}</SectionLabel>
              {po.supplier_invoice_status === "to_follow" ? <p className="text-sm font-semibold text-amber-bar" data-invoice-missing>Invoice missing: chase {po.supplier_name} and enter the number and the date. Accounts see it on their list, and Parts get one reminder a day.</p> : null}
              <SupplierInvoiceForm jobId={po.job_id} poId={po.id} lines={formLines} action={supplierInvoice.bind(null, po.id)} poTotal={po.total_cost_aed} />
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
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
                { label: "Supplier invoice", value: po.supplier_invoice_status === "received" ? `${po.supplier_invoice_number}${po.supplier_invoice_date ? ` dated ${formatDate(po.supplier_invoice_date)}` : ""}${po.supplier_invoice_amount ? ` · AED ${po.supplier_invoice_amount.toFixed(2)}` : ""} · entered ${formatDateTime(po.supplier_invoice_at)}` : po.supplier_invoice_status === "to_follow" ? "Missing (to follow)" : null },
                { label: "Paid to supplier", value: po.supplier_paid_at ? `${formatDateTime(po.supplier_paid_at)} by ${po.supplier_paid_by ? (names.get(po.supplier_paid_by) ?? "") : ""}${po.supplier_paid_reference ? ` · ${po.supplier_paid_reference}` : ""}` : null },
                ...(po.parent_id ? [{ label: "Main LPO", value: <Link href={`/parts/orders/${po.parent_id}`} className="underline underline-offset-4 font-semibold">{po.number.replace(/-\d+$/, "")}</Link> }] : []),
                ...(scanUrl ? [{ label: "Scan", value: <a href={scanUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 font-semibold">Open the supplier invoice</a> }] : []),
              ]}
            />
          </Card>
          {/* The payment box of every supplier LPO, a stock order (no car) included: "Pay on the LPO" lands here. */}
          {!isMain && po.status !== "pending_approval" && po.status !== "cancelled" && (po.supplier_invoice_status !== "none" || invoiceFiles.length > 0 || po.status === "received") ? (
            <Card className="flex flex-col gap-3 scroll-mt-4" id="paid" data-supplier-pay>
              <SectionLabel>{po.job_id ? <>Invoice files &amp; payment</> : "Payment"}</SectionLabel>
              {po.job_id ? <InvoiceFiles jobId={po.job_id} poId={po.id} files={invoiceFiles} canEdit={canManage || canPay} /> : <p className="text-xs text-muted" data-stock-order-pay>Stock order (no car): the supplier invoice is the one entered when the order was received.</p>}
              {po.supplier_paid_at ? (
                <div className="flex flex-col gap-2">
                {!staff.viewingAs && (role === "owner" || po.supplier_paid_by === staff.id) ? <UndoButton at={po.supplier_paid_at} minutes={undoMinutes} done="Payment to the supplier recorded" action={undoSupplierPaid.bind(null, po.id)} /> : null}
                <div className="flex flex-wrap items-center gap-2" data-paid-line>
                  <p className="text-sm font-semibold">Paid to {po.supplier_name} · {paidMethodLabel} · {formatDateTime(po.supplier_paid_at)}{po.supplier_paid_reference ? ` · ${po.supplier_paid_reference}` : ""}</p>
                  {proofUrl ? (
                    <a href={proofUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-green underline underline-offset-4" data-paid-proof>Proof ✓</a>
                  ) : (
                    <span className="inline-flex items-center gap-2" data-paid-proof-missing>
                      <Badge tone="amber">Proof missing</Badge>
                      {canPay ? <SupplierProofUpload poId={po.id} /> : null}
                    </span>
                  )}
                </div>
                {canPay && undoSecondsLeft(po.supplier_paid_at, undoMinutes) <= 0 ? (
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
              <LinkButton href={`/parts/labels/${po.job_id}`} tone="secondary" size="md">Print the QR labels</LinkButton>
              {canManage ? <LinkButton href={`/parts/issue/${po.job_id}`} size="md">Issue the parts</LinkButton> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
