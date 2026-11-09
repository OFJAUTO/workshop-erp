import { Logo } from "@/components/Logo";
import { formatDate } from "@/lib/format";
import { customerPageMetadata } from "@/lib/customer-pages";
import { loadStatement } from "@/lib/customer-statement";
import { readStatement } from "@/lib/statement-token";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = readStatement(token);
  return customerPageMetadata(g?.k === "combined" ? "OFJ Automotive – Combined proforma" : "OFJ Automotive – Statement of account", g?.k === "combined" ? "One bill for your cars with us" : "Your open invoices, payments and balance", `/statement/${token}`);
}

const m = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The customer's statement or combined bill (9 November 2026, Section 3), from its signed link: always today's figures.
 * The PDF opens from the button; a combined bill carries the payment link pasted when it was sent.
 */
export default async function StatementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = readStatement(token);
  const st = g ? await loadStatement(g.c, { docIds: g.k === "combined" ? (g.d ?? []) : undefined, withLines: g.k === "combined" }) : null;
  const combined = g?.k === "combined";
  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto max-w-xl px-4 py-8 flex flex-col gap-4">
        <div className="flex justify-center"><Logo className="h-12" /></div>
        <div className="rounded-card border border-line bg-white p-5 flex flex-col gap-3" data-statement-page>
          <span className="text-xs font-bold tracking-[0.1em] uppercase text-muted">{combined ? "Combined proforma" : "Statement of account"}</span>
          {!st || !g ? (
            <p className="text-sm font-semibold text-red">This link is not valid any more. Ask OFJ for a new one.</p>
          ) : (
            <>
              <span className="text-xl font-extrabold">{st.customer.name}</span>
              <span className="text-xs text-muted">As of {formatDate(st.asOf)}</span>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {st.docs.map((d) => (
                  <li key={(d.invoiceId ?? d.jobId ?? "") + d.title} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-statement-doc={d.docNumber ?? d.jobNumber ?? ""}>
                    <span className="min-w-0 flex-1 font-semibold uppercase">{d.title}</span>
                    <span className="text-muted">{d.docNumber ?? "approved"}</span>
                    <span className="font-bold">{m(d.balance)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
                <span className="text-lg font-extrabold" data-statement-total>{combined ? "Total to pay" : "Total due"}: {m(st.totalDue)}</span>
                {!combined && st.pending ? <span className="text-amber-text font-semibold">Waiting for the bank: {m(st.pending)} · balance once cleared {m(st.balanceOnceCleared)}</span> : null}
                {!combined && st.credit ? <span className="text-muted">Credit on your account: {m(st.credit)}</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {combined && g.l ? <a href={g.l} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-on-dark" data-statement-pay>Pay now</a> : null}
                <a href={`/api/pdf/statement/${token}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-statement-pdf>View (PDF)</a>
              </div>
              {combined ? <p className="text-xs text-muted">Each car receives its own tax invoice once paid.</p> : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
