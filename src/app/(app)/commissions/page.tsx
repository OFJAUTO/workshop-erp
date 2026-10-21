import { redirect } from "next/navigation";
import { Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { loadCommissions, type CommissionRow } from "@/lib/commissions";
import { formatDate, formatDayTime } from "@/lib/format";
import { signJobFiles } from "@/lib/work-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideCommissionAt, editCommissionAt, payCommissions } from "./actions";
import { PayPanel } from "./PayPanel";
import { ProofUpload } from "./ProofUpload";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Line({ r, isOwner, proofUrl }: { r: CommissionRow; isOwner: boolean; proofUrl?: string | null }) {
  return (
    <li className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" data-commission-row={r.quotation}>
      <span className="font-bold">{r.recipient}</span>
      {r.phone ? <a href={`https://wa.me/${r.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer" className="text-xs font-semibold underline underline-offset-4">{r.phone}</a> : null}
      <span className="text-muted">{r.jobNumber} · {r.plate}{r.carTitle ? ` · ${r.carTitle}` : ""}</span>
      <span className="text-xs text-muted">{r.quotation} v{r.version}{r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}</span>
      {r.status !== "paid" ? <Badge tone={r.customerPaid ? "green" : "amber"}>{r.customerPaid ? "Customer paid" : r.customerPaidWhy}</Badge> : null}
      {r.creditNotes ? <Badge tone="red">Credit note on this job</Badge> : null}
      <span className="ml-auto font-extrabold">{aed(r.amount)}</span>
      <span className="text-xs text-muted">added by {r.setByName ?? "—"}{r.setAt ? ` · ${formatDayTime(r.setAt)}` : ""}</span>
      {r.status === "pending" && isOwner ? (
        <span className="flex flex-wrap items-center gap-2" data-commission-decide={r.quotation}>
          <form action={decideCommissionAt.bind(null, r.quotationId)}><input type="hidden" name="decision" value="approve" /><Button type="submit" size="md" data-approve-commission>Approve</Button></form>
          <details className="relative">
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold">Reject / Edit</summary>
            <div className="absolute right-0 z-10 mt-1 w-72 rounded-card border border-line bg-white p-3 flex flex-col gap-2 shadow-xl">
              <form action={decideCommissionAt.bind(null, r.quotationId)} className="flex flex-col gap-2">
                <input type="hidden" name="decision" value="decline" />
                <Textarea name="note" rows={2} required placeholder="Why not? (the person who added it is told)" />
                <Button type="submit" size="md" tone="secondary" data-reject-commission>Reject</Button>
              </form>
              <form action={editCommissionAt.bind(null, r.quotationId)} className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
                <input type="hidden" name="to" value={r.recipient} />
                <input type="hidden" name="kind" value="aed" />
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">New amount (AED)</span><Input name="value" inputMode="decimal" defaultValue={String(r.amount)} className="w-28 text-right" /></label>
                <Button type="submit" size="md" data-edit-commission>Change</Button>
              </form>
            </div>
          </details>
        </span>
      ) : null}
      {r.status === "paid" ? (
        <span className="flex w-full flex-wrap items-center gap-2 text-xs" data-paid-line>
          <span className="font-semibold text-green">Paid {r.paidOn ? formatDate(`${r.paidOn}T12:00:00+04:00`) : r.paidAt ? formatDayTime(r.paidAt) : ""} by {r.paidByName ?? "—"} · {r.paidMethod === "transfer" ? "bank transfer" : r.paidMethod ?? ""}{r.reference ? ` · ref ${r.reference}` : ""}</span>
          {r.voucherNumber ? <span className="font-semibold">{r.voucherNumber}</span> : null}
          {r.voucherId ? <a href={`/api/pdf/commission-voucher/${r.voucherId}`} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4" data-print-voucher>Print voucher</a> : null}
          {r.proofMissing && r.voucherId ? (
            <>
              <span data-proof-missing><Badge tone="amber">Paid – proof missing</Badge></span>
              <ProofUpload paymentId={r.voucherId} label={r.paidMethod === "transfer" ? "Upload bank slip" : "Upload signed voucher"} />
            </>
          ) : proofUrl ? (
            <a href={proofUrl} target="_blank" rel="noreferrer" className="font-bold text-green underline underline-offset-4" data-proof-link>Proof ✓</a>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

/** Commissions, accounts and the owner only: Pending → Ready to pay / Waiting for the customer → Paid (with proof). */
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; voucher?: string }> }) {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts")) redirect("/dashboard");
  const sp = await searchParams;
  const { pending, ready, waiting, paid } = await loadCommissions();
  const isOwner = staff.role_id === "owner";
  const canPay = !staff.viewingAs;
  const proofUrls = await signJobFiles(paid.map((r) => r.proofPath).filter((x): x is string => !!x));
  // The voucher just created: its print link and the upload sit right at the top until the signed copy is in.
  const { data: fresh } = sp.voucher ? await createAdminClient().from("commission_payments").select("id, number, method, recipient, proof_path").eq("id", sp.voucher).maybeSingle() : { data: null };
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const month = new Date(now + 4 * 3600000).toISOString().slice(0, 7);
  const today = new Date(now + 4 * 3600000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Commissions" subtitle="Who gets what, approved by the owner, paid by accounts only once the customer's invoice is settled — cash with a signed voucher, transfers with their slip." actions={<LinkButton href={`/api/export/commissions?month=${month}`} tone="secondary" size="lg">Export month (.xlsx)</LinkButton>} />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {fresh ? (
        <Card className="flex flex-wrap items-center gap-3 border-amber-bar" data-fresh-voucher>
          <span className="text-sm font-bold">{fresh.number} · {fresh.recipient}</span>
          <a href={`/api/pdf/commission-voucher/${fresh.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white" data-print-voucher-fresh>Print voucher</a>
          {!fresh.proof_path ? <ProofUpload paymentId={fresh.id} label={fresh.method === "transfer" ? "Upload bank slip" : "Upload signed voucher"} /> : <Badge tone="green">Proof ✓</Badge>}
          <span className="text-xs text-muted">{fresh.method === "cash" ? "Print → sign (received by, accounts, owner) → upload the signed copy." : "Upload the bank PDF or screenshot with the reference."}</span>
        </Card>
      ) : null}
      {pending.length ? (
        <Card className="flex flex-col gap-1 border-amber-bar" data-commissions-pending>
          <SectionLabel right={`${pending.length}`}>Pending owner approval</SectionLabel>
          <ul className="divide-y divide-line">{pending.map((r) => <Line key={r.quotationId} r={r} isOwner={isOwner} />)}</ul>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-1" data-commissions-ready>
        <SectionLabel right={`${ready.length}`}>Ready to pay (customer paid)</SectionLabel>
        {ready.length === 0 ? (
          <p className="text-sm text-muted">Nothing ready. A commission lands here once the owner approved it and the customer&apos;s invoice is settled.</p>
        ) : canPay ? (
          <PayPanel rows={ready.map((r) => ({ quotationId: r.quotationId, recipient: r.recipient, amount: r.amount, label: r.quotation, sub: `${r.jobNumber} · ${r.plate}${r.carTitle ? ` · ${r.carTitle}` : ""} · ${r.quotation} v${r.version}${r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}` }))} action={payCommissions} today={today} isOwner={isOwner} />
        ) : (
          <ul className="divide-y divide-line">{ready.map((r) => <Line key={r.quotationId} r={r} isOwner={isOwner} />)}</ul>
        )}
      </Card>
      {waiting.length ? (
        <Card className="flex flex-col gap-1" data-commissions-waiting>
          <SectionLabel right={`${waiting.length}`}>Approved – waiting for the customer to pay</SectionLabel>
          <p className="text-xs text-muted">No tax invoice settled yet: nothing to pay here until the customer&apos;s money is in.</p>
          <ul className="divide-y divide-line">{waiting.map((r) => <Line key={r.quotationId} r={r} isOwner={isOwner} />)}</ul>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-1" data-commissions-paid>
        <SectionLabel right={`${paid.length}`}>Paid</SectionLabel>
        {paid.length === 0 ? <p className="text-sm text-muted">Nothing paid yet.</p> : <ul className="divide-y divide-line">{paid.slice(0, 60).map((r) => <Line key={r.quotationId} r={r} isOwner={isOwner} proofUrl={r.proofPath ? proofUrls[r.proofPath] : null} />)}</ul>}
      </Card>
    </>
  );
}
