import { Card, SectionLabel } from "@/components/ui";
import { expectedVsActualWords } from "@/lib/invoice-profit-rules";
import type { InvoiceProfitModel } from "@/lib/invoice-profit";

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * THE profit box of a tax invoice (13 November 2026, Section 8). Internal: owner, accounts and the job's own advisor
 * only (the page decides on the server before it renders this). Before VAT, minus every real cost = the profit in AED
 * and %; PROVISIONAL with the worst case while a cost is estimated, FINAL once all are known; expected (the approved
 * quotation) against actual, with the lines that differ; and any comeback since.
 */
export function InvoiceProfitBox({ m }: { m: InvoiceProfitModel }) {
  const provisional = m.state === "provisional";
  return (
    <Card className={`flex flex-col gap-3 ${provisional ? "border-amber-bar" : "border-green"}`} data-invoice-profit={m.state}>
      <SectionLabel right={<span className={`rounded-full border px-2 py-0.5 text-xs font-extrabold tracking-[0.08em] ${provisional ? "border-amber-bar bg-amber-soft text-amber-text" : "border-green bg-green-soft text-green-text"}`} data-profit-state>{provisional ? "PROVISIONAL" : "FINAL"}</span>}>
        Profit on {m.invoiceNumber} · internal
      </SectionLabel>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className={`text-2xl font-extrabold ${m.profit < 0 ? "text-red" : ""}`} data-profit-amount={m.profit.toFixed(2)}>{money(m.profit)}</span>
        {m.margin !== null ? <span className="text-lg font-bold" data-profit-margin={m.margin}>{m.margin}%</span> : null}
        {provisional ? <span className="text-sm font-bold text-amber-text" data-profit-worst={m.worst.toFixed(2)}>Worst case {money(m.worst)}</span> : null}
      </div>
      <table className="w-full text-sm" data-profit-table>
        <tbody>
          <tr className="border-b border-line"><td className="py-1">Sold, before VAT</td><td className="py-1 text-right font-semibold">{money(m.revenue)}</td></tr>
          {m.costs.map((c) => (
            <tr key={c.key} className="border-b border-line" data-profit-cost={c.key}><td className="py-1">− {c.label}</td><td className="py-1 text-right">{money(c.amount)}</td></tr>
          ))}
          <tr><td className="py-1 font-bold">= Profit</td><td className="py-1 text-right font-bold">{money(m.profit)}</td></tr>
        </tbody>
      </table>
      {provisional && m.why.length ? <p className="text-xs text-amber-text" data-profit-why>Still estimated: {m.why.join(" · ")}.</p> : null}
      <div className="flex flex-col gap-1" data-profit-expected>
        <p className="text-sm font-semibold">{expectedVsActualWords(m.expected, m.profit)}</p>
        {m.differs.length ? (
          <ul className="flex flex-col gap-0.5 text-xs text-muted">
            {m.differs.map((d, i) => <li key={i} data-profit-differs>{d.words}</li>)}
          </ul>
        ) : m.expected !== null ? <p className="text-xs text-muted">No line differs from the quotation.</p> : null}
      </div>
      {m.comeback ? <p className="text-sm font-bold text-red" data-profit-comeback>Comeback since ({m.comeback.jobs.join(", ") || "our fault"}): {money(-m.comeback.loss)} · after it {money(m.profit - m.comeback.loss)}</p> : null}
      {m.comebackOf ? <p className="text-sm font-bold text-red" data-profit-is-comeback>This is a comeback of {m.comebackOf}: its loss counts against that job.</p> : null}
    </Card>
  );
}

/** The profit of one visit on the car or customer page: "Profit AED 2,140.00 (17.1%)", amber while provisional. */
export function ProfitTag({ profit, revenue, provisional, hook = "visit" }: { profit: number; revenue: number; provisional: boolean; hook?: string }) {
  const pct = revenue > 0.005 ? Math.round((profit / revenue) * 1000) / 10 : null;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${profit < 0 ? "border-red bg-red-soft text-red" : provisional ? "border-amber-bar bg-amber-soft text-amber-text" : "border-green bg-green-soft text-green-text"}`} data-profit-tag={hook}>
      Profit {money(profit)}{pct !== null ? ` (${pct}%)` : ""}{provisional ? " · provisional" : ""}
    </span>
  );
}
