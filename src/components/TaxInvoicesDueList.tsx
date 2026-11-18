import Link from "next/link";
import { Words } from "@/components/Words";
import { Card, SectionLabel } from "@/components/ui";
import { missingTaxInvoices } from "@/lib/tax-invoice-due";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * "Tax invoices due" on the accounts dashboard (18 November 2026, Section 1): every completed job whose proforma is
 * still not a tax invoice after 10 days, or that could be issued now (paid in full, or covered by a cheque still
 * clearing), oldest first, each with its deadline and a link to its invoice page where "Issue tax invoice now" sits.
 */
export async function TaxInvoicesDueList() {
  const list = (await missingTaxInvoices()).filter((m) => m.due.warn || m.state !== "due");
  if (!list.length) return null;
  return (
    <Card className="flex flex-col gap-2 !border-red-bar" data-tax-due-list={list.length}>
      <SectionLabel>Tax invoices due · {list.length}</SectionLabel>
      <ul className="flex flex-col divide-y divide-line">
        {list.map((m) => (
          <li key={m.jobId} className="flex flex-col gap-0.5 py-2 text-sm" data-tax-due-row={m.jobNumber}>
            <Link href={`/jobs/${m.jobId}/invoice#tax-due`} className="font-semibold underline-offset-4 hover:underline"><Words text={`${m.jobNumber} · ${m.plate}${m.customer ? ` · ${m.customer}` : ""}`} /></Link>
            <span className={`text-xs font-extrabold ${m.due.warn ? "text-red" : "text-amber-text"}`}><Words text={m.due.words} /></span>
            <span className="text-xs text-muted"><Words text={`completed ${m.due.daysSince} day${m.due.daysSince === 1 ? "" : "s"} ago · ${m.proforma.number} ${aed(m.proforma.total)}`} /></span>
            <span className={`text-xs font-bold ${m.state === "due" ? "text-red" : m.state === "covered" ? "text-amber-text" : "text-green-text"}`}><Words text={m.asked ? "waiting for the owner" : m.state === "paid" ? "paid in full – issue now" : m.state === "covered" ? "cheque pending – issue now (owner approves)" : `${aed(Math.max(0, m.balance - m.pending))} still due`} /></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
