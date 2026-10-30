import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { VERDICT_LABELS } from "@/lib/job-summary";
import { monthlySummary } from "@/lib/owner-report";
import { bodyshopLabourBySection } from "@/lib/bodyshop";
import { SECTION_LABELS } from "@/lib/bodyshop-kinds";
import { jobFilmCost } from "@/lib/film";
import { getSettings } from "@/lib/settings";
import { markCommissionPaid } from "../commission-actions";
import { ReportTabs, aedText, monthParam, verdictTone } from "../ReportTabs";

export const dynamic = "force-dynamic";

/** The owner's month on one page: how many, how much, how good, and what to look at. */
export default async function MonthlyReportPage({ searchParams }: { searchParams: Promise<{ month?: string; message?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { month: m, message } = await searchParams;
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
      {message ? <Notice tone="success">{message}</Notice> : null}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat("Gated out", `${s.count}`, s.loose ? `${s.cars} cars, ${s.loose} loose` : null)}
        {stat("Invoiced before VAT", aedText(s.invoiced))}
        {stat("Profit", aedText(s.profit), s.marginPercent !== null ? `${s.marginPercent}% margin` : null)}
        {stat("On time", s.count ? `${Math.round((s.onTime / s.count) * 100)}%` : "–", s.count ? `${s.late} late · ${s.avgDays} days in the workshop on average` : null)}
      </div>
      <Card className="flex flex-col gap-2" data-bodyshop-report>
        <SectionLabel right={`${s.bodyshop.cars.length} handed over in ${s.label}`}>Bodyshop</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
          <div><span className="block text-xs text-muted">In progress</span><span className="text-xl font-extrabold">{s.bodyshop.inProgress}</span></div>
          <div><span className="block text-xs text-muted">Late today</span><span className={`text-xl font-extrabold ${s.bodyshop.late ? "text-red" : ""}`}>{s.bodyshop.late}</span></div>
          <div><span className="block text-xs text-muted">Days per job</span><span className="text-xl font-extrabold">{s.bodyshop.avgDays ?? "–"}</span></div>
          <div><span className="block text-xs text-muted">Profit</span><span className="text-xl font-extrabold">{aedText(s.bodyshop.profit)}</span></div>
          <div><span className="block text-xs text-muted">Materials vs price</span><span className="text-xl font-extrabold">{s.bodyshop.materialsPercent !== null ? `${s.bodyshop.materialsPercent}%` : "–"}</span></div>
        </div>
        {s.bodyshop.byCut?.length ? (
          <div className="flex flex-col gap-1" data-ppf-by-cut>
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">PPF by cutting method</span>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-[0.08em] text-muted"><th className="py-1 pr-3">Method</th><th className="py-1 pr-3 text-right">Jobs</th><th className="py-1 pr-3 text-right">PPF hours</th><th className="py-1 pr-3 text-right">Film (m)</th><th className="py-1 pr-3 text-right">Hours per job</th><th className="py-1 text-right">Film per job (m)</th></tr></thead>
                <tbody>
                  {s.bodyshop.byCut.map((r) => (
                    <tr key={r.key} className="border-t border-line"><td className="py-1.5 pr-3 font-bold">{r.label}</td><td className="py-1.5 pr-3 text-right">{r.jobs}</td><td className="py-1.5 pr-3 text-right">{r.hours}</td><td className="py-1.5 pr-3 text-right">{r.metres}</td><td className="py-1.5 pr-3 text-right">{r.hoursPerJob ?? "–"}</td><td className="py-1.5 text-right">{r.metresPerJob ?? "–"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {s.bodyshop.cars.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-[0.08em] text-muted"><th className="py-1 pr-3">Job</th><th className="py-1 pr-3">Car</th><th className="py-1 pr-3 text-right">Price</th><th className="py-1 pr-3 text-right">Materials</th><th className="py-1 pr-3 text-right">Labour</th><th className="py-1 pr-3 text-right">Commission</th><th className="py-1 text-right">Profit</th></tr></thead>
              <tbody>
                {s.bodyshop.cars.map((c) => (
                  <tr key={c.jobId} className="border-t border-line">
                    <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={`/reports/jobs/${c.jobId}`} className="font-bold underline underline-offset-4">{c.jobNumber}</Link></td>
                    <td className="py-1.5 pr-3">{c.plate}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aedText(c.price)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aedText(c.materials)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aedText(c.labour)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aedText(c.commission + c.bank)}</td>
                    <td className={`py-1.5 text-right whitespace-nowrap font-bold ${c.profit < 0 ? "text-red" : ""}`}>{aedText(c.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      {s.bodyshop.cars.length ? await (async () => {
        const rows = await Promise.all(s.bodyshop.cars.map(async (c) => ({ c, sections: await bodyshopLabourBySection(c.jobId, settings), film: await jobFilmCost(c.jobId) })));
        const totals = new Map<string, number>();
        for (const r of rows) for (const sec of r.sections) totals.set(sec.section, (totals.get(sec.section) ?? 0) + sec.hours);
        return (
          <Card className="flex flex-col gap-2" data-bodyshop-costing>
            <SectionLabel>Bodyshop: hours per section and materials per car</SectionLabel>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {[...totals.entries()].sort((a, b) => b[1] - a[1]).map(([sec, h]) => <span key={sec} className="font-semibold">{(SECTION_LABELS as Record<string, string>)[sec] ?? sec}: {Math.round(h * 10) / 10} h</span>)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-[0.08em] text-muted"><th className="py-1 pr-3">Car</th><th className="py-1 pr-3 text-right">Film (m)</th><th className="py-1 pr-3 text-right">Film + tint</th><th className="py-1">Hours per section</th></tr></thead>
                <tbody>
                  {rows.map(({ c, sections, film }) => (
                    <tr key={c.jobId} className="border-t border-line">
                      <td className="py-1.5 pr-3">{c.plate}</td>
                      <td className="py-1.5 pr-3 text-right">{film.metres || "–"}</td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aedText(film.film + film.tint)}</td>
                      <td className="py-1.5 text-xs text-muted">{sections.map((x) => `${(SECTION_LABELS as Record<string, string>)[x.section] ?? x.section} ${x.hours} h (${x.people})`).join(" · ") || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Which cars to price higher: the models that eat sections and film.</p>
          </Card>
        );
      })() : null}
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
      <Card id="commissions" className="flex flex-col gap-2" data-commissions>
        <SectionLabel right={s.commissionsUnpaid ? `${aedText(s.commissionsUnpaid)} not paid` : `${s.commissions.length}`}>Commissions</SectionLabel>
        {s.commissions.length === 0 ? <p className="text-sm text-muted">No commissions on the jobs of this month.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-[0.08em] text-muted"><th className="py-1 pr-3">Job</th><th className="py-1 pr-3">Car</th><th className="py-1 pr-3">To</th><th className="py-1 pr-3 text-right">Amount</th><th className="py-1 pr-3">Status</th><th className="py-1" /></tr></thead>
              <tbody>
                {s.commissions.map((c) => (
                  <tr key={c.quotationId} className="border-t border-line" data-commission={c.number}>
                    <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={`/reports/jobs/${c.jobId}`} className="font-bold underline underline-offset-4">{c.jobNumber}</Link>{c.inMonth ? "" : <span className="block text-xs text-muted">earlier month</span>}</td>
                    <td className="py-1.5 pr-3">{c.plate}<span className="block whitespace-nowrap text-xs text-muted">{c.number}</span></td>
                    <td className="py-1.5 pr-3">{c.to || "–"}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap font-semibold">{aedText(c.amount)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{c.paidAt ? <Badge tone="green">Paid {formatDate(c.paidAt)}</Badge> : <Badge tone="amber">Not paid</Badge>}</td>
                    <td className="py-1.5 text-right">{c.paidAt ? null : <form action={markCommissionPaid.bind(null, c.quotationId)}><input type="hidden" name="month" value={month} /><Button type="submit" size="md" data-mark-paid>Mark paid</Button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Commissions count against the profit of the quotation and never appear on anything the customer sees. Unpaid ones from earlier months stay here until marked paid.</p>
      </Card>
      <Card id="markup-skipped" className="flex flex-col gap-2" data-markup-skipped>
        <SectionLabel right={`${s.markupSkipped.length}`}>Parts markup left at the minimum</SectionLabel>
        {s.markupSkipped.length === 0 ? <p className="text-sm text-muted">Nobody pressed &quot;Continue anyway&quot; on the markup reminder this month.</p> : (
          <ul className="divide-y divide-line text-sm">
            {s.markupSkipped.map((m) => (
              <li key={`${m.quote}-${m.at}`} className="py-1.5 flex flex-wrap items-center gap-2" data-markup-skipped-row>
                <span className="font-semibold">{m.quote}</span>
                <span className="text-muted">· {m.by} · {formatDate(m.at)}</span>
                {m.jobId ? <Link href={`/jobs/${m.jobId}`} className="ml-auto underline underline-offset-4 text-xs font-semibold">Job card</Link> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
