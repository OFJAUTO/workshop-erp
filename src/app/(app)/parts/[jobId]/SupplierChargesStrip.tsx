"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeSupplierCharge } from "../charge-actions";

export type ChargeRow = { id: string; description: string; supplier: string; amount: number; lpo: string | null };

const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The supplier charges on this car (courier, freight): an internal cost, never a parts line and never on anything
 * the customer sees. Each one goes on its supplier's LPO when the LPO is raised; until then it can be removed.
 */
export function SupplierChargesStrip({ jobId, charges, canEdit }: { jobId: string; charges: ChargeRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!charges.length) return null;
  const total = charges.reduce((a, c) => a + c.amount, 0);
  return (
    <div className="flex flex-col gap-1.5 rounded-control border border-line bg-canvas px-3 py-2" data-supplier-charges>
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">Supplier charges</span>
        <span className="text-xs text-muted">internal cost · goes on the supplier&apos;s LPO · never shown to the customer</span>
        <span className="ml-auto font-bold" data-charges-total>AED {aed(total)}</span>
      </span>
      {charges.map((c) => (
        <span key={c.id} className="flex flex-wrap items-center gap-2 text-sm" data-supplier-charge>
          <span className="font-semibold uppercase">{c.description}</span>
          <span className="text-xs text-muted">{c.supplier}{c.lpo ? ` · on ${c.lpo}` : " · not on an LPO yet"}</span>
          <span className="ml-auto font-semibold" data-charge-amount>AED {aed(c.amount)}</span>
          {canEdit && !c.lpo ? (
            <button type="button" disabled={pending} onClick={() => start(async () => { setError(null); const r = await removeSupplierCharge(jobId, c.id); if (r.error) setError(r.error); else router.refresh(); })} className="min-h-9 rounded-control border border-line-strong bg-white px-3 text-xs font-bold" data-charge-remove>Remove</button>
          ) : null}
        </span>
      ))}
      {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
    </div>
  );
}
