import { redirect } from "next/navigation";
import { Badge, Button, Card, Input, LinkButton, Notice, PageHeader, SectionLabel, Textarea } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { loadCommissions, type CommissionRow } from "@/lib/commissions";
import { formatDayTime } from "@/lib/format";
import { decideCommissionAt, editCommissionAt, payCommissionAt } from "./actions";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Line({ r, isOwner, canPay }: { r: CommissionRow; isOwner: boolean; canPay: boolean }) {
  return (
    <li className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" data-commission-row={r.quotation}>
      <span className="font-bold">{r.recipient}</span>
      {r.phone ? <a href={`https://wa.me/${r.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer" className="text-xs font-semibold underline underline-offset-4">{r.phone}</a> : null}
      <span className="text-muted">{r.jobNumber} · {r.plate}{r.carTitle ? ` · ${r.carTitle}` : ""}</span>
      <span className="text-xs text-muted">{r.quotation} v{r.version}{r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}</span>
      <Badge tone={r.customerPaid ? "green" : "amber"}>{r.customerPaid ? "Customer paid" : r.customerPaidWhy}</Badge>
      {r.creditNotes ? <Badge tone="red">Credit note on this job</Badge> : null}
      <span className="ml-auto font-extrabold">{aed(r.amount)}</span>
      <span className="text-xs text-muted">added by {r.setByName ?? "?"}{r.setAt ? ` · ${formatDayTime(r.setAt)}` : ""}</span>
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
      {r.status === "approved" ? (
        r.customerPaid && canPay ? (
          <details className="relative" data-pay-commission={r.quotation}>
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-control bg-ink px-4 text-sm font-bold text-white">Mark paid</summary>
            <div className="absolute right-0 z-10 mt-1 w-72 rounded-card border border-line bg-white p-3 shadow-xl">
              <form action={payCommissionAt.bind(null, r.quotationId)} className="flex flex-col gap-2">
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">How</span>
                  <select name="method" required className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm font-semibold">
                    <option value="">Pick…</option>
                    <option value="cash">Cash</option>
                    <option value="transfer">Bank transfer</option>
                    <option value="deducted">Deducted / set off</option>
                  </select>
                </label>
                <Input name="note" placeholder="Note (optional): reference, date…" />
                <Button type="submit" size="md" data-pay-commission-save>Paid</Button>
              </form>
            </div>
          </details>
        ) : (
          <span className="text-xs font-semibold text-amber-bar" data-pay-blocked-why>{r.customerPaid ? "Accounts or the owner mark it paid" : `Not payable yet: ${r.customerPaidWhy}`}</span>
        )
      ) : null}
      {r.status === "paid" ? <span className="text-xs font-semibold text-green" data-paid-line>Paid {r.paidAt ? formatDayTime(r.paidAt) : ""} by {r.paidByName ?? "?"}{r.paidMethod ? ` · ${r.paidMethod}` : ""}{r.paidNote ? ` · ${r.paidNote}` : ""}</span> : null}
    </li>
  );
}

/** Commissions, accounts and the owner only: Pending owner approval → Approved, to pay → Paid. */
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts")) redirect("/dashboard");
  const sp = await searchParams;
  const { pending, toPay, paid } = await loadCommissions();
  const isOwner = staff.role_id === "owner";
  const canPay = !staff.viewingAs;
  // eslint-disable-next-line react-hooks/purity
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  return (
    <>
      <PageHeader title="Commissions" subtitle="Who gets what, approved by the owner, paid by accounts only once the customer's invoice is settled." actions={<LinkButton href={`/api/export/commissions?month=${month}`} tone="secondary" size="lg">Export month (.xlsx)</LinkButton>} />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {pending.length ? (
        <Card className="flex flex-col gap-1 border-amber-bar" data-commissions-pending>
          <SectionLabel right={`${pending.length}`}>Pending owner approval</SectionLabel>
          <ul className="divide-y divide-line">{pending.map((r) => <Line key={r.quotationId} r={r} isOwner={isOwner} canPay={canPay} />)}</ul>
        </Card>
      ) : null}
      {toPay.length ? (
        <Card className="flex flex-col gap-1" data-commissions-topay>
          <SectionLabel right={`${toPay.length}`}>Approved, to pay</SectionLabel>
          <ul className="divide-y divide-line">{toPay.map((r) => <Line key={r.quotationId} r={r} isOwner={isOwner} canPay={canPay} />)}</ul>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-1" data-commissions-paid>
        <SectionLabel right={`${paid.length}`}>Paid</SectionLabel>
        {paid.length === 0 ? <p className="text-sm text-muted">Nothing paid yet.</p> : <ul className="divide-y divide-line">{paid.slice(0, 60).map((r) => <Line key={r.quotationId} r={r} isOwner={isOwner} canPay={canPay} />)}</ul>}
      </Card>
    </>
  );
}
