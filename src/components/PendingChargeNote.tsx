import Link from "next/link";
import { pendingChargeNote } from "@/lib/charge-rules";
import { pendingChargesFor } from "@/lib/charges";

/**
 * "Pending charge: AED 630.00 (recovery 12 Oct) – collect it" (1 November 2026): on the gate-in, the quotation and the
 * customer panel, so the advisor collects it at the next visit. It stays a separate bill, never on this job's.
 */
export async function PendingChargeNote({ customerId, linked = true }: { customerId: string | null | undefined; linked?: boolean }) {
  const rows = await pendingChargesFor(customerId);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1 rounded-control border border-amber-bar bg-amber-soft/50 px-3 py-2" data-pending-charge-note>
      {rows.map((r) => (
        <span key={r.id} className="text-sm font-bold text-amber-text">
          {linked ? <Link href={`/pending-charges?open=${r.id}`} className="underline underline-offset-4">{pendingChargeNote(r)}</Link> : pendingChargeNote(r)}
        </span>
      ))}
    </div>
  );
}
