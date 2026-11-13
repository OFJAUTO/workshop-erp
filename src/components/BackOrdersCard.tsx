import "server-only";
import Link from "next/link";
import { loadBackOrderList } from "@/lib/back-orders";
import { Card, SectionLabel } from "./ui";
import { Words } from "./Words";

const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "no date");

/**
 * "Back orders (n)" (13 November 2026, J-00317): the parts fitted on a later visit, on the owner's, the advisor's and
 * the parts desk's dashboards: car, part, expected date, days overdue, paid by the customer yes or no.
 */
export async function BackOrdersCard({ advisorId = null, hrefOf = "job" }: { advisorId?: string | null; hrefOf?: "job" | "parts" }) {
  const rows = await loadBackOrderList({ advisorId }).catch(() => []);
  if (!rows.length) return null;
  return (
    <Card className="flex flex-col gap-3" data-back-orders-list>
      <SectionLabel>Back orders ({rows.length})</SectionLabel>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const href = r.status === "pending" ? `/jobs/${r.jobId}#back-orders` : hrefOf === "parts" && r.followJobId ? `/parts/${r.followJobId}` : `/jobs/${r.followJobId ?? r.jobId}#back-orders`;
          return (
            <li key={r.id} className="py-2" data-back-order-row={r.id} data-back-order-row-status={r.status}>
              <Link href={href} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 flex flex-col">
                  <span className="font-bold uppercase"><Words text={`${r.plate} · ${r.part}`} /></span>
                  <span className="text-xs text-muted"><Words text={`${r.car}${r.car ? " · " : ""}${r.followNumber ? `${r.followNumber} continues ${r.jobNumber}` : r.jobNumber} · ${r.words}`} /></span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="whitespace-nowrap" data-back-order-expected>Expected {day(r.expected)}</span>
                  {r.daysOverdue > 0 ? <span className="whitespace-nowrap font-bold text-red" data-back-order-overdue>{r.daysOverdue} day{r.daysOverdue === 1 ? "" : "s"} overdue</span> : null}
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${r.paidByCustomer ? "bg-green-soft text-green-text" : "bg-chip"}`} data-back-order-paid={r.paidByCustomer ? "yes" : "no"}>
                    {r.paidByCustomer ? "Paid by customer: yes" : r.paidByCustomer === false ? "Paid by customer: no" : "Paid by customer: not yet"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
