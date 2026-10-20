import Link from "next/link";
import { CopyVin } from "@/components/CopyVin";
import { approvedQuotations } from "@/lib/quote-data";
import { notFound } from "next/navigation";
import { Badge, Button, Card, DescriptionList, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { PAYMENT_SELECT, toPayment } from "@/lib/invoice-data";
import { loadJobLpos } from "@/lib/lpo";
import { PO_STATUS_LABELS, loadPurchaseOrder } from "@/lib/parts-data";
import { partTypeText } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { reasonsFor } from "@/lib/reasons";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { signJobFiles } from "@/lib/work-data";
import { decidePurchaseOrder, receivePurchaseOrder, supplierInvoice, decideInvoiceCheck, markSupplierPaid } from "../../order-actions";
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
  // The main LPO while it waits: the lines grouped by supplier (the parts still point at it), a subtotal each.
  const groups = (() => {
    const m = new Map<string, typeof lines>();
    for (const l of lines) {
      const sup = (parts.find((p) => p.id === l.part_item_id)?.supplier ?? "").trim() || "Supplier";
      m.set(sup, [...(m.get(sup) ?? []), l]);
    }
    return Array.from(m.entries()).map(([supplier, ls]) => ({ supplier, lines: ls, subtotal: ls.reduce((a, l) => a + l.quantity * l.unit_cost, 0) }));
  })();
  const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

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
      {po.status === "pending_approval" ? <Notice tone="info">{isMain ? "Waiting for the owner or the head accountant. One Approve covers every supplier; one LPO per supplier is made at approval." : "Waiting for the owner or the head accountant. The PDF cannot be downloaded or sent before approval."}</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          {isMain && children.length ? (
            <section className="flex flex-col gap-3" data-supplier-lpos>
              <SectionLabel right={`${children.length}`}>Supplier LPOs</SectionLabel>
              {children.map((s) => (
                <SupplierLpoCard key={s.po.id} po={{ id: s.po.id, number: s.po.number, supplier_name: s.po.supplier_name, status: s.po.status, ordered_at: s.po.ordered_at, verify_token: s.po.verify_token, sent_at: s.po.sent_at, emailed_at: s.po.emailed_at, emailed_to: s.po.emailed_to, total_cost_aed: s.po.total_cost_aed, lines: s.lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })) }} vin={v?.vin ?? null} canManage={canManage} onOrdered={markSupplierOrdered.bind(null, s.po.id)} onSetDate={setPartExpectedDate} supplierEmail={supplierEmailOf.get(s.po.supplier_id ?? "") ?? null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, s.po.id)} jobId={po.job_id} />
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
                        <span className="font-semibold uppercase">{l.description}</span>
                        {typeOf(l.part_item_id) ? <Badge tone="outline">{typeOf(l.part_item_id)}</Badge> : null}
                        {l.part_number ? <span className="text-muted">{l.part_number}</span> : null}
                        <span className="text-muted">× {l.quantity} at {money(l.unit_cost)}</span>
                        <span className="ml-auto font-semibold">{money(l.quantity * l.unit_cost)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between rounded-control bg-chip px-3 py-1.5 text-sm"><span className="text-muted">Subtotal · {g.supplier}</span><span className="font-bold" data-lpo-subtotal>{money(g.subtotal)}</span></div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line pt-2 text-base"><span className="font-bold">Grand total before VAT</span><span className="font-extrabold" data-lpo-grand-total>{money(po.total_cost_aed)}</span></div>
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
                      <span className="font-semibold uppercase">{l.description}</span>
                      {typeOf(l.part_item_id) ? <Badge tone="outline">{typeOf(l.part_item_id)}</Badge> : null}
                      {l.part_number ? <span className="text-muted">{l.part_number}</span> : null}
                      <span className="text-muted">× {l.quantity} at AED {l.unit_cost.toFixed(2)}</span>
                      {l.expected_date ? <Badge tone={late ? "red" : "neutral"}>{late ? "Late, " : ""}expected {formatDate(l.expected_date)}</Badge> : null}
                      {l.received_qty > 0 ? <Badge tone={l.received_qty >= l.quantity ? "green" : "amber"}>received {l.received_qty}</Badge> : null}
                      {l.flag ? <Badge tone="red">{l.flag === "wrong" ? "Wrong part" : "Damaged"}: {l.flag_note}</Badge> : null}
                      {l.invoice_unit_cost !== null && Math.abs(l.invoice_unit_cost - l.unit_cost) > 0.005 ? <Badge tone={l.invoice_check === "mismatch" || l.invoice_check === "disputed" ? "red" : "amber"}>Invoice price {l.invoice_unit_cost.toFixed(2)}{l.invoice_check === "accepted" ? " · accepted" : l.invoice_check === "disputed" ? " · disputed" : ""}</Badge> : null}
                      {l.invoice_check === "mismatch" && (role === "owner" || role === "accounts" || canManage) && !staff.viewingAs ? (
                        <form action={decideInvoiceCheck.bind(null, l.id)} className="flex gap-1" data-invoice-check={l.id}>
                          <Button type="submit" name="decision" value="accept" size="md">Accept new price</Button>
                          <Button type="submit" name="decision" value="dispute" size="md" tone="secondary">Dispute</Button>
                        </form>
                      ) : null}
                      {part?.label_code ? <span className="ml-auto text-xs text-muted">label {part.label_code}</span> : null}
                      {part?.issue_status === "confirmed" ? <Badge tone="green">Issued</Badge> : null}
                    </li>
                  );
                })}
              </ul>
              {po.notes ? <p className="text-sm whitespace-pre-wrap text-muted">{po.notes}</p> : null}
            </Card>
          ) : null}

          {po.status === "pending_approval" && canApprove ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Approve this LPO</SectionLabel>
              <DecideForm action={decidePurchaseOrder.bind(null, po.id)} depositShort={depositShort} isOwner={role === "owner"} reasons={reasonsFor(settings, "deposit_override")} />
            </Card>
          ) : null}
          {!isMain && po.status === "approved" ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Send it, then Ordered</SectionLabel>
              <p className="text-sm text-muted">Copy the text or send the PDF to {po.supplier_name}, then press Ordered: the arrival dates follow from the availability entered at pricing, and any date can be changed with a tap.</p>
              <SupplierLpoCard po={{ id: po.id, number: po.number, supplier_name: po.supplier_name, status: po.status, ordered_at: po.ordered_at, verify_token: po.verify_token, sent_at: po.sent_at, emailed_at: po.emailed_at, emailed_to: po.emailed_to, total_cost_aed: po.total_cost_aed, lines: lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })) }} vin={v?.vin ?? null} canManage={canManage} onOrdered={markSupplierOrdered.bind(null, po.id)} onSetDate={setPartExpectedDate} supplierEmail={bundle.supplier?.email ?? null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, po.id)} jobId={po.job_id} />
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
          {!isMain && po.job_id && po.status !== "pending_approval" && po.status !== "cancelled" && (po.supplier_invoice_status !== "none" || invoiceFiles.length > 0 || po.status === "received") ? (
            <Card className="flex flex-col gap-3" data-supplier-pay>
              <SectionLabel>Invoice files &amp; payment</SectionLabel>
              <InvoiceFiles jobId={po.job_id} poId={po.id} files={invoiceFiles} canEdit={canManage || canPay} />
              {po.supplier_paid_at ? (
                <p className="text-sm font-semibold" data-paid-line>Paid to {po.supplier_name} · {formatDateTime(po.supplier_paid_at)}{po.supplier_paid_reference ? ` · ${po.supplier_paid_reference}` : ""}</p>
              ) : canPay ? (
                payMissing.length ? (
                  <p className="text-sm font-semibold text-amber-bar" data-pay-blocked>Cannot be marked paid yet: {payMissing.join(", ")} first. No payment without the full invoice on file.</p>
                ) : (
                  <form action={markSupplierPaid.bind(null, po.id)} className="flex flex-wrap items-end gap-2" data-pay-form>
                    <label className="flex flex-col gap-1 flex-1 min-w-40"><span className="text-xs font-semibold text-muted">Payment reference (optional)</span><Input name="reference" placeholder="transfer ref, cheque no…" /></label>
                    <Button type="submit" size="md" data-mark-supplier-paid>Paid to supplier</Button>
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
