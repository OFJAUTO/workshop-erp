import Link from "next/link";
import { Badge, Card, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { loadStatement } from "@/lib/customer-statement";
import { signStatement } from "@/lib/statement-token";
import { StatementSend } from "@/components/StatementSend";
import { refuseRecord } from "@/lib/refusal";

export const dynamic = "force-dynamic";

const m = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The customer's statement (9 November 2026, Section 3): every open job's document, what was paid, what is due, the
 * payments (a cheque or transfer still waiting for the bank marked so), credit on the account and the balance. Sent by
 * WhatsApp or email as a link (always today's figures); tick proformas to send ONE bill for several cars.
 */
export default async function CustomerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("viewInvoices");
  const { id } = await params;
  const st = await loadStatement(id);
  if (!st) return refuseRecord("customer", id);
  const pdf = `/api/pdf/statement/${signStatement({ c: id, k: "statement" })}`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Statement · ${st.customer.name}`} subtitle={`As of ${formatDate(st.asOf)}`} actions={<><Link href={`/customers/${id}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Back to the customer</Link><a href={pdf} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-statement-view-pdf>View PDF</a></>} />
      <Card className="flex flex-col gap-2" data-statement>
        <SectionLabel right={m(st.totalDue)}>Open jobs and documents</SectionLabel>
        {st.docs.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {st.docs.map((d) => (
              <li key={(d.invoiceId ?? d.jobId ?? "") + d.title} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-statement-doc={d.docNumber ?? d.jobNumber ?? ""}>
                {d.jobId ? <Link href={`/jobs/${d.jobId}/invoice`} className="min-w-0 flex-1 font-semibold uppercase underline underline-offset-4">{d.title}</Link> : <span className="min-w-0 flex-1 font-semibold uppercase">{d.title}</span>}
                <Badge tone="neutral">{d.docNumber ?? "approved, no proforma yet"}</Badge>
                <span className="text-muted">total {d.total === null ? "–" : m(d.total)} · paid {m(d.paid)}</span>
                <span className="font-bold">{m(d.balance)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Nothing open.</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-sm">
          <span className="font-extrabold" data-statement-due>Total due {m(st.totalDue)}</span>
          {st.pending ? <span className="font-semibold text-amber-text" data-statement-pending>Waiting for the bank {m(st.pending)}</span> : null}
          {st.credit ? <span className="text-muted">Credit on account {m(st.credit)}</span> : null}
          <span className="font-semibold" data-statement-once-cleared>Balance once cleared {m(st.balanceOnceCleared)}</span>
        </div>
      </Card>
      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${st.payments.length}`}>Payments</SectionLabel>
        {st.payments.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {st.payments.map((p) => (
              <li key={p.number} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-statement-payment={p.number}>
                <span className="font-semibold">{p.number}</span>
                <span className="text-muted">{formatDate(p.receivedAt)} · {p.method}{p.what ? ` · ${p.what}` : ""}</span>
                {p.pending ? <Badge tone="amber">Waiting for the bank</Badge> : null}
                <span className="ml-auto font-semibold">{m(p.amount)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No payments on the open jobs.</p>}
      </Card>
      <Card className="flex flex-col gap-2">
        <SectionLabel>Send</SectionLabel>
        <StatementSend customerId={id} canSend={!staff.viewingAs} proformas={st.docs.filter((d) => d.kind === "proforma" && d.invoiceId).map((d) => ({ invoiceId: d.invoiceId!, label: `${d.title} · ${d.docNumber} · ${m(d.balance)}` }))} />
      </Card>
    </div>
  );
}
