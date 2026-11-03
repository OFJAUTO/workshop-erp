import Link from "next/link";
import { CarThumb } from "./CarThumb";
import { PaidSoFar } from "./PaidSoFar";
import { Badge } from "./ui";
import { MONEY_STEPS, type MoneyState, type MoneyStepKey } from "@/lib/money-steps";
import { formatDayTime } from "@/lib/format";
import { AuthCodeMissing } from "./AuthCodeMissing";
import { PAYMENT_METHOD_LABELS } from "@/lib/money-steps";
import type { MoneyRowData } from "@/lib/money-list";

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

/** "Today AED 30,000.00" (and how many payments), green, on a row with money in today. */
function TodayLine({ r }: { r: MoneyRowData }) {
  if (r.paidToday <= 0.005) return null;
  return <span className="text-xs font-bold text-green" data-money-today-line>Today {money(r.paidToday)}{r.paidTodayCount > 1 ? ` · ${r.paidTodayCount} payments` : ""}</span>;
}

/** Every tax invoice issued today on the row, when they are more than the one number the row already shows. */
function TaxTodayLine({ r, shown }: { r: MoneyRowData; shown: string | null }) {
  if (!r.taxToday.length || (r.taxToday.length === 1 && r.taxToday[0] === shown)) return null;
  return <span className="text-xs text-muted" data-money-tax-today-line>Tax invoice{r.taxToday.length === 1 ? "" : "s"} issued today: {r.taxToday.join(", ")}</span>;
}

/**
 * The row's card and payment-link payments saved without a real auth code (3 November 2026): one amber flag each, under
 * the row (outside its link), with "Add auth code" for the owner and accounts. The save takes the flag (and, under the
 * "Auth code missing" chip, the whole row) away, so its answer opens the centre window as well (review, 3 November 2026).
 */
function AuthMissingStrip({ r, canAdd }: { r: MoneyRowData; canAdd: boolean }) {
  const list = r.authMissing ?? [];
  if (!list.length) return null;
  return (
    <div className="basis-full flex flex-col gap-1 border-t border-line px-4 py-2" data-money-auth-missing={list.map((p) => p.number).join(",")}>
      {list.map((p) => <AuthCodeMissing key={p.id} paymentId={p.id} number={p.number} method={p.method} code={p.code} canAdd={canAdd} answerWindow label={`${p.number} · ${money(p.amount)} · ${PAYMENT_METHOD_LABELS[p.method] ?? p.method} · ${formatDayTime(p.receivedAt)}`} />)}
    </div>
  );
}

/**
 * One row on the accounts screens (3 November 2026: every job with money paid or owed). A job: the car, the money step,
 * "Paid so far · Balance", today's money; the row opens the money page and "Job card" the car's job card (accounts have no
 * Jobs menu). A customer's credit not allocated opens the customer's page; a pending charge opens Pending charges.
 */
export function MoneyRow({ r, href, canAddAuth = false }: { r: MoneyRowData; href?: string; /** The owner and accounts (not viewing as): "Add auth code" on a flagged payment. */ canAddAuth?: boolean }) {
  const doc = r.taxInvoice ?? r.proforma;
  const to = href ?? r.href;
  const tone = r.state.chip.tone === "ink" ? "ink" : r.state.chip.tone;
  const hooks = {
    "data-money-row": r.key,
    "data-money-kind": r.kind,
    "data-money-step": r.state.current,
    "data-money-total": r.total === null ? "" : r.total.toFixed(2),
    "data-money-paid": r.paid.toFixed(2),
    "data-money-balance": r.balance === null ? "" : r.balance.toFixed(2),
    "data-money-today": r.paidToday.toFixed(2),
    "data-money-today-count": String(r.paidTodayCount),
    "data-money-tax-today": r.taxToday.join(","),
  };
  if (r.kind !== "job") {
    const credit = r.kind === "credit";
    return (
      <div className={`rounded-card border bg-white flex flex-wrap items-stretch hover:border-ink ${credit && r.ageDays >= 7 ? "border-red-bar" : "border-line"}`} {...hooks}>
        <Link href={to} className="min-w-0 flex-1 px-4 py-3 flex flex-wrap items-center gap-3" data-money-row-open>
          <div className="flex flex-col min-w-44">
            <span className="font-extrabold">{credit ? r.customer : r.plate || r.customer}</span>
            <span className="text-xs text-muted">{credit ? `Credit · not allocated${r.plate ? ` · ${r.plate}` : ""}` : `Pending charge · ${r.what ?? ""}`}</span>
            {!credit && r.plate ? <span className="text-xs text-muted">{r.customer}</span> : null}
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-64">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={tone}>{r.state.chip.text}</Badge>
              {r.docNumber ? <span className="text-xs text-muted">{r.docNumber}</span> : null}
              {credit ? <span className={`text-xs ${r.ageDays >= 7 ? "font-bold text-red" : "text-muted"}`}>{r.ageDays === 0 ? "today" : `${r.ageDays} day${r.ageDays === 1 ? "" : "s"} old`}</span> : null}
            </span>
            {credit && r.what ? <span className="text-xs text-muted">{r.what}</span> : null}
          </div>
          <div className="flex flex-col items-end text-right ml-auto">
            {credit ? <span className="font-semibold">{money(r.paid)}</span> : <><span className="font-semibold">{money(r.total ?? 0)}</span><PaidSoFar m={r} showTotal={false} /></>}
            <TodayLine r={r} />
          </div>
        </Link>
        <AuthMissingStrip r={r} canAdd={canAddAuth} />
      </div>
    );
  }
  return (
    <div className={`rounded-card border bg-white flex flex-wrap items-stretch hover:border-ink ${r.state.waitingHours ? "border-red-bar" : "border-line"}`} {...hooks}>
      <Link href={to} className="min-w-0 flex-1 px-4 py-3 flex flex-wrap items-center gap-3" data-money-row-open>
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
          <TaxTodayLine r={r} shown={doc?.number ?? null} />
        </div>
        <div className="flex flex-col items-end text-right ml-auto">
          {r.total !== null ? <span className="font-semibold">{money(r.total)}</span> : null}
          {r.total !== null || r.paid > 0.005 ? <PaidSoFar m={r} showTotal={false} /> : <span className="text-xs text-muted">No approved total yet</span>}
          {r.balance !== null && r.balance <= 0.005 && r.paidAt ? <span className="text-xs text-green">{formatDayTime(r.paidAt)}</span> : null}
          <TodayLine r={r} />
        </div>
      </Link>
      <Link href={`/jobs/${r.jobId}`} className="shrink-0 min-h-11 w-full px-4 flex items-center justify-center text-xs font-bold underline underline-offset-4 border-t border-line sm:w-auto sm:border-t-0 sm:border-l" data-money-row-job-card>Job card</Link>
      <AuthMissingStrip r={r} canAdd={canAddAuth} />
    </div>
  );
}
