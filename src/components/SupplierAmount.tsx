import { supplierFigure, supplierMoneyWords, type SupplierMoney } from "@/lib/supplier-money";

/**
 * THE supplier money display (5 November 2026, Mathew): "AED 1,011.15 incl. VAT" with "963.00 + VAT 48.15" small and
 * grey under it - or "AED 963.00" with "No VAT – supplier not VAT-registered". A cancelled LPO shows its original amount
 * struck through with "Cancelled" (it is never counted). Used on every screen that shows what we owe a supplier, with
 * the figures from lib/supplier-money.ts. No hooks: server and client pages alike.
 */
export function SupplierAmount({ money, cancelled = false, align = "end", size = "md", hook = null }: { money: SupplierMoney; cancelled?: boolean; align?: "start" | "end"; size?: "sm" | "md" | "lg"; /** A test hook on the main figure alone ("cost-grand" → data-cost-grand). */ hook?: string | null }) {
  const w = supplierMoneyWords(money);
  const main = size === "lg" ? "text-lg" : size === "sm" ? "text-sm" : "text-base";
  return (
    <span
      className={`inline-flex min-w-0 flex-col ${align === "end" ? "items-end text-right" : "items-start text-left"}`}
      data-supplier-amount
      data-net={money.net.toFixed(2)}
      data-vat={money.vat.toFixed(2)}
      data-gross={money.gross.toFixed(2)}
      data-vat-charged={money.vatCharged ? "1" : "0"}
      data-cancelled={cancelled ? "1" : undefined}
    >
      <span className={`whitespace-nowrap font-extrabold ${main} ${cancelled ? "text-muted line-through" : ""}`} {...(hook ? { [`data-${hook}`]: "" } : {})}>{w.main}</span>
      <span className="text-xs font-semibold text-muted">
        {cancelled ? <span className="mr-1 rounded-full border border-line-strong px-1.5 font-extrabold uppercase tracking-[0.06em] text-ink" data-supplier-cancelled>Cancelled</span> : null}
        <span className={cancelled ? "line-through" : undefined}>{w.sub}</span>
      </span>
    </span>
  );
}

/** The same figures as one short line (for tight rows): "AED 1,011.15 incl. VAT · 963.00 + VAT 48.15". */
export function supplierAmountLine(money: SupplierMoney): string {
  const w = supplierMoneyWords(money);
  return `${w.main} · ${w.sub}`;
}

export { supplierFigure };
