import Link from "next/link";
import { Words } from "@/components/Words";
import { Card, SectionLabel } from "@/components/ui";
import type { PriceToFix } from "@/lib/part-cost-history";

const money = (n: number | null) => (n === null ? "—" : `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * "Prices to fix (n)" (2 November 2026, 2.4): every part or estimate part with a placeholder price (AED 1.00 or less),
 * a stand-in supplier ("OFJ Additional"), a cost question nobody answered or "Our stock" with no stock item, for Parts
 * and the owner. Each row opens where it is fixed; ordered or received ones are corrected with "Correct the cost…" on
 * their row (a cost already on a tax invoice stays: the owner is told).
 */
export function PricesToFix({ rows }: { rows: PriceToFix[] }) {
  if (!rows.length) return null;
  const open = rows.filter((r) => !r.settled).length;
  return (
    <Card id="prices-to-fix" className="flex flex-col gap-2 border-amber-bar" data-prices-to-fix={rows.length}>
      <SectionLabel right={`${open} to price · ${rows.length - open} ordered or received`}>{`Prices to fix (${rows.length})`}</SectionLabel>
      <p className="text-xs text-muted">A cost of AED 1.00, a supplier like &quot;OFJ Additional&quot; or a price nobody confirmed makes the profit look bigger than it is. Put the supplier&apos;s real price, pick the real supplier, or From our stock. A part the customer already approved: Yes, real price on its row. Already ordered or received: open it and tap Correct the cost…</p>
      <ul className="flex flex-col divide-y divide-line">{rows.slice(0, FIRST).map((r) => <Row key={r.key} r={r} />)}</ul>
      {/* A long list stays one tap away, so the rest of the desk is not pushed down */}
      {rows.length > FIRST ? (
        <details className="group" data-prices-to-fix-more>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold underline underline-offset-4">
            <span className="group-open:hidden">Show all {rows.length}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="flex flex-col divide-y divide-line">{rows.slice(FIRST).map((r) => <Row key={r.key} r={r} />)}</ul>
        </details>
      ) : null}
    </Card>
  );
}

const FIRST = 6;

function Row({ r }: { r: PriceToFix }) {
  return (
    <li className="flex flex-col gap-0.5 py-2" data-price-to-fix={r.key} data-price-to-fix-settled={r.settled ? "1" : "0"}>
      <Link href={r.href} className="flex min-h-11 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-bold uppercase">{r.part}</span>
        {r.partNumber ? <span className="text-xs text-muted">{r.partNumber}</span> : null}
        <span className="text-sm font-semibold text-amber-text">{r.why}</span>
        <span className="ml-auto whitespace-nowrap text-xs font-bold underline underline-offset-4">{r.settled ? "Correct the cost" : "Fix the price"}</span>
      </Link>
      <Words className="text-xs text-muted" text={`${[r.plate, r.car, r.jobNumber].filter(Boolean).join(" · ")} · cost ${money(r.cost)}${r.supplier ? ` · ${r.supplier}` : ""}${r.lpo ? ` · ${r.lpo}` : ""}${r.quotation ? ` · ${r.quotation}` : ""}${r.selling !== null ? ` · selling ${money(r.selling)}` : ""}`} />
    </li>
  );
}
