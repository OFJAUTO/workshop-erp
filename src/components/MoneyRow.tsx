import Link from "next/link";
import { CarThumb } from "./CarThumb";
import { Badge } from "./ui";
import { MONEY_STEPS, type MoneyState, type MoneyStepKey } from "@/lib/money-steps";
import { formatDayTime } from "@/lib/format";
import type { MoneyRowData } from "@/lib/money-data";

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** JOB DONE → PROFORMA SENT → PAYMENT → TAX INVOICE → RELEASED, done in green, the current step black, the rest grey. */
export function MoneyStepLine({ state, compact = false }: { state: MoneyState; compact?: boolean }) {
  const cls = (k: MoneyStepKey) => (state.done.includes(k) ? "text-green" : state.current === k ? "text-ink font-extrabold" : "text-faint");
  return (
    <span className={`flex flex-wrap items-center gap-x-1 ${compact ? "text-[10px]" : "text-[11px]"} font-bold uppercase tracking-[0.06em]`} data-money-line={state.current}>
      {MONEY_STEPS.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1">
          <span className={cls(s.key)}>{state.done.includes(s.key) ? "✓ " : ""}{s.label}</span>
          {i < MONEY_STEPS.length - 1 ? <span className="text-faint">→</span> : null}
        </span>
      ))}
    </span>
  );
}

/** One car on the accounts screens: money only, no workshop detail. */
export function MoneyRow({ r, href }: { r: MoneyRowData; href?: string }) {
  const doc = r.taxInvoice ?? r.proforma;
  const to = href ?? `/jobs/${r.jobId}/invoice`;
  const tone = r.state.chip.tone === "ink" ? "ink" : r.state.chip.tone;
  return (
    <Link href={to} className="block" data-money-row={r.jobId} data-money-step={r.state.current}>
      <div className={`rounded-card border bg-white px-4 py-3 flex flex-wrap items-center gap-3 hover:border-ink ${r.state.waitingHours ? "border-red-bar" : "border-line"}`}>
        <CarThumb url={r.pictureUrl} alt={r.plate} size="sm" />
        <div className="flex flex-col min-w-44">
          <span className="font-extrabold">{r.plate}</span>
          <span className="text-xs text-muted">{r.car} · {r.jobNumber}</span>
          <span className="text-xs text-muted">{r.customer}</span>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-64">
          <MoneyStepLine state={r.state} />
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{r.state.chip.text}</Badge>
            {doc ? <span className="text-xs text-muted">{doc.number}{doc.sent_at ? ` · sent ${formatDayTime(doc.sent_at)}` : ""}</span> : null}
            {r.state.waitingHours ? <span className="text-xs font-bold text-red">Waiting {r.state.waitingHours} h</span> : null}
          </span>
        </div>
        <div className="flex flex-col items-end ml-auto">
          {doc ? <span className="font-semibold">{money(r.total)}</span> : <span className="text-xs text-muted">No proforma yet</span>}
          {doc && r.balance > 0.005 ? <span className="text-xs font-bold text-red">{money(r.balance)} due</span> : doc ? <span className="text-xs font-bold text-green">Paid{r.paidAt ? ` ${formatDayTime(r.paidAt)}` : ""}</span> : null}
        </div>
      </div>
    </Link>
  );
}
