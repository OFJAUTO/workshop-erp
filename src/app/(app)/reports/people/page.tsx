import { redirect } from "next/navigation";
import { Card, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { monthlySummary, type PersonLine } from "@/lib/owner-report";
import { getSettings } from "@/lib/settings";
import { ReportTabs, aedText, monthParam } from "../ReportTabs";

export const dynamic = "force-dynamic";

const hm = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}`;

function Table({ title, rows, cols }: { title: string; rows: PersonLine[]; cols: { label: string; value: (l: PersonLine) => string; right?: boolean; warn?: (l: PersonLine) => boolean }[] }) {
  return (
    <Card className="flex flex-col gap-2">
      <SectionLabel right={`${rows.length}`}>{title}</SectionLabel>
      {rows.length === 0 ? <p className="text-sm text-muted">Nobody this month.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-[0.08em] text-muted"><th className="py-1 pr-3">Name</th>{cols.map((c) => <th key={c.label} className={`py-1 pr-3 ${c.right ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.name} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-bold whitespace-nowrap">{l.name}</td>
                  {cols.map((c) => <td key={c.label} className={`py-1.5 pr-3 whitespace-nowrap ${c.right ? "text-right" : ""} ${c.warn?.(l) ? "text-red font-bold" : ""}`}>{c.value(l)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** One line per person for the month, from the reports of the jobs they touched. */
export default async function PeopleReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { month: m } = await searchParams;
  const month = monthParam(m);
  const s = await monthlySummary(await getSettings(), month);
  return (
    <>
      <PageHeader title="People" subtitle={`${s.label}: what each person did on the jobs gated out this month. Efficiency is hours charged against hours on the clock (100% means the time matched the quotation).`} />
      <ReportTabs current="/reports/people" month={month} />
      <Table title="Technicians" rows={s.technicians} cols={[
        { label: "Jobs", value: (l) => `${l.jobs}`, right: true },
        { label: "On the clock", value: (l) => hm(l.minutes), right: true },
        { label: "Hours charged", value: (l) => `${l.hoursCharged.toFixed(1)}`, right: true },
        { label: "Efficiency", value: (l) => (l.efficiencyPercent === null ? "–" : `${l.efficiencyPercent}%`), right: true, warn: (l) => l.efficiencyPercent !== null && l.efficiencyPercent < 75 },
        { label: "QC send-backs", value: (l) => `${l.qcSendbacks}`, right: true, warn: (l) => l.qcSendbacks >= 2 },
        { label: "Manager send-backs", value: (l) => `${l.managerSendbacks}`, right: true, warn: (l) => l.managerSendbacks >= 2 },
        { label: "Needs a talk", value: (l) => `${l.talk}`, right: true, warn: (l) => l.talk > 0 },
      ]} />
      <Table title="Service advisors" rows={s.advisors} cols={[
        { label: "Jobs", value: (l) => `${l.jobs}`, right: true },
        { label: "Invoiced", value: (l) => aedText(l.invoiced), right: true },
        { label: "Profit", value: (l) => aedText(l.profit), right: true, warn: (l) => l.profit < 0 },
        { label: "Discounts given", value: (l) => aedText(l.discount), right: true },
        { label: "Needs a talk", value: (l) => `${l.talk}`, right: true, warn: (l) => l.talk > 0 },
      ]} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Table title="Workshop managers" rows={s.managers} cols={[
          { label: "Jobs", value: (l) => `${l.jobs}`, right: true },
          { label: "Send-backs given", value: (l) => `${l.managerSendbacks}`, right: true },
          { label: "QC fails on their jobs", value: (l) => `${l.qcSendbacks}`, right: true, warn: (l) => l.qcSendbacks >= 3 },
        ]} />
        <Table title="QC" rows={s.qc} cols={[
          { label: "Jobs checked", value: (l) => `${l.jobs}`, right: true },
          { label: "Fails given", value: (l) => `${l.qcSendbacks}`, right: true },
        ]} />
      </div>
    </>
  );
}
