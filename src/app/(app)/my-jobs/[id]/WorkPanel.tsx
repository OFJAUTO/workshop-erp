"use client";

import { useState } from "react";
import { ElapsedTimer } from "@/components/ElapsedTimer";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { Badge, Button, Card, Notice, SectionLabel, Select, Textarea } from "@/components/ui";

export type PanelLine = { id: string; title: string; details: string | null; hours_quoted: number | null; status: "todo" | "in_progress" | "done"; notes: string | null; mine: boolean; assignedName: string | null; photos: JobFile[] };
export type PanelFinding = { id: string; remark: string; parts_needed: string | null; status: "pending" | "approved" | "rejected"; decision_note: string | null; label: string; tone: "neutral" | "amber" | "green" | "red" | "ink" };

/**
 * The technician's work order on the tablet: Start / Stop / Pause with a reason, each line marked
 * done with notes and photos, reminders at the start, and "additional work found".
 */
export type QcFailed = { round: number; items: { label: string; remark: string | null }[] };

export function WorkPanel({ jobId, lines, findings, running, myMinutes, reminders, pauseReasons, canWork, qcFailed = null, startAction, stopAction, doneAction, reportAction }: { jobId: string; lines: PanelLine[]; findings: PanelFinding[]; running: { since: string } | null; myMinutes: number; reminders: string[]; pauseReasons: readonly string[]; canWork: boolean; qcFailed?: QcFailed | null; startAction: () => void; stopAction: (formData: FormData) => void; doneAction: (lineId: string, formData: FormData) => void; reportAction: (formData: FormData) => void }) {
  const [pausing, setPausing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [photos, setPhotos] = useState<Record<string, JobFile[]>>(Object.fromEntries(lines.map((l) => [l.id, l.photos])));
  const [findingFiles, setFindingFiles] = useState<JobFile[]>([]);
  const mine = lines.filter((l) => l.mine);
  const done = mine.filter((l) => l.status === "done").length;

  return (
    <div className="flex flex-col gap-4">
      {qcFailed ? (
        <Card className="border-red-bar flex flex-col gap-2">
          <SectionLabel right={`round ${qcFailed.round}`}>QC failed: fix these, then the manager sends the car back to QC</SectionLabel>
          <ul className="flex flex-col gap-1">
            {qcFailed.items.map((i) => (
              <li key={i.label} className="text-[15px]"><span className="font-bold">{i.label}</span>{i.remark ? <span className="text-muted"> · {i.remark}</span> : null}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card className={`flex flex-col gap-3 ${running ? "border-green" : "border-ink"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>{running ? "Clock running" : "Clock"}</SectionLabel>
          <span className="text-3xl font-extrabold">{running ? <ElapsedTimer since={running.since} /> : `${Math.floor(myMinutes / 60)}:${String(myMinutes % 60).padStart(2, "0")}`}</span>
        </div>
        {reminders.length && !running ? (
          <ul className="flex flex-col gap-1">
            {reminders.map((r) => <li key={r}><Notice tone="error">{r}</Notice></li>)}
          </ul>
        ) : null}
        {canWork ? (
          running ? (
            <form action={stopAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="mode" value={pausing ? "pause" : "stop"} />
              {pausing ? (
                <div className="flex flex-col gap-2 flex-1">
                  <span className="text-xs font-semibold text-muted">Why do you pause? Tap one.</span>
                  <div className="flex flex-wrap gap-2">
                    {pauseReasons.map((r) => <Button key={r} type="submit" name="pause_reason" value={r} tone="secondary" size="lg">{r}</Button>)}
                    <Button type="button" tone="ghost" size="lg" onClick={() => setPausing(false)}>Back</Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button type="submit" size="lg" tone="secondary">Stop</Button>
                  <Button type="button" size="lg" tone="secondary" onClick={() => setPausing(true)}>Pause with a reason</Button>
                </>
              )}
            </form>
          ) : (
            <form action={startAction}>
              <Button type="submit" size="lg" className="w-full">Start work on this car</Button>
            </form>
          )
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel right={`${done} of ${mine.length} done`}>Your work</SectionLabel>
        {mine.length === 0 ? <p className="text-sm text-muted">No lines assigned to you yet. {lines.length ? `${lines.length} line${lines.length === 1 ? "" : "s"} on this car are with ${Array.from(new Set(lines.map((l) => l.assignedName).filter(Boolean))).join(", ") || "nobody yet"}.` : ""}</p> : null}
        {mine.map((l) => (
          <div key={l.id} className={`rounded-control border p-3 flex flex-col gap-2 ${l.status === "done" ? "border-green bg-green-soft/30" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={l.status === "done" ? "green" : l.status === "in_progress" ? "amber" : "neutral"}>{l.status === "done" ? "Done" : l.status === "in_progress" ? "In progress" : "To do"}</Badge>
              <span className="text-lg font-bold">{l.title}</span>
              {l.hours_quoted !== null ? <span className="text-xs text-muted">{l.hours_quoted.toFixed(1)} h quoted</span> : null}
            </div>
            {l.details ? <p className="text-sm text-muted">{l.details}</p> : null}
            <form action={doneAction.bind(null, l.id)} className="flex flex-col gap-2">
              <Textarea name="notes" rows={2} defaultValue={l.notes ?? ""} placeholder="Notes on this line (optional)" disabled={!canWork} />
              <div className="flex flex-wrap gap-2">
                {l.status !== "done" ? <Button type="submit" name="done" value="yes" size="lg" disabled={!canWork}>Mark done</Button> : <Button type="submit" name="done" value="no" tone="secondary" size="md" disabled={!canWork}>Reopen</Button>}
                {l.status === "done" ? <Button type="submit" name="done" value="yes" tone="ghost" size="md" disabled={!canWork}>Save notes</Button> : null}
              </div>
            </form>
            <JobFileUpload jobId={jobId} kind="work_photo" refId={l.id} files={photos[l.id] ?? []} disabled={!canWork} compact onAdded={(f) => setPhotos((p) => ({ ...p, [l.id]: [...(p[l.id] ?? []), f] }))} />
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel right={findings.length ? `${findings.length}` : undefined}>Additional work found</SectionLabel>
          {canWork && !reportOpen ? <Button type="button" tone="secondary" size="md" onClick={() => setReportOpen(true)}>Flag additional work</Button> : null}
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
            <label className="flex flex-col gap-1"><span className="text-sm font-semibold">Related line <span className="font-medium text-muted">(optional)</span></span>
              <Select name="work_line_id" defaultValue=""><option value="">None</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</Select>
            </label>
            <JobFileUpload jobId={jobId} kind="additional_work" files={findingFiles} label="Add photos" onAdded={(f) => setFindingFiles((p) => [...p, f])} />
            {findingFiles.map((f) => <input key={f.id} type="hidden" name="file" value={f.id} />)}
            <p className="text-xs text-muted">The workshop manager approves it, the advisor quotes it. It cannot start until the customer approves. Carry on with the original work.</p>
            <div className="flex gap-2">
              <Button type="submit" size="lg">Send to the manager</Button>
              <Button type="button" tone="ghost" size="lg" onClick={() => setReportOpen(false)}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </div>
  );
}
