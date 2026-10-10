import { notFound, redirect } from "next/navigation";
import { Badge, Card, DescriptionList, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { VERDICT_LABELS } from "@/lib/job-summary";
import { hoursText, ownerReportFor } from "@/lib/owner-report";
import { getSettings } from "@/lib/settings";
import { aedText, verdictTone } from "../../ReportTabs";

export const dynamic = "force-dynamic";

const rows = (items: { label: string; value: React.ReactNode }[]) => items.filter((i) => i.value !== null && i.value !== undefined && i.value !== "");
const hm = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`;

/** The owner's report on one job: verdict, money, time, people, delays, customer, flags. */
export default async function JobReportPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { id } = await params;
  const r = await ownerReportFor(id, await getSettings());
  if (!r) notFound();
  const month = (r.time.gatedOutAt ?? r.time.gatedInAt).slice(0, 7);
  return (
    <>
      <PageHeader
        title={`${r.plate} · ${r.jobNumber}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span>{r.title}</span><Badge tone={verdictTone(r.verdict)}>{VERDICT_LABELS[r.verdict]}</Badge>{r.loose ? <Badge tone="ink">Loose items</Badge> : null}{!r.time.gatedOutAt ? <Badge tone="amber">Still open, live figures</Badge> : null}</span>}
        actions={<><LinkButton href={`/reports/cars?month=${month}`} tone="secondary" size="lg">Finished cars</LinkButton><LinkButton href={`/jobs/${id}`} tone="secondary" size="lg">Job card</LinkButton></>}
      />
      {r.reasons.length ? (
        <Card className={`flex flex-col gap-1 ${r.verdict === "talk" ? "border-red-bar" : r.verdict === "acceptable" ? "border-amber-bar" : "border-green"}`}>
          <SectionLabel>Why {VERDICT_LABELS[r.verdict].toLowerCase()}</SectionLabel>
          <ul className="list-disc pl-5 text-sm font-semibold">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="flex flex-col gap-2">
          <SectionLabel>Money</SectionLabel>
          <DescriptionList items={rows([
            { label: "Invoice", value: r.money.invoiceNumber ? `${r.money.invoiceNumber}${r.money.invoiceKind === "proforma" ? " (proforma)" : ""}` : "None" },
            { label: "Invoiced before VAT", value: aedText(r.money.invoiced) },
            { label: "Discount", value: r.money.discount ? aedText(r.money.discount) : null },
            { label: "Parts cost", value: r.money.partsCost ? aedText(r.money.partsCost) : null },
            { label: "Technician time", value: r.money.labourCost ? aedText(r.money.labourCost) : null },
            { label: "Other costs", value: r.money.otherCost ? aedText(r.money.otherCost) : null },
            { label: "Profit", value: <span className={r.money.profit !== null && r.money.profit < 0 ? "font-bold text-red" : "font-bold"}>{aedText(r.money.profit)}{r.money.marginPercent !== null ? ` · ${r.money.marginPercent}%` : ""}{r.money.provisional ? " (provisional)" : ""}</span> },
            { label: "Collected", value: aedText(r.money.collected) },
            { label: "Balance", value: r.money.balance > 0 ? <span className="font-bold text-red">{aedText(r.money.balance)}</span> : "Nothing due" },
          ])} />
        </Card>
        <Card className="flex flex-col gap-2">
          <SectionLabel>Time</SectionLabel>
          <DescriptionList items={rows([
            { label: "Gated in", value: formatDateTime(r.time.gatedInAt) },
            { label: "Promised", value: r.time.promisedAt ? formatDate(r.time.promisedAt) : "No date promised" },
            { label: "Gated out", value: r.time.gatedOutAt ? formatDateTime(r.time.gatedOutAt) : "Still here" },
            { label: "In the workshop", value: `${r.time.days} day${r.time.days === 1 ? "" : "s"} · ${hoursText(r.time.workingHours)}` },
            { label: "Hours charged", value: `${r.time.hoursCharged.toFixed(1)} h` },
            { label: "On the clock", value: hm(r.time.minutesUsed) },
            { label: "Late", value: r.time.daysLate ? <span className="font-bold text-red">{r.time.daysLate} day{r.time.daysLate === 1 ? "" : "s"}</span> : "On time" },
          ])} />
        </Card>
        <Card className="flex flex-col gap-2">
          <SectionLabel>People</SectionLabel>
          <DescriptionList items={rows([
            { label: "Advisor", value: r.people.advisor },
            { label: "Manager", value: r.people.manager },
            { label: "Technicians", value: r.people.technicians.length ? r.people.technicians.map((t) => `${t.name} (${hm(t.minutes)})`).join(", ") : null },
            { label: "QC", value: r.people.qc },
            { label: "Gate-in", value: r.people.gateIn },
            { label: "Gate-out", value: r.people.gateOut },
          ])} />
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="flex flex-col gap-2 lg:col-span-2">
          <SectionLabel>Where the time went</SectionLabel>
          <ul className="divide-y divide-line">
            {r.stages.map((s) => (
              <li key={s.stage} className="py-1.5 flex items-center gap-3 text-sm">
                <span className="w-24 font-bold">{s.label}</span>
                <span className="flex-1 h-2 rounded-full bg-track overflow-hidden"><span className={`block h-full ${s.over ? "bg-red-bar" : "bg-ink"}`} style={{ width: `${Math.min(100, (s.hours / Math.max(1, r.time.workingHours)) * 100)}%` }} /></span>
                <span className={`w-36 text-right ${s.over ? "font-bold text-red" : ""}`}>{hoursText(s.hours)}{s.targetHours ? <span className="text-xs text-muted"> / {hoursText(s.targetHours)}</span> : null}</span>
              </li>
            ))}
          </ul>
          {r.delays.length ? <ul className="list-disc pl-5 text-sm font-semibold text-red">{r.delays.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="text-sm text-muted">No step took longer than its target.</p>}
        </Card>
        <Card className="flex flex-col gap-2">
          <SectionLabel>Customer</SectionLabel>
          <DescriptionList items={rows([
            { label: "Name", value: <span className="flex items-center gap-2">{r.customer.name}{r.customer.vip ? <Badge tone="ink">VIP</Badge> : null}</span> },
            { label: "Phone", value: r.customer.phone },
            { label: "Visits", value: `${r.customer.visits}` },
            { label: "Comeback of", value: r.customer.comebackOf ? "an earlier job" : null },
            { label: "Came back on", value: r.customer.cameBack.length ? r.customer.cameBack.join(", ") : null },
          ])} />
        </Card>
      </div>
      <Card className={`flex flex-col gap-2 ${r.flags.length ? "border-amber-bar" : ""}`}>
        <SectionLabel right={`${r.flags.length}`}>Things to look at</SectionLabel>
        {r.flags.length ? <ul className="list-disc pl-5 text-sm font-semibold">{r.flags.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="text-sm text-muted">Nothing. A clean job.</p>}
        <p className="text-xs text-muted">Written {formatDateTime(r.generatedAt)}.</p>
      </Card>
    </>
  );
}
