import Link from "next/link";
import { Badge, Button, Card, Empty, Input, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { bonusPeriodOf, bonusRowsOf, ADVISOR_BONUS_MIN_PROFIT, type BonusRow } from "@/lib/advisor-bonus";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { approveBonusPeriod, setBonusOverride } from "./actions";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * The advisor bonus, 26th to 25th, live at any time. An advisor sees only his own qualifying invoices and his
 * bonus so far ("Waiting for owner approval"); no costs, no other advisors. The owner sees every advisor, can
 * change any rate with a reason, approves the period in one tap and takes the Excel for the accountant.
 */
export default async function BonusPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; period?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id;
  if (!["owner", "service_advisor"].includes(role)) return <Notice tone="error">The bonus page is for the owner and the advisors.</Notice>;
  const { message, error, period: periodParam } = await searchParams;
  const settings = await getSettings();
  const periodKey = periodParam && /^\d{4}-\d{2}$/.test(periodParam) ? periodParam : bonusPeriodOf().key;
  const view = await bonusRowsOf(settings, periodKey);
  const isOwner = role === "owner";
  const mine = isOwner ? view.rows : view.rows.filter((r) => r.advisorId === staff.id);
  const myTotal = mine.reduce((a, r) => a + r.bonus, 0);
  const byAdvisor = new Map<string, BonusRow[]>();
  for (const r of view.rows) {
    const k = r.advisorName;
    byAdvisor.set(k, [...(byAdvisor.get(k) ?? []), r]);
  }
  const prev = bonusPeriodOf(`${view.period.start.slice(0, 7)}-01`).key;

  return (
    <>
      <PageHeader
        title="Advisor bonus"
        subtitle={`${view.period.label} · paid jobs with pure profit of ${aed(ADVISOR_BONUS_MIN_PROFIT)} or more (bodyshop work counted separately)`}
        actions={isOwner ? <a href={`/api/export/bonus?period=${view.period.key}`} className="inline-flex items-center justify-center rounded-control font-bold bg-white text-ink border border-line-strong hover:bg-canvas min-h-14 px-6 text-base" data-bonus-excel>Excel for the accountant</a> : undefined}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/bonus?period=${prev}`} className="font-semibold underline underline-offset-4">← Earlier period</Link>
        {periodParam ? <Link href="/bonus" className="font-semibold underline underline-offset-4">Current period</Link> : null}
        {view.approved ? <Badge tone="green">Approved {formatDateTime(view.approved.at)}{view.approved.byName ? ` by ${view.approved.byName}` : ""}</Badge> : <Badge tone="amber">Waiting for owner approval</Badge>}
      </div>

      {!isOwner ? (
        <Card className="flex flex-col gap-3" data-my-bonus>
          <SectionLabel right={<span className="text-base font-extrabold text-ink">{aed(myTotal)}</span>}>My bonus so far</SectionLabel>
          {mine.length === 0 ? <Empty title="No qualifying invoices in this period yet" /> : (
            <ul className="divide-y divide-line text-sm">
              {mine.map((r) => (
                <li key={`${r.invoiceId}-${r.clawback ? "c" : ""}`} className="py-2 flex flex-wrap items-center gap-3" data-bonus-row={r.invoiceNumber}>
                  <span className="font-semibold">{r.invoiceNumber}</span>
                  <span className="text-muted">{r.plate ?? r.jobNumber ?? ""}</span>
                  <span className="text-muted">{formatDate(r.date)}</span>
                  {r.clawback ? <Badge tone="red">Credit note</Badge> : null}
                  <span className={`ml-auto font-bold ${r.bonus < 0 ? "text-red" : ""}`}>{aed(r.bonus)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">{view.approved ? "Approved by the owner." : "Waiting for owner approval."} The bonus counts tax-invoiced, fully paid jobs only.</p>
        </Card>
      ) : (
        <>
          {view.rows.length === 0 ? <Card><Empty title="No qualifying invoices in this period yet">A job counts once its tax invoice is fully paid and its pure profit is {aed(ADVISOR_BONUS_MIN_PROFIT)} or more.</Empty></Card> : null}
          {Array.from(byAdvisor.entries()).map(([name, rows]) => (
            <Card key={name} className="flex flex-col gap-2" data-bonus-advisor={name}>
              <SectionLabel right={<span className="text-base font-extrabold text-ink">{aed(rows.reduce((a, r) => a + r.bonus, 0))}</span>}>{name}</SectionLabel>
              <ul className="divide-y divide-line text-sm">
                {rows.map((r) => (
                  <li key={`${r.invoiceId}-${r.clawback ? "c" : ""}`} className="py-2 flex flex-wrap items-center gap-3" data-bonus-row={r.invoiceNumber}>
                    <span className="font-semibold">{r.invoiceNumber}</span>
                    <span className="text-muted">{r.plate ?? r.jobNumber ?? ""} · {formatDate(r.date)}</span>
                    <span>Profit {aed(r.profit)}</span>
                    {r.clawback ? <Badge tone="red">Credit note</Badge> : <span className="text-muted">{r.ratePercent}%</span>}
                    {r.cardFeeEstimated && !view.approved ? <span data-bonus-fee-estimated><Badge tone="amber">Card fee estimated</Badge></span> : null}
                    {r.overrideReason ? <span className="text-xs text-muted">{r.overrideReason}</span> : null}
                    <span className={`ml-auto font-bold ${r.bonus < 0 ? "text-red" : ""}`} data-bonus-amount>{aed(r.bonus)}</span>
                    {!view.approved && !r.clawback ? (
                      <details>
                        <summary className="cursor-pointer min-h-9 inline-flex items-center rounded-control border border-line-strong bg-white px-3 text-xs font-bold" data-bonus-edit>Change rate</summary>
                        <form action={setBonusOverride.bind(null, r.invoiceId)} className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="period" value={view.period.key} />
                          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Rate (%)<Input name="rate" defaultValue={String(r.ratePercent)} inputMode="decimal" className="w-24" data-bonus-rate /></label>
                          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Why<Input name="reason" required placeholder="Short reason" className="min-w-56" data-bonus-reason /></label>
                          <Button type="submit" size="md" tone="secondary">Save</Button>
                        </form>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          <Card className="flex flex-wrap items-center gap-3">
            <span className="text-base font-extrabold">Total: {aed(view.total)}</span>
            {view.approved ? <Badge tone="green">Approved</Badge> : view.rows.length ? (
              <form action={approveBonusPeriod} className="ml-auto flex flex-col items-end gap-2">
                <input type="hidden" name="period" value={view.period.key} />
                {view.rows.some((r) => r.cardFeeEstimated) ? (
                  <label className="flex max-w-md items-start gap-2 text-sm font-semibold text-amber" data-bonus-estimated-ask>
                    <input type="checkbox" name="confirm_estimated" value="1" required className="mt-1 h-5 w-5 accent-ink" />
                    <span>{view.rows.filter((r) => r.cardFeeEstimated).length} invoice{view.rows.filter((r) => r.cardFeeEstimated).length === 1 ? " still has an" : "s still have"} estimated card fee (the bank has not settled yet). Approving freezes them as they are. Approve anyway?</span>
                  </label>
                ) : null}
                <Button type="submit" size="lg" data-approve-bonuses>Approve bonuses for this period</Button>
              </form>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}
