import Link from "next/link";
import { AllocatePayment } from "./AllocatePayment";
import { Badge } from "./ui";
import { METHOD_LABELS } from "@/lib/invoice-data";
import { formatDayTime } from "@/lib/format";
import type { UnallocatedPayment } from "@/lib/customer-money";

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ageWords = (days: number) => (days === 0 ? "unallocated today" : `unallocated ${days} day${days === 1 ? "" : "s"}`);

/**
 * Money on a customer's account, not allocated yet (1 November 2026, 1.8): one line each with its age, what it is for,
 * the receipt, and one-step Allocate for accounts and the owner. `target` makes Allocate a single tap to that job.
 */
export function UnallocatedList({ rows, canAllocate, showCustomer = false, target = null }: { rows: UnallocatedPayment[]; canAllocate: boolean; showCustomer?: boolean; target?: { key: string; title: string; balance: number | null } | null }) {
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col divide-y divide-line" data-unallocated-list>
      {rows.map((p) => (
        <li key={p.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-unallocated-row={p.number}>
          <span className="font-semibold">{p.number}</span>
          <span className="font-bold">{money(p.amount_aed)}</span>
          <Badge tone={p.ageDays >= 7 ? "red" : "amber"}>{ageWords(p.ageDays)}</Badge>
          <span className="text-xs text-muted">{METHOD_LABELS[p.method]}{p.method === "cheque" && p.cheque_status ? ` · ${p.cheque_status}` : ""} · {formatDayTime(p.received_at)}</span>
          {showCustomer ? <Link href={`/customers/${p.customer_id}`} className="text-xs font-bold uppercase underline underline-offset-4">{p.customerName}</Link> : null}
          {p.plate ? <span className="text-xs text-muted">{[p.plate, p.car].filter(Boolean).join(" · ")}</span> : null}
          {p.notes ? <span className="basis-full text-xs text-muted">For: {p.notes}</span> : null}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <a href={`/api/pdf/receipt/${p.id}`} target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center text-xs font-bold underline underline-offset-4">Receipt</a>
            {canAllocate && p.status === "recorded" ? <AllocatePayment paymentId={p.id} number={p.number} amount={p.amount_aed} customerId={p.customer_id} vehicleId={p.vehicle_id} target={target} /> : null}
            {p.status === "pending_owner" ? <Badge tone="amber">Waiting for the owner</Badge> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
