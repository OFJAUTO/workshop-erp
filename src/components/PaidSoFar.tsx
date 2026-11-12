import { Words } from "./Words";
import { paidSoFarParts } from "@/lib/money-list";

/**
 * "Total AED x · Paid so far AED a · Balance AED b" (or "Paid in full", "No approved total yet", "cheque … clearing"): THE
 * one line of a job's money, the same words on the job card, the customer page and the Invoices and payments rows
 * (3 November 2026). The figures come from the one job money rule (jobMoneyOf / jobMoneyMany).
 */
export function PaidSoFar({ m, showTotal = true, className = "text-xs text-muted" }: { m: { total: number | null; paid: number; balance: number | null; pendingCheque?: number; credited?: number }; showTotal?: boolean; className?: string }) {
  const p = paidSoFarParts(m);
  return (
    <span className={className} data-paid-so-far>
      {showTotal && p.total ? <><Words text={p.total} />{" · "}</> : ""}
      <Words text={p.paid} data-paid-amount />
      {p.credit ? <span data-credit-note-off>{` · ${p.credit}`}</span> : null}
      {p.balance ? (
        <>
          {" · "}
          <span className={p.balanceTone === "due" ? "font-bold text-ink" : p.balanceTone === "paid" ? "font-bold text-green-text" : ""} data-balance-left>
            <Words text={p.balance} />
          </span>
        </>
      ) : null}
      {p.cheque ? <>{" · "}<Words text={p.cheque} /></> : ""}
    </span>
  );
}
