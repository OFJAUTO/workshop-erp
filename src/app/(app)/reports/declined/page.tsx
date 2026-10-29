import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { declinedCarsReport } from "@/lib/declined-report";
import { formatDate } from "@/lib/format";
import { monthLabel } from "@/lib/owner-report";
import { getSettings } from "@/lib/settings";
import { hoursAndMinutes } from "@/lib/time-spent";
import { ReportTabs, monthParam } from "../ReportTabs";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Declined cars (29 October 2026, batch 2 section 2), the owner's: the cars whose customer approved nothing this
 * month - clocked time, its cost, the inspection fees charged, the net and the time's worth at the selling rate - and
 * per advisor how many inspected cars turned into approved work.
 */
export default async function DeclinedCarsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { month: m } = await searchParams;
  const month = monthParam(m);
  const r = await declinedCarsReport(month, await getSettings());
  const t = r.totals;
  return (
    <>
      <PageHeader title="Declined cars" subtitle={`${monthLabel(month)}: cars whose customer approved nothing - the time they took, the inspection fees charged and what the time was worth.`} />
      <ReportTabs current="/reports/declined" month={month} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6" data-declined-totals>
        {[
          ["Cars", String(t.cars)],
          ["Clocked time", hoursAndMinutes(t.clockedMinutes)],
          ["Cost", aed(t.cost)],
          ["Inspection fees", aed(t.fees)],
          ["Net", aed(t.net)],
          ["Worth at selling rate", aed(t.worth)],
        ].map(([label, value]) => (
          <Card key={label} className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
            <span className={`text-lg font-extrabold ${label === "Net" && t.net < 0 ? "text-red" : ""}`}>{value}</span>
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-2" data-declined-cars>
        <SectionLabel right={`${r.cars.length}`}>Cars</SectionLabel>
        {r.cars.length === 0 ? (
          <p className="text-sm text-muted">No car was declined this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="py-1 pr-3">Car</th><th className="py-1 pr-3">Declined</th><th className="py-1 pr-3 text-right">Clocked</th><th className="py-1 pr-3 text-right">Cost</th><th className="py-1 pr-3 text-right">Fee</th><th className="py-1 pr-3 text-right">Net</th><th className="py-1 pr-3 text-right">Worth</th>
                </tr>
              </thead>
              <tbody>
                {r.cars.map((c) => (
                  <tr key={c.jobId} className="border-t border-line">
                    <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={`/jobs/${c.jobId}`} className="font-bold underline underline-offset-4">{c.plate || c.jobNumber}</Link> <span className="text-muted">· {c.jobNumber}</span></td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(c.declinedAt)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{hoursAndMinutes(c.clockedMinutes)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aed(c.cost)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aed(c.fee)}</td>
                    <td className={`py-1.5 pr-3 text-right whitespace-nowrap font-bold ${c.net < 0 ? "text-red" : ""}`}>{aed(c.net)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{aed(c.worth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="flex flex-col gap-2" data-declined-advisors>
        <SectionLabel>Inspections that turned into approved work</SectionLabel>
        {r.advisors.length === 0 ? (
          <p className="text-sm text-muted">No inspection was approved this month.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {r.advisors.map((a) => (
              <li key={a.name} className="flex flex-wrap justify-between gap-x-3 py-1.5" data-advisor-row>
                <span className="font-bold">{a.name}</span>
                <span>{a.approved} of {a.inspections} inspections · <span className="font-bold">{a.percent}%</span></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
