import "server-only";
import Link from "next/link";
import { invoicesNotReceived, olderWithoutInvoice, receiptsReady, retakesAsked } from "@/lib/receipts";
import { formatDate } from "@/lib/format";
import { Card, SectionLabel } from "./ui";
import { Words } from "./Words";

/**
 * "Invoices not received (n)" (13 November 2026) on the parts desk's and accounts' dashboards: receipts saved with
 * "Invoice comes later", oldest first, overdue in red. Below: "Older receipts without an invoice (n)" (received before
 * receipts existed: listed, never reminded) and, for the parts desk, the photos accounts asked them to retake.
 */
export async function InvoicesNotReceivedCard({ role }: { role: string }) {
  if (!(await receiptsReady())) return null;
  const [open, older, retakes] = await Promise.all([invoicesNotReceived(), olderWithoutInvoice(), role === "parts" ? retakesAsked() : Promise.resolve([])]);
  if (!open.length && !older.length && !retakes.length) return null;
  return (
    <Card className="flex flex-col gap-3" data-invoices-not-received>
      {retakes.length ? (
        <div className="flex flex-col gap-1" data-retakes>
          <SectionLabel>Photos to retake ({retakes.length})</SectionLabel>
          <ul className="flex flex-col gap-1">
            {retakes.map((r) => <li key={r.id}><Link className="text-sm font-semibold text-red underline" href={`/parts/orders/${r.poId}#receipts`} data-retake-row={r.id}><Words text={`${r.poNumber}: the delivery photo is unclear${r.note ? ` (${r.note})` : ""}`} /></Link></li>)}
          </ul>
        </div>
      ) : null}
      <SectionLabel>Invoices not received ({open.length})</SectionLabel>
      {open.length ? (
        <ul className="divide-y divide-line">
          {open.map((r) => (
            <li key={r.id} className="py-2" data-not-received-row={r.id} data-overdue={r.overdue ? "1" : "0"}>
              <Link href={`/parts/orders/${r.poId}#receipts`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-bold"><Words text={`${r.supplierName} · ${r.poNumber}`} /></span>
                <span className={`whitespace-nowrap text-xs font-bold ${r.overdue ? "text-red" : "text-amber-text"}`}>{r.tag}{r.overdue ? ` · ${r.daysLate} day${r.daysLate === 1 ? "" : "s"} OVERDUE` : ""}</span>
              </Link>
              <span className="text-xs text-muted">Received {formatDate(r.receivedAt)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">None: every receipt has its invoice number.</p>}
      {older.length ? (
        <details data-older-receipts>
          <summary className="cursor-pointer text-sm font-semibold">Older receipts without an invoice ({older.length}) · from before receipts were recorded, no reminders</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {older.slice(0, 50).map((o) => <li key={o.poId}><Link className="underline" href={`/parts/orders/${o.poId}`}><Words text={`${o.poNumber} · ${o.supplierName}${o.receivedAt ? ` · received ${formatDate(o.receivedAt)}` : ""}`} /></Link></li>)}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

/** The owner: the count only, no bell. */
export async function InvoicesNotReceivedCount() {
  if (!(await receiptsReady())) return null;
  const open = await invoicesNotReceived().catch(() => []);
  if (!open.length) return null;
  const late = open.filter((o) => o.overdue).length;
  return <p className="text-sm" data-invoices-not-received-count><b>Supplier invoices not received: {open.length}</b>{late ? <span className="text-red font-bold"> ({late} overdue)</span> : null}</p>;
}
