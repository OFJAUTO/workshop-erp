"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reloadIfStale } from "@/lib/app-version";
import { removeSupplierCharge } from "../charge-actions";

/** `waivable`: on an LPO whose parts were all cancelled with the supplier - "Waived – remove" takes it off (3 November 2026). */
export type ChargeRow = { id: string; description: string; supplier: string; amount: number; lpo: string | null; waivable?: boolean };

const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The supplier charges on this car (courier, freight): an internal cost, never a parts line and never on anything
 * the customer sees. Each one goes on its supplier's LPO when the LPO is raised; until then it can be removed. One on
 * an LPO left with no part (every part cancelled with the supplier) can be removed once the supplier waives it.
 */
export function SupplierChargesStrip({ jobId, charges, canEdit }: { jobId: string; charges: ChargeRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The answer stays in sight even when the last charge has gone.
  if (!charges.length && !message) return null;
  const total = charges.reduce((a, c) => a + c.amount, 0);
  const remove = (c: ChargeRow) =>
    start(async () => {
      setError(null);
      setMessage(null);
      try {
        const r = await removeSupplierCharge(jobId, c.id);
        if (r.error) setError(r.error);
        else {
          setMessage(r.message ?? "Removed.");
          router.refresh();
        }
      } catch (e) {
        setError(reloadIfStale(e) ? "A new version of the app is loading: the page reloads by itself, then try again." : "Not saved: no connection. Nothing was changed – try again.");
      }
    });
  return (
    <div className="flex flex-col gap-1.5 rounded-control border border-line bg-canvas px-3 py-2" data-supplier-charges>
      {charges.length ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">Supplier charges</span>
          <span className="text-xs text-muted">internal cost · goes on the supplier&apos;s LPO · never shown to the customer</span>
          <span className="ml-auto font-bold" data-charges-total>AED {aed(total)}</span>
        </span>
      ) : null}
      {charges.map((c) => (
        <span key={c.id} className="flex flex-wrap items-center gap-2 text-sm" data-supplier-charge>
          <span className="font-semibold uppercase">{c.description}</span>
          <span className="text-xs text-muted">{c.supplier}{c.lpo ? ` · on ${c.lpo}${c.waivable ? " (no part left on it)" : ""}` : " · not on an LPO yet"}</span>
          <span className="ml-auto font-semibold" data-charge-amount>AED {aed(c.amount)}</span>
          {canEdit && (!c.lpo || c.waivable) ? (
            <button type="button" disabled={pending} onClick={() => remove(c)} className="min-h-9 rounded-control border border-line-strong bg-white px-3 text-xs font-bold" data-charge-remove data-charge-waive={c.lpo ? "" : undefined}>{c.lpo ? "Waived – remove" : "Remove"}</button>
          ) : null}
        </span>
      ))}
      {error ? <span className="text-xs font-semibold text-red" role="alert" data-charge-error>{error}</span> : null}
      {message ? <span className="text-xs font-semibold text-green-text" data-charge-message>{message}</span> : null}
    </div>
  );
}
