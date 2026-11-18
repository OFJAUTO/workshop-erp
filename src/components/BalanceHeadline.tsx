import { balanceWordsOf, stillDueOf, type StillDue } from "@/lib/still-due";

const TONE = { green: "text-green-text", amber: "text-amber-text", red: "text-red", muted: "text-muted" } as const;

/**
 * THE balance headline (18 November 2026, J-00493): red BALANCE DUE only for money nobody has paid in any form; a cheque
 * or transfer still clearing that covers it reads "COVERED BY CHEQUE – WAITING TO CLEAR" in amber with "Balance once
 * cleared: AED 0.00"; part covered shows both lines. The figures come from THE still-due rule (stillDueOf). Used by the
 * invoice page, the money page, the job card, the gate-out page and the Out with balance due list.
 */
export function BalanceHeadline({ money, due: given, word = "cheque", size = "lg", className = "" }: { money?: { total: number | null; paid: number; balance: number | null; pendingCheque?: number; pending?: number } | null; due?: StillDue; word?: "cheque" | "transfer"; size?: "sm" | "lg"; className?: string }) {
  const d = given ?? stillDueOf(money ?? null);
  const w = balanceWordsOf(d, word);
  if (w.kind === "none" && !w.pendingLine) return null;
  const big = size === "lg" ? "text-xl sm:text-2xl" : "text-sm";
  return (
    <span className={`flex flex-col gap-0.5 ${className}`} data-balance-headline={w.kind}>
      {w.kind === "part_pending" ? (
        <>
          <span className={`${big} font-extrabold whitespace-nowrap text-amber-text`} data-balance-pending>{w.pendingLine}</span>
          <span className={`${big} font-extrabold whitespace-nowrap text-red`} data-balance-due>{w.dueLine}</span>
        </>
      ) : (
        <>
          <span className={`${w.kind === "covered" ? (size === "lg" ? "text-base sm:text-lg leading-tight" : "text-sm") : `${big} whitespace-nowrap`} font-extrabold ${TONE[w.tone]}`} data-balance-words>{w.headline}</span>
          {w.kind === "covered" ? <span className="text-sm font-semibold text-amber-text" data-balance-after>{w.pendingLine} · {w.after}</span> : null}
        </>
      )}
    </span>
  );
}
