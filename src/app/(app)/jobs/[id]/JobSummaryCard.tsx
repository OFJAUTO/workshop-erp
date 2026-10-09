import { Badge, Button, Card, SectionLabel, Textarea } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import type { JobSummary } from "@/lib/job-summary";
import { VERDICT_LABELS } from "@/lib/job-summary";
import type { RoleId } from "@/lib/roles";
import type { JobRow } from "@/lib/types";
import { commentJobSummary } from "../summary-actions";

const hm = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`;
const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;

/** The job summary after QC: the verdict, the hours, on time, quality, pauses, parts, profit (owner), and the manager's one-line comment. */
export function JobSummaryCard({ jobId, job, role, viewingAs }: { jobId: string; job: JobRow; role: RoleId; viewingAs: boolean }) {
  const s = job.summary as unknown as JobSummary | null;
  if (!s) return null;
  const verdict = job.summary_verdict ?? s.verdict;
  const tone = verdict === "good" ? "green" : verdict === "talk" ? "red" : "amber";
  const canComment = (role === "owner" || role === "workshop_manager") && !viewingAs;
  const seesProfit = role === "owner";
  const rows: [string, string][] = [
    ["Hours", `${s.hoursCharged} h charged · ${hm(s.minutesUsed)} used · ${s.hoursCharged > 0 ? `${s.minutesUsed - s.hoursCharged * 60 >= 0 ? "+" : "−"}${hm(Math.abs(s.minutesUsed - s.hoursCharged * 60))}` : "no hours quoted"}`],
    ["Per technician", s.perTechnician.map((t) => `${t.name} ${hm(t.minutes)}`).join(" · ") || "nobody clocked"],
    ["On time", s.promisedAt ? (s.daysLate ? `${s.daysLate} day${s.daysLate === 1 ? "" : "s"} late (promised ${formatDate(s.promisedAt)})` : `Yes, promised ${formatDate(s.promisedAt)}`) : "No promised date"],
    ["Quality", `QC round${s.qcRounds === 1 ? "" : "s"} ${s.qcRounds}${s.managerSendbacks ? ` · sent back by the manager ${s.managerSendbacks}×` : ""}`],
    ["Pauses", s.pauses.count ? `${s.pauses.count} · ${hm(s.pauses.minutes)}${s.pauses.notAccepted ? ` · ${s.pauses.notAccepted} not accepted` : ""}` : "None"],
    ["Parts", s.parts.count ? `${s.parts.count}${s.parts.late ? ` · ${s.parts.late} arrived after the start day` : ""}` : "None"],
    ...(seesProfit && s.quotedProfit !== null ? ([["Profit vs quotation", `${aed(s.actualProfit ?? 0)} against ${aed(s.quotedProfit)} quoted (${(s.actualProfit ?? 0) - s.quotedProfit >= 0 ? "+" : "−"}${aed(Math.abs((s.actualProfit ?? 0) - s.quotedProfit))})`]] as [string, string][]) : []),
  ];
  return (
    <Card id="summary" className={`flex flex-col gap-3 ${tone === "green" ? "border-green" : tone === "red" ? "border-red-bar" : "border-amber-bar"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel right={job.summary_at ? formatDateTime(job.summary_at) : undefined}>Job summary</SectionLabel>
        <Badge tone={tone}>{VERDICT_LABELS[verdict]}</Badge>
      </div>
      {s.reasons.length ? <p className="text-sm font-semibold">{s.reasons.join(" · ")}</p> : null}
      <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>))}
      </dl>
      {job.summary_comment ? <p className="text-sm border-t border-line pt-2"><span className="text-muted">Manager:</span> {job.summary_comment}</p> : null}
      {canComment ? (
        <form action={commentJobSummary.bind(null, jobId)} className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
          <Textarea name="comment" rows={1} defaultValue={job.summary_comment ?? ""} placeholder="One line from the manager (optional)" className="flex-1 min-w-64" />
          <Button type="submit" tone="secondary" size="md">Save comment</Button>
        </form>
      ) : null}
    </Card>
  );
}
