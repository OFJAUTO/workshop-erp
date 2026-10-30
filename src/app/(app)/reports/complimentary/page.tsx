import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { compCostOf, loadCompJobs, type CompJob } from "@/lib/comp-data";
import { COMP_REASONS, COMP_REASON_LABELS } from "@/lib/complimentary";
import { formatDate } from "@/lib/format";
import { monthLabel } from "@/lib/owner-report";
import { getSettings } from "@/lib/settings";
import { ReportTabs, monthParam } from "../ReportTabs";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

function groupBy(rows: CompJob[], key: (c: CompJob) => string) {
  const m = new Map<string, { jobs: number; normal: number; cost: number }>();
  for (const c of rows) {
    const k = key(c);
    const cur = m.get(k) ?? { jobs: 0, normal: 0, cost: 0 };
    m.set(k, { jobs: cur.jobs + 1, normal: r2(cur.normal + c.normal), cost: r2(cur.cost + compCostOf(c)) });
  }
  return Array.from(m.entries()).sort((a, b) => b[1].cost - a[1].cost);
}

/**
 * The owner's monthly COMPLIMENTARY report (section 5.8, 30 October 2026): how many free jobs, their normal value and
 * what they cost us (actual once the car left, else the approved figure), by reason, by advisor and by customer.
 */
export default async function ComplimentaryReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { month: m } = await searchParams;
  const month = monthParam(m);
  const from = new Date(`${month}-01T00:00:00+04:00`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  const rows = await loadCompJobs(await getSettings(), { from: from.toISOString(), to: to.toISOString() });
  const totals = { jobs: rows.length, normal: r2(rows.reduce((a, c) => a + c.normal, 0)), cost: r2(rows.reduce((a, c) => a + compCostOf(c), 0)) };
  const groups: [string, [string, { jobs: number; normal: number; cost: number }][]][] = [
    ["By reason", groupBy(rows, (c) => c.reasonLabel)],
    ["By advisor", groupBy(rows, (c) => c.advisorName ?? "Unknown")],
    ["By customer", groupBy(rows, (c) => c.customerName)],
  ];
  return (
    <>
      <PageHeader title="Complimentary" subtitle={`${monthLabel(month)}: work the owner approved as free - its normal value and what it cost us.`} />
      <ReportTabs current="/reports/complimentary" month={month} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-comp-totals>
        {[["Jobs", String(totals.jobs)], ["Normal value", aed(totals.normal)], ["Cost to us", aed(totals.cost)]].map(([label, value]) => (
          <Card key={label} className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
            <span className="text-lg font-extrabold">{value}</span>
          </Card>
        ))}
      </div>
      {rows.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {groups.map(([title, list]) => (
            <Card key={title} className="flex flex-col gap-2" data-comp-group={title}>
              <SectionLabel>{title}</SectionLabel>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {list.map(([k, v]) => (
                  <li key={k} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                    <span className="font-semibold">{k}</span>
                    <span className="text-muted">{v.jobs} job{v.jobs === 1 ? "" : "s"} · value {aed(v.normal)} · <span className="font-bold text-ink">cost {aed(v.cost)}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}
      <Card className="flex flex-col gap-2" data-comp-jobs>
        <SectionLabel right={`${rows.length}`}>Jobs</SectionLabel>
        {!rows.length ? (
          <p className="text-sm text-muted">Nothing was approved as complimentary this month.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {rows.map((c) => (
              <li key={c.quotationId} className="flex flex-col gap-0.5 py-2" data-comp-job={c.quotationId}>
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {c.jobId ? <Link href={`/jobs/${c.jobId}`} className="font-bold underline underline-offset-4">{c.plate || c.jobNumber}</Link> : <span className="font-bold">{c.number}</span>}
                  <span className="text-muted">{c.jobNumber} · {c.number} · {c.customerName}{c.advisorName ? ` · ${c.advisorName}` : ""}{c.decidedAt ? ` · approved ${formatDate(c.decidedAt)}` : ""}</span>
                </span>
                <span>{c.reasonLabel}{c.originalJobNumber ? ` · original job ${c.originalJobNumber}` : ""}{c.note ? ` · ${c.note}` : ""}</span>
                <span className="font-semibold">Normal price {aed(c.normal)} · {c.actualCost !== null ? `Approved at ${aed(c.cost)} → actual ${aed(c.actualCost)}` : `Cost to us ${aed(c.cost)}`}{c.costDetail ? <span className="font-normal text-muted"> ({c.costDetail})</span> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">Reasons: {COMP_REASONS.map((r) => COMP_REASON_LABELS[r]).join(" · ")}. Our mistake and warranty are also told on the original job and on Comebacks; goodwill on the customer&apos;s record.</p>
    </>
  );
}
