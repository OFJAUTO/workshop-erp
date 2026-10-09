"use client";

import { useEffect, useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { Badge, Button, Card, Notice, SectionLabel, Select, Textarea } from "@/components/ui";

export type PanelLine = { id: string; title: string; details: string | null; hours_quoted: number | null; status: "todo" | "in_progress" | "done" };
export type PanelPart = { id: string; description: string; quantity: number; state: "handed" | "here" | "coming"; when: string | null };
export type PanelFinding = { id: string; remark: string; parts_needed: string | null; status: "pending" | "approved" | "rejected"; decision_note: string | null; label: string; tone: "neutral" | "amber" | "green" | "red" | "ink" };
export type QcFailed = { round: number; items: { label: string; remark: string | null }[] };
export type RunningSession = { since: string; name: string; mine: boolean };

const fmtHm = (min: number) => {
  const m = Math.max(0, Math.round(Math.abs(min)));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

/**
 * The one big countdown on the technician's tablet: the hours charged to the customer minus every
 * technician's clocked time on this car. Green, amber under a fifth left, red once over.
 */
export function BudgetTimer({ hoursCharged, minutesUsed, running, locked }: { hoursCharged: number; minutesUsed: number; running: RunningSession[]; locked: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running.length]);
  const live = running.reduce((a, r) => a + Math.max(0, (now - Date.parse(r.since)) / 60000), 0);
  const used = minutesUsed + live;
  const budget = hoursCharged * 60;
  const left = budget - used;
  const tone = budget <= 0 ? "text-ink" : left < 0 ? "text-red" : left < budget * 0.2 ? "text-amber" : "text-green";
  return (
    <div className="flex flex-col items-center gap-1 py-2 text-center">
      <span className="text-xs font-bold uppercase tracking-[0.1em] text-muted">{locked ? "Clock stopped" : left < 0 ? "Over the time" : "Time left"}</span>
      <span className={`text-5xl sm:text-6xl font-extrabold tabular-nums leading-none ${tone}`}>{budget > 0 ? (left < 0 ? `+${fmtHm(left)}` : fmtHm(left)) : fmtHm(used)}</span>
      <span className="text-sm font-semibold text-muted">{budget > 0 ? `of ${hoursCharged} h charged · used ${fmtHm(used)}` : "no hours quoted on this car"}</span>
      {running.length ? <span className="text-xs font-semibold text-green">Working now: {running.map((r) => r.name).join(", ")}</span> : null}
    </div>
  );
}

/** Timer, Working and Pause, Leave this job. Sits at the top of the technician's screen. */
export function WorkClock({ hoursCharged, minutesUsed, running, mineRunning, reminders, pauseReasons, canWork, workDone, waitingOnManager, sendBack, qcFailed = null, startAction, pauseAction, leaveAction }: { hoursCharged: number; minutesUsed: number; running: RunningSession[]; mineRunning: boolean; reminders: string[]; pauseReasons: readonly string[]; canWork: boolean; workDone: boolean; waitingOnManager: string; sendBack: string | null; qcFailed?: QcFailed | null; startAction: () => void; pauseAction: (formData: FormData) => void; leaveAction: (formData: FormData) => void }) {
  const [pausing, setPausing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {sendBack ? (
        <Card className="border-red-bar flex flex-col gap-1">
          <SectionLabel>Not done, sent back by the manager</SectionLabel>
          <p className="text-[15px] font-semibold">{sendBack}</p>
        </Card>
      ) : null}
      {qcFailed ? (
        <Card className="border-red-bar flex flex-col gap-2">
          <SectionLabel right={`round ${qcFailed.round}`}>QC failed: fix these, then press Job finished again</SectionLabel>
          <ul className="flex flex-col gap-1">
            {qcFailed.items.map((i) => (
              <li key={i.label} className="text-[15px]"><span className="font-bold">{i.label}</span>{i.remark ? <span className="text-muted"> · {i.remark}</span> : null}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card className={`flex flex-col gap-3 ${mineRunning ? "border-green" : workDone ? "border-line" : "border-ink"}`}>
        <BudgetTimer hoursCharged={hoursCharged} minutesUsed={minutesUsed} running={running} locked={workDone} />
        {reminders.length && !mineRunning && !workDone ? (
          <ul className="flex flex-col gap-1">
            {reminders.map((r) => <li key={r}><Notice tone="error">{r}</Notice></li>)}
          </ul>
        ) : null}
        {workDone ? (
          <Notice tone="info">Job finished. Waiting on {waitingOnManager} to confirm the work. The clock is locked.</Notice>
        ) : canWork ? (
          <div className="flex flex-col gap-2">
            {pausing ? (
              <form action={pauseAction} className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Why do you pause? Tap one.</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {pauseReasons.map((r) => <Button key={r} type="submit" name="pause_reason" value={r} tone="secondary" size="lg">{r}</Button>)}
                </div>
                <Button type="button" tone="ghost" size="md" onClick={() => setPausing(false)}>Back</Button>
              </form>
            ) : leaving ? (
              <form action={leaveAction} className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Why do you leave this job?</span>
                <Textarea name="reason" rows={2} required placeholder="For example: moved to another car by the manager" />
                <div className="flex gap-2">
                  <Button type="submit" tone="danger" size="lg">Leave this job</Button>
                  <Button type="button" tone="ghost" size="lg" onClick={() => setLeaving(false)}>Back</Button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <form action={startAction} className="contents"><Button type="submit" size="lg" className="min-h-16 text-lg" disabled={mineRunning} tone={mineRunning ? "secondary" : "primary"}>{mineRunning ? "Working…" : "Working"}</Button></form>
                <Button type="button" size="lg" tone="secondary" className="min-h-16 text-lg" disabled={!mineRunning} onClick={() => setPausing(true)}>Pause</Button>
              </div>
            )}
            {!pausing && !leaving ? <button type="button" onClick={() => setLeaving(true)} className="self-end text-xs font-semibold text-muted underline underline-offset-4">Leave this job</button> : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/** The read-only job list with the parts, "Additional work found", and "Job finished". */
export function WorkJobs({ jobId, lines, parts, findings, canWork, workDone, severalTechnicians, myPartDone, finishAction, reportAction }: { jobId: string; lines: PanelLine[]; parts: PanelPart[]; findings: PanelFinding[]; canWork: boolean; workDone: boolean; severalTechnicians: boolean; myPartDone: boolean; finishAction: () => void; reportAction: (formData: FormData) => void }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [findingFiles, setFindingFiles] = useState<JobFile[]>([]);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${lines.length} job${lines.length === 1 ? "" : "s"}`}>Jobs on this car</SectionLabel>
        {lines.length === 0 ? <p className="text-sm text-muted">No work lines yet.</p> : null}
        <ol className="divide-y divide-line">
          {lines.map((l, i) => (
            <li key={l.id} className="py-2 flex gap-3">
              <span className="w-6 shrink-0 text-muted font-semibold">{i + 1}.</span>
              <span className="flex-1 min-w-0">
                <span className="text-[16px] font-bold leading-snug">{l.title}</span>
                {l.details ? <span className="block text-sm text-muted">{l.details}</span> : null}
              </span>
              {l.hours_quoted !== null ? <span className="text-sm font-semibold text-muted whitespace-nowrap">{l.hours_quoted.toFixed(1)} h</span> : null}
            </li>
          ))}
        </ol>
        {parts.length ? (
          <ul className="border-t border-line pt-2 flex flex-col gap-1">
            {parts.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${p.state === "handed" ? "bg-green text-white" : p.state === "here" ? "bg-ink text-white" : "bg-chip text-muted"}`}>{p.state === "handed" ? "✓" : p.state === "here" ? "•" : "…"}</span>
                <span className="font-semibold">{p.description}</span>
                <span className="text-muted">× {p.quantity}</span>
                <span className="ml-auto text-xs font-semibold text-muted">{p.state === "handed" ? "Handed to you" : p.state === "here" ? "Here, with Parts" : p.when ? `Coming ${p.when}` : "Coming"}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel right={findings.length ? `${findings.length}` : undefined}>Additional work found</SectionLabel>
          {canWork && !reportOpen && !workDone ? <Button type="button" tone="secondary" size="md" onClick={() => setReportOpen(true)}>Additional work found</Button> : null}
        </div>
        {findings.map((f) => (
          <p key={f.id} className="text-sm flex flex-wrap items-center gap-2">
            <Badge tone={f.tone}>{f.label}</Badge>
            <span>{f.remark}</span>
            {f.decision_note ? <span className="text-muted">· {f.decision_note}</span> : null}
          </p>
        ))}
        {reportOpen ? (
          <form action={reportAction} className="flex flex-col gap-2 rounded-control border border-ink p-3">
            <label className="flex flex-col gap-1"><span className="text-sm font-semibold">What did you find?</span><Textarea name="remark" rows={2} required placeholder="For example: rear brake discs below minimum thickness" /></label>
            <label className="flex flex-col gap-1"><span className="text-sm font-semibold">Parts needed <span className="font-medium text-muted">(optional)</span></span><Textarea name="parts_needed" rows={1} placeholder="For example: rear brake discs and pads" /></label>
            {lines.length ? (
              <label className="flex flex-col gap-1"><span className="text-sm font-semibold">Related job <span className="font-medium text-muted">(optional)</span></span>
                <Select name="work_line_id" defaultValue=""><option value="">None</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</Select>
              </label>
            ) : null}
            <JobFileUpload jobId={jobId} kind="additional_work" files={findingFiles} label="Add photos" onAdded={(f) => setFindingFiles((p) => [...p, f])} />
            {findingFiles.map((f) => <input key={f.id} type="hidden" name="file" value={f.id} />)}
            <p className="text-xs text-muted">The workshop manager gets it at once and sends it to the advisor to quote, or dismisses it. Carry on with the original work.</p>
            <div className="flex gap-2">
              <Button type="submit" size="lg">Send to the manager</Button>
              <Button type="button" tone="ghost" size="lg" onClick={() => setReportOpen(false)}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </Card>

      {canWork && !workDone ? (
        <Card className="flex flex-col gap-2 border-ink">
          {myPartDone && severalTechnicians ? (
            <Notice tone="info">Your part is done. Waiting for the other technicians on this car.</Notice>
          ) : confirming ? (
            <div className="flex flex-col gap-3">
              <p className="text-lg font-bold">{severalTechnicians ? "Is your part of the work on this car done?" : "All work on this car is done?"}</p>
              <div className="grid grid-cols-2 gap-2">
                <form action={finishAction} className="contents"><Button type="submit" size="lg" className="min-h-16 text-lg">Yes</Button></form>
                <Button type="button" tone="secondary" size="lg" className="min-h-16 text-lg" onClick={() => setConfirming(false)}>Not yet</Button>
              </div>
            </div>
          ) : (
            <Button type="button" size="lg" className="min-h-16 text-lg" onClick={() => setConfirming(true)}>{severalTechnicians ? "My part is done" : "Job finished"}</Button>
          )}
        </Card>
      ) : null}
    </div>
  );
}
