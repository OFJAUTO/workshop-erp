import { finalRows, type FinalBlock } from "@/lib/final-invoice-rules";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * THE final-invoice money block on screen (21 November 2026, J-01013): the whole value of the work, less the advance
 * already invoiced, THIS INVOICE - the same rows as the PDF (final-invoice-rules finalRows), each number once - then
 * what is paid on this invoice and what is left. Used by the customer's invoice page and the job's money page.
 */
export function FinalInvoiceBlock({ block, vatPercent = 5, paid, balance, tone = "plain" }: { block: FinalBlock; vatPercent?: number; paid: number; balance: number; tone?: "plain" | "paid" }) {
  const rows = finalRows(block, vatPercent);
  return (
    <div className={`flex flex-col gap-2 rounded-lg px-4 py-4 ${tone === "paid" ? "bg-green-soft" : "bg-[#F4F4F5]"}`} data-final-block>
      {rows.map((r) => (
        <div key={r.key} className={`flex items-baseline justify-between gap-3 ${r.key === "this" ? "border-t border-[#D4D4D8] pt-2" : ""}`} data-final-row={r.key}>
          <span className="flex min-w-0 flex-col">
            <span className={`text-xs font-bold uppercase tracking-[0.06em] ${r.key === "this" ? "text-ink" : r.key === "advance" ? "text-green-text" : "text-[#5F6368]"}`}>{r.label}</span>
            <span className="text-xs text-[#5F6368]" data-final-split>{r.split}</span>
          </span>
          <span className={`whitespace-nowrap ${r.key === "this" ? "text-2xl font-extrabold" : r.key === "advance" ? "text-sm font-bold text-green-text" : "text-sm font-bold"}`} data-final-value={r.key}>
            {r.key === "advance" ? "− " : ""}
            {aed(r.value)}
          </span>
        </div>
      ))}
      {paid > 0.004 ? (
        <div className="flex items-baseline justify-between gap-3" data-final-row="paid">
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#5F6368]">Paid on this invoice</span>
          <span className="whitespace-nowrap text-sm font-bold">− {aed(paid)}</span>
        </div>
      ) : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-[#D4D4D8] pt-2" data-final-row="balance">
        <span className={`text-xs font-bold uppercase tracking-[0.06em] ${balance > 0.004 ? "text-ink" : "text-green-text"}`}>{balance > 0.004 ? "Balance due" : "Paid in full"}</span>
        <span className={`whitespace-nowrap text-lg font-extrabold ${balance > 0.004 ? "" : "text-green-text"}`} data-final-balance>{aed(balance)}</span>
      </div>
    </div>
  );
}
