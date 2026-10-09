import Link from "next/link";
import { Badge, Card, Empty, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import type { JobSummary } from "@/lib/job-summary";
import { dubaiDate } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const hm = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`;
type Row = { id: string; name: string; jobs: number; hoursCharged: number; minutesUsed: number; qcSendbacks: number; managerSendbacks: number; pauses: number; pauseMinutes: number; notAccepted: number; comebacks: number; good: number; talk: number };

/** The technician scoreboard, one month at a time: cars finished, hours charged against hours used, QC and manager send-backs, pauses, and comebacks for workmanship. Owner and managers only. */
export default async function ScoreboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePermission("manageWork");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : dubaiDate().slice(0, 7);
  const from = new Date(`${month}-01T00:00:00+04:00`).toISOString();
  const next = new Date(`${month}-01T00:00:00+04:00`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const to = next.toISOString();
  const admin = createAdminClient();
  const [{ data: techs }, { data: jobs }, { data: pauses }, { data: comebacks }] = await Promise.all([
    admin.from("staff").select("id, display_name").eq("role_id", "technician").eq("is_active", true).order("display_name"),
    admin.from("jobs").select("id, job_number, summary, summary_verdict, summary_at").not("summary_at", "is", null).gte("summary_at", from).lt("summary_at", to),
    admin.from("work_pauses").select("technician_id, minutes, accepted, ended_at, started_at").eq("is_active", true).gte("started_at", from).lt("started_at", to),
    admin.from("jobs").select("id, job_number, comeback_of").eq("comeback_cause", "workmanship").not("comeback_confirmed_at", "is", null).gte("comeback_confirmed_at", from).lt("comeback_confirmed_at", to),
  ]);
  const rows = new Map<string, Row>((techs ?? []).map((t) => [t.id, { id: t.id, name: t.display_name, jobs: 0, hoursCharged: 0, minutesUsed: 0, qcSendbacks: 0, managerSendbacks: 0, pauses: 0, pauseMinutes: 0, notAccepted: 0, comebacks: 0, good: 0, talk: 0 }]));
  for (const j of jobs ?? []) {
    const s = j.summary as unknown as JobSummary | null;
    if (!s) continue;
    const total = s.perTechnician.reduce((a, t) => a + t.minutes, 0);
    for (const t of s.perTechnician) {
      const r = rows.get(t.id);
      if (!r) continue;
      r.jobs++;
      r.hoursCharged += total > 0 ? s.hoursCharged * (t.minutes / total) : s.hoursCharged / s.perTechnician.length;
      r.minutesUsed += t.minutes;
      r.qcSendbacks += t.qcSendbacks;
      r.managerSendbacks += t.managerSendbacks;
      if ((j.summary_verdict ?? s.verdict) === "good") r.good++;
      if ((j.summary_verdict ?? s.verdict) === "talk") r.talk++;
    }
  }
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const nowMs = Date.now();
  for (const p of pauses ?? []) {
    const r = rows.get(p.technician_id);
    if (!r) continue;
    r.pauses++;
    r.pauseMinutes += p.minutes !== null ? Number(p.minutes) : p.ended_at ? 0 : Math.round((nowMs - Date.parse(p.started_at)) / 60000);
    if (p.accepted === false) r.notAccepted++;
  }
  // A workmanship comeback counts against the technicians of the original job.
  const originals = (comebacks ?? []).map((c) => c.comeback_of).filter((x): x is string => !!x);
  if (originals.length) {
    const { data: jt } = await admin.from("job_technicians").select("job_id, staff_id").in("job_id", originals).eq("is_active", true);
    for (const t of jt ?? []) {
      const r = rows.get(t.staff_id);
      if (r) r.comebacks++;
    }
  }
  const list = Array.from(rows.values()).sort((a, b) => b.jobs - a.jobs);
  const shift = (n: number) => {
    const d = new Date(`${month}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 7);
  };
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(`${month}-01T12:00:00+04:00`));
  return (
    <>
      <PageHeader title="Scoreboard" subtitle={`${label} · ${(jobs ?? []).length} car${(jobs ?? []).length === 1 ? "" : "s"} finished`} actions={<span className="flex gap-2"><Link href={`/scoreboard?month=${shift(-1)}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold">Previous month</Link><Link href={`/scoreboard?month=${shift(1)}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold">Next month</Link></span>} />
      {list.length === 0 ? <Empty title="No technicians" /> : null}
      <Card className="p-0 overflow-x-auto">
        <SectionLabel>Per technician</SectionLabel>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-[0.08em] text-muted border-b border-line">
              <th className="px-5 py-2">Technician</th><th className="px-3 py-2">Cars</th><th className="px-3 py-2">Hours charged</th><th className="px-3 py-2">Hours used</th><th className="px-3 py-2">Difference</th><th className="px-3 py-2">QC send-backs</th><th className="px-3 py-2">Manager send-backs</th><th className="px-3 py-2">Pauses</th><th className="px-3 py-2">Comebacks</th><th className="px-3 py-2">Verdicts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((r) => {
              const diff = r.hoursCharged * 60 - r.minutesUsed;
              return (
                <tr key={r.id}>
                  <td className="px-5 py-2 font-semibold">{r.name}</td>
                  <td className="px-3 py-2">{r.jobs}</td>
                  <td className="px-3 py-2">{r.hoursCharged.toFixed(1)} h</td>
                  <td className="px-3 py-2">{hm(r.minutesUsed)}</td>
                  <td className={`px-3 py-2 font-semibold ${diff < 0 ? "text-red" : "text-green"}`}>{r.jobs ? `${diff < 0 ? "−" : "+"}${hm(Math.abs(diff))}` : ""}</td>
                  <td className={`px-3 py-2 ${r.qcSendbacks ? "text-red font-semibold" : ""}`}>{r.qcSendbacks}</td>
                  <td className={`px-3 py-2 ${r.managerSendbacks ? "text-amber font-semibold" : ""}`}>{r.managerSendbacks}</td>
                  <td className="px-3 py-2">{r.pauses ? `${r.pauses} · ${hm(r.pauseMinutes)}${r.notAccepted ? ` · ${r.notAccepted} not accepted` : ""}` : "0"}</td>
                  <td className={`px-3 py-2 ${r.comebacks ? "text-red font-semibold" : ""}`}>{r.comebacks}</td>
                  <td className="px-3 py-2 flex flex-wrap gap-1">{r.good ? <Badge tone="green">{r.good} good</Badge> : null}{r.talk ? <Badge tone="red">{r.talk} needs a talk</Badge> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted">Hours charged are shared between the technicians on a car by their clocked time. Comebacks are those the owner confirmed as our workmanship, counted against the original job&apos;s technicians.</p>
    </>
  );
}
