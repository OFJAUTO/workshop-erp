import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Empty, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { VERDICT_LABELS } from "@/lib/job-summary";
import { monthlySummary } from "@/lib/owner-report";
import { getSettings } from "@/lib/settings";
import { ReportTabs, aedText, monthParam, verdictTone } from "../ReportTabs";

export const dynamic = "force-dynamic";

/** Every car gated out in the month, one line each, the ones that need a talk first. */
export default async function FinishedCarsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { month: m } = await searchParams;
  const month = monthParam(m);
  const s = await monthlySummary(await getSettings(), month);
  const order = { talk: 0, acceptable: 1, good: 2 };
  const jobs = s.jobs.slice().sort((a, b) => order[a.verdict] - order[b.verdict] || (b.gatedOutAt ?? "").localeCompare(a.gatedOutAt ?? ""));
  return (
    <>
      <PageHeader title="Finished cars" subtitle={`${s.count} gated out in ${s.label}. Tap a job for its report.`} />
      <ReportTabs current="/reports/cars" month={month} />
      {jobs.length === 0 ? <Empty title="Nothing gated out in this month" /> : (
        <Card className="flex flex-col gap-2">
          <SectionLabel right={`${jobs.length}`}>Needs a talk first, then acceptable, then good</SectionLabel>
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/reports/jobs/${j.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:bg-chip -mx-2 px-2 rounded-control">
                  <Badge tone={verdictTone(j.verdict)}>{VERDICT_LABELS[j.verdict]}</Badge>
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="font-bold">{j.plate}{j.loose ? " · Loose items" : ""} <span className="text-muted font-semibold">· {j.jobNumber}</span></span>
                    <span className="text-xs text-muted">{j.title} · {j.customer} · gated out {formatDate(j.gatedOutAt)} · {j.days} day{j.days === 1 ? "" : "s"}</span>
                  </span>
                  <span className="flex flex-col items-end text-sm">
                    <span className="font-bold">{aedText(j.invoiced)}</span>
                    <span className={`text-xs ${j.profit !== null && j.profit < 0 ? "text-red font-bold" : "text-muted"}`}>profit {aedText(j.profit)}{j.marginPercent !== null ? ` · ${j.marginPercent}%` : ""}</span>
                  </span>
                  {j.flags ? <Badge tone="outline">{j.flags} flag{j.flags === 1 ? "" : "s"}</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
