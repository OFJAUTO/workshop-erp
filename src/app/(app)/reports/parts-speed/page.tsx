import { redirect } from "next/navigation";
import { Badge, Card, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDayTime } from "@/lib/format";
import { loadPartsSpeed, type SpeedRow } from "@/lib/parts-speed";

export const dynamic = "force-dynamic";

const h = (minutes: number) => (minutes >= 90 ? `${(minutes / 60).toFixed(1)} h` : `${Math.round(minutes)} min`);

function SpeedTable({ title, rows, hint }: { title: string; rows: SpeedRow[]; hint: string }) {
  if (!rows.length) return null;
  return (
    <Card className="flex flex-col gap-1">
      <SectionLabel>{title} <span className="cursor-help font-normal text-muted" title={hint}>ⓘ</span></SectionLabel>
      <ul className="divide-y divide-line text-sm">
        {rows.slice(0, 12).map((r) => (
          <li key={r.who} className="py-1.5 flex items-center gap-3">
            <span className="font-semibold">{r.who}</span>
            <span className="text-xs text-muted">{r.n} time{r.n === 1 ? "" : "s"}</span>
            <span className="ml-auto font-bold">{h(r.avgMinutes)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Parts speed, the owner's report (2.4): the average working time of every parts step, per person and per supplier, and this week's list over target. */
export default async function PartsSpeedPage() {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const s = await loadPartsSpeed();
  return (
    <>
      <PageHeader title="Parts speed" subtitle="Last 30 days, in working time (the workshop's hours). Averages per person and per supplier; this week's steps over target at the top." actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>} />
      {s.overTarget.length ? (
        <Card className="flex flex-col gap-1 !border-red-bar" data-over-target>
          <SectionLabel right={`${s.overTarget.length}`}>Over target this week</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {s.overTarget.map((r, i) => (
              <li key={i} className="py-1.5 flex flex-wrap items-center gap-3">
                <Badge tone="red">{h(r.minutes)} (target {h(r.target)})</Badge>
                <span className="font-semibold">{r.what}</span>
                <span className="text-xs text-muted">{r.who} · {formatDayTime(r.when)}</span>
                {r.href ? <LinkButton href={r.href} tone="secondary" size="md" className="ml-auto">Open</LinkButton> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : <Card><p className="text-sm font-bold text-green" data-over-target-empty>Nothing over target this week ✓</p></Card>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-speed-tables>
        <SpeedTable title="Request → priced" rows={s.pricing} hint={`From the technician's request to the price on the row, per Parts person. Target ${h(s.targets.pricingMinutes)}.`} />
        <SpeedTable title="Customer approval → LPO sent" rows={s.approvalToLpo} hint="From the customer's approval to the LPO going for the owner's approval." />
        <SpeedTable title="LPO approved → ordered (people)" rows={s.approvedToOrdered.people} hint={`From the approval to Ordered, per Parts person. Target ${h(s.targets.orderMinutes)}.`} />
        <SpeedTable title="LPO approved → ordered (suppliers)" rows={s.approvedToOrdered.suppliers} hint="The same clock, split by supplier." />
        <SpeedTable title="Received → handed to the technician" rows={s.receivedToHandover} hint="From the delivery landing to the technician's PIN." />
        {s.supplierLateness.length ? (
          <Card className="flex flex-col gap-1">
            <SectionLabel>Supplier lateness <span className="cursor-help font-normal text-muted" title="Received date against the expected date: positive days are late, negative early.">ⓘ</span></SectionLabel>
            <ul className="divide-y divide-line text-sm">
              {s.supplierLateness.slice(0, 12).map((r) => (
                <li key={r.who} className="py-1.5 flex items-center gap-3">
                  <span className="font-semibold">{r.who}</span>
                  <span className="text-xs text-muted">{r.n} deliver{r.n === 1 ? "y" : "ies"} · {Math.round(r.lateShare * 100)}% late</span>
                  <span className={`ml-auto font-bold ${r.avgDays > 0 ? "text-red" : "text-green"}`}>{r.avgDays > 0 ? "+" : ""}{r.avgDays.toFixed(1)} days</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
