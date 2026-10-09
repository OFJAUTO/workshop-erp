import { notFound } from "next/navigation";
import { Badge, Card, DescriptionList, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { PAYMENT_SELECT, toPayment } from "@/lib/invoice-data";
import { PO_STATUS_LABELS, loadPurchaseOrder } from "@/lib/parts-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { signJobFiles } from "@/lib/work-data";
import { decidePurchaseOrder, markOrdered, receivePurchaseOrder, supplierInvoice } from "../../order-actions";
import { DecideForm, OrderedForm, ReceiveForm, SupplierInvoiceForm } from "./PoForms";

export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

/** One purchase order: approve, send, mark ordered, receive, supplier invoice, labels and issue. */
export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requirePermission("viewPurchaseOrders");
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error } = await searchParams;
  const bundle = await loadPurchaseOrder(id);
  if (!bundle) notFound();
  const { po, lines, job, names, parts } = bundle;
  const admin = createAdminClient();
  const [{ data: q }, { data: pays }] = await Promise.all([
    admin.from("quotations").select("deposit_aed, number").eq("job_id", po.job_id).eq("kind", "quotation").eq("status", "approved").eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("payments").select(PAYMENT_SELECT).eq("job_id", po.job_id).eq("is_active", true),
  ]);
  const depositRequired = Number(q?.deposit_aed) || 0;
  const depositReceived = ((pays ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared")).reduce((a, p) => a + p.amount_aed, 0);
  const depositShort = depositRequired > 0 && depositReceived + 0.005 < depositRequired ? `Quotation ${q?.number} needs a deposit of AED ${depositRequired.toLocaleString("en-GB")}; AED ${depositReceived.toLocaleString("en-GB")} received. Record the deposit first.` : null;
  const canApprove = can(role, "approvePurchaseOrders") && (role === "owner" || staff.is_head_accountant) && !staff.viewingAs;
  const canManage = can(role, "managePurchaseOrders") && !staff.viewingAs;
  const scanUrl = po.supplier_invoice_path ? (await signJobFiles([po.supplier_invoice_path]))[po.supplier_invoice_path] : null;
  const today = todayIso();
  const formLines = lines.map((l) => ({ id: l.id, description: l.description, part_number: l.part_number, quantity: l.quantity, received_qty: l.received_qty, unit_cost: l.unit_cost, flag: l.flag }));
  const v = job?.vehicle;

  return (
    <>
      <PageHeader
        title={`${po.number} · ${po.supplier_name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{v ? `${formatPlate(v)} · ${[v.make?.name, v.model?.name].filter(Boolean).join(" ")}` : ""}</span>
            <span>· {job?.job_number}</span>
            <Badge tone={po.status === "pending_approval" ? "amber" : po.status === "received" ? "green" : po.status === "cancelled" ? "neutral" : "ink"}>{PO_STATUS_LABELS[po.status]}</Badge>
            {po.supplier_invoice_status === "to_follow" ? <Badge tone="red">Supplier invoice to follow</Badge> : null}
          </span>
        }
        actions={
          <>
            <LinkButton href="/parts/orders" tone="secondary" size="lg">All orders</LinkButton>
            {job ? <LinkButton href={`/jobs/${job.id}`} tone="secondary" size="lg">Job card</LinkButton> : null}
            {po.status !== "pending_approval" && po.status !== "cancelled" ? (
              <a href={`/api/pdf/po/${po.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap bg-ink text-white hover:bg-black min-h-14 px-6 text-base">PO PDF</a>
            ) : null}
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {po.status === "pending_approval" ? <Notice tone="info">Waiting for the owner or the head accountant. The PDF cannot be downloaded or sent before approval.</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <SectionLabel right={`AED ${po.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })} before VAT`}>Lines</SectionLabel>
            <ul className="divide-y divide-line text-sm">
              {lines.map((l) => {
                const part = parts.find((p) => p.id === l.part_item_id);
                const late = l.expected_date && l.expected_date < today && l.received_qty < l.quantity;
                return (
                  <li key={l.id} className="py-2 flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{l.description}</span>
                    {l.part_number ? <span className="text-muted">{l.part_number}</span> : null}
                    <span className="text-muted">× {l.quantity} at AED {l.unit_cost.toFixed(2)}</span>
                    {l.expected_date ? <Badge tone={late ? "red" : "neutral"}>{late ? "Late, " : ""}expected {formatDate(l.expected_date)}</Badge> : null}
                    {l.received_qty > 0 ? <Badge tone={l.received_qty >= l.quantity ? "green" : "amber"}>received {l.received_qty}</Badge> : null}
                    {l.flag ? <Badge tone="red">{l.flag === "wrong" ? "Wrong part" : "Damaged"}: {l.flag_note}</Badge> : null}
                    {l.invoice_unit_cost !== null && Math.abs(l.invoice_unit_cost - l.unit_cost) > 0.005 ? <Badge tone="amber">Invoice price {l.invoice_unit_cost.toFixed(2)}</Badge> : null}
                    {part?.label_code ? <span className="ml-auto text-xs text-muted">label {part.label_code}</span> : null}
                    {part?.issue_status === "confirmed" ? <Badge tone="green">Issued</Badge> : null}
                  </li>
                );
              })}
            </ul>
            {po.notes ? <p className="text-sm whitespace-pre-wrap text-muted">{po.notes}</p> : null}
          </Card>

          {po.status === "pending_approval" && canApprove ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Approve this purchase order</SectionLabel>
              <DecideForm action={decidePurchaseOrder.bind(null, po.id)} depositShort={depositShort} isOwner={role === "owner"} />
            </Card>
          ) : null}
          {po.status === "approved" && canManage ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Send it, then mark ordered</SectionLabel>
              <p className="text-sm text-muted">Download the PO PDF and send it to {po.supplier_name}. Then enter the expected date per line.</p>
              <OrderedForm lines={formLines} action={markOrdered.bind(null, po.id)} />
            </Card>
          ) : null}
          {(po.status === "ordered" || po.status === "partly_received") && canManage ? (
            <Card className="flex flex-col gap-2 border-ink">
              <SectionLabel>Receive the delivery</SectionLabel>
              <ReceiveForm lines={formLines} action={receivePurchaseOrder.bind(null, po.id)} />
            </Card>
          ) : null}
          {po.status !== "pending_approval" && po.status !== "cancelled" && po.status !== "approved" && canManage && po.supplier_invoice_status !== "received" ? (
            <Card className={`flex flex-col gap-2 ${po.supplier_invoice_status === "to_follow" ? "border-red-bar" : ""}`}>
              <SectionLabel>Supplier invoice</SectionLabel>
              <SupplierInvoiceForm jobId={po.job_id} poId={po.id} lines={formLines} action={supplierInvoice.bind(null, po.id)} />
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <SectionLabel>Record</SectionLabel>
            <DescriptionList
              items={[
                { label: "Raised", value: `${formatDateTime(po.created_at)} by ${po.created_by ? (names.get(po.created_by) ?? "") : ""}` },
                { label: "Approved", value: po.approved_at ? `${formatDateTime(po.approved_at)} by ${po.approved_by ? (names.get(po.approved_by) ?? "") : ""}` : null },
                { label: "Deposit override", value: po.deposit_override_reason },
                { label: "Ordered", value: po.ordered_at ? `${formatDateTime(po.ordered_at)} by ${po.ordered_by ? (names.get(po.ordered_by) ?? "") : ""}` : null },
                { label: "Received", value: po.received_at ? formatDateTime(po.received_at) : null },
                { label: "Supplier invoice", value: po.supplier_invoice_status === "received" ? `${po.supplier_invoice_number}${po.supplier_invoice_amount ? ` · AED ${po.supplier_invoice_amount.toFixed(2)}` : ""} · ${formatDateTime(po.supplier_invoice_at)}` : po.supplier_invoice_status === "to_follow" ? "To follow" : null },
                ...(scanUrl ? [{ label: "Scan", value: <a href={scanUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 font-semibold">Open the supplier invoice</a> }] : []),
              ]}
            />
          </Card>
          {po.status === "received" || po.status === "partly_received" ? (
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
