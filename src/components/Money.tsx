import { DIRHAM_PATH, DIRHAM_RATIO, DIRHAM_VIEWBOX, moneyDigits, type Currency } from "@/lib/money";

/** The dirham symbol as an inline vector, the height of the text beside it. */
export function Dirham({ className = "" }: { className?: string }) {
  return (
    <svg viewBox={DIRHAM_VIEWBOX} aria-label="AED" role="img" className={`inline-block align-[-0.08em] ${className}`} style={{ height: "0.86em", width: `${(0.86 * DIRHAM_RATIO).toFixed(3)}em` }}>
      <path d={DIRHAM_PATH} fill="currentColor" />
    </svg>
  );
}

/** An amount on a customer page: the symbol before the number, or "AED" when the setting says so. */
export function Money({ amount, currency = "symbol", className = "" }: { amount: number | null | undefined; currency?: Currency; className?: string }) {
  const digits = moneyDigits(amount);
  if (currency === "aed") return <span className={className}>AED {digits}</span>;
  return (
    <span className={`inline-flex items-center gap-[0.18em] whitespace-nowrap ${className}`}>
      <Dirham />
      <span>{digits}</span>
    </span>
  );
}
