import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { VERDICT_LABELS } from "@/lib/job-summary";
import { monthlySummary } from "@/lib/owner-report";
import { getSettings } from "@/lib/settings";
import { ReportTabs, aedText, monthParam, verdictTone } from "../ReportTabs";

export const dynamic = "force-dynamic";

/** The owner's month on one page: how many, how much, how good, and what to look at. */
export default async function MonthlyReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { month: m } = await searchParams;
  const month = monthParam(m);
  const settings = await getSettings();
  const s = await monthlySummary(settings, month);
  const stat = (label: string, value: string, note?: string | null) => (
    <Card className="flex flex-col gap-0.5">
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
      <span className="text-2xl font-extrabold">{value}</span>
      {note ? <span className="text-xs text-muted">{note}</span> : null}
    </Card>
  );
  return (
    <>
      <PageHeader title="Reports" subtitle="Written by the system at gate-out; nothing here is typed by anyone." />
      <ReportTabs current="/reports/monthly" month={month} pdfHref={`/api/pdf/monthly?month=${month}`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat("Gated out", `${s.count}`, s.loose ? `${s.cars} cars, ${s.loose} loose` : null)}
        {stat("Invoiced before VAT", aedText(s.invoiced))}
        {stat("Profit", aedText(s.profit), s.marginPercent !== null ? `${s.marginPercent}% margin` : null)}
        {stat("On time", s.count ? `${Math.round((s.onTime / s.count) * 100)}%` : "–", s.count ? `${s.late} late · ${s.avgDays} days in the workshop on average` : null)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="flex flex-col gap-2">
          <SectionLabel>Verdicts</SectionLabel>
          {(["good", "acceptable", "talk"] as const).map((v) => (
            <div key={v} className="flex items-center justify-between text-sm"><Badge tone={verdictTone(v)}>{VERDICT_LABELS[v]}</Badge><span className="font-bold">{s.verdicts[v]}</span></div>
          ))}
          <div className="flex items-center justify-between text-sm border-t border-line pt-2"><span className="text-muted">Comebacks</span><span className="font-bold">{s.comebacks}</span></div>
        </Card>
        <Card className="flex flex-col gap-2 lg:col-span-2">
          <SectionLabel right={`${s.flags.reduce((a, f) => a + f.count, 0)}`}>Things that came up</SectionLabel>
          {s.flags.length === 0 ? <p className="text-sm text-muted">Nothing flagged this month.</p> : (
            <ul className="divide-y divide-line">
              {s.flags.map((f) => <li key={f.text} className="py-1.5 flex items-center justify-between text-sm"><span>{f.text.replace(/\bn\b/g, "…")}</span><span className="font-bold">{f.count}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${s.jobs.length}`}>Jobs gated out in {s.label}</SectionLabel>
        {s.jobs.length === 0 ? <p className="text-sm text-muted">Nothing gated out in this month.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-[0.08em] text-muted"><th className="py-1 pr-3">Gated out</th><th className="py-1 pr-3">Job</th><th className="py-1 pr-3">Car</th><th className="py-1 pr-3">Customer</th><th className="py-1 pr-3">Verdict</th><th className="py-1 pr-3 text-right">Invoiced</th><th className="py-1 pr-3 text-right">Profit</th><th className="py-1 pr-3 text-right">Days</th><th className="py-1 text-right">Flags</th></tr></thead>
              <tbody>
                {s.jobs.map((j) => (
                  <tr key={j.id} className="border-t border-line">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(j.gatedOutAt)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={`/reports/jobs/${j.id}`} className="font-bold underline underline-offset-4">{j.jobNumber}</Link></td>
                    <td className="py-1.5 pr-3">{j.plate}{j.loose ? " (loose)" : ""}<span className="block text-xs text-muted">{j.title}</span></td>
                    <td className="py-1.5 pr-3">{j.customer}</td>
                    <td className="py-1.5 pr-3"><Badge tone={verdictTone(j.verdict)}>{VERDICT_LABELS[j.verdict]}</Badge></td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aedText(j.invoiced)}</td>
                    <td className={`py-1.5 pr-3 text-right whitespace-nowrap ${j.profit !== null && j.profit < 0 ? "text-red font-bold" : ""}`}>{aedText(j.profit)}{j.marginPercent !== null ? <span className="text-xs text-muted"> {j.marginPercent}%</span> : null}</td>
                    <td className="py-1.5 pr-3 text-right">{j.days}</td>
                    <td className="py-1.5 text-right">{j.flags || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
