"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "./JobFileUpload";
import { Card, SectionLabel, Textarea } from "./ui";
import { recheckProgress, type RecheckPoint, type RecheckStatus } from "@/lib/recheck-points";
import { reloadIfStale } from "@/lib/app-version";

/**
 * THE PPF recheck checklist (30 October 2026), on the car's bodyshop page on the PPF team's tablet: every point OK or
 * Needs fixing (screen film, tint and ceramic can be Not on this car), with photos and a note. A fix is done under the
 * recheck without a price and ticked Fixed. When every point is answered and every fix ticked, the PPF leader hands the
 * stage over (photos and PIN): the original job's 10-day check is then signed off.
 */
export function RecheckChecklist({ jobId, stageId, originalNumber, points: initial, files, canEdit, done, save }: {
  jobId: string;
  stageId: string | null;
  originalNumber: string;
  points: RecheckPoint[];
  files: JobFile[];
  canEdit: boolean;
  done: string | null;
  save: (key: string, patch: { status?: RecheckStatus; note?: string | null; fixed?: boolean }) => Promise<{ error?: string; points?: RecheckPoint[] }>;
}) {
  const [points, setPoints] = useState(initial);
  const [photos, setPhotos] = useState(files);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, patch: { status?: RecheckStatus; note?: string | null; fixed?: boolean }) => {
    setBusy(key);
    setError(null);
    // On screen at once; the server's answer replaces it.
    setPoints((ps) => ps.map((p) => (p.key === key ? { ...p, ...(patch.status ? { status: patch.status, fixedAt: patch.status === "fix" ? p.fixedAt : null } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}), ...(patch.fixed !== undefined ? { fixedAt: patch.fixed ? new Date().toISOString() : null } : {}) } : p)));
    try {
      const r = await save(key, patch);
      if (r.error) setError(r.error);
      else if (r.points) setPoints(r.points);
    } catch (e) {
      if (!reloadIfStale(e)) setError("No connection. Try again.");
    }
    setBusy(null);
  };
  const chip = (on: boolean, tone: "ok" | "fix" | "na") => `min-h-11 rounded-control border-2 px-3 text-sm font-bold disabled:opacity-60 ${on ? (tone === "ok" ? "border-green bg-green text-white" : tone === "fix" ? "border-red-bar bg-red-bar text-white" : "border-ink bg-ink text-white") : "border-line-strong bg-white"}`;
  return (
    <Card id="recheck" className="flex flex-col gap-3" data-recheck-checklist>
      <SectionLabel right={done ? "Signed off" : recheckProgress(points)}>PPF final check · {originalNumber}</SectionLabel>
      <p className="text-sm text-muted">Free: no price, no invoice. Anything that needs fixing is fixed now, under this visit, and ticked Fixed. Photos on every point you can.</p>
      <ol className="flex flex-col divide-y divide-line">
        {points.map((p, i) => {
          const pointFiles = photos.filter((f) => f.caption === `10-day check · ${p.label}`);
          return (
            <li key={p.key} className="flex flex-col gap-2 py-3" data-recheck-point={p.key} data-recheck-status={p.status ?? "open"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 font-bold">{p.label}</span>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" disabled={!canEdit || !!done || busy === p.key} aria-pressed={p.status === "ok"} onClick={() => run(p.key, { status: "ok" })} className={chip(p.status === "ok", "ok")} data-recheck-ok>OK</button>
                  <button type="button" disabled={!canEdit || !!done || busy === p.key} aria-pressed={p.status === "fix"} onClick={() => run(p.key, { status: "fix" })} className={chip(p.status === "fix", "fix")} data-recheck-fix>Needs fixing</button>
                  {p.optional ? <button type="button" disabled={!canEdit || !!done || busy === p.key} aria-pressed={p.status === "na"} onClick={() => run(p.key, { status: "na" })} className={chip(p.status === "na", "na")} data-recheck-na>Not on this car</button> : null}
                </div>
              </div>
              {p.status === "fix" ? (
                <div className="flex flex-col gap-2 rounded-control border border-red-bar bg-white p-2.5">
                  <Textarea defaultValue={p.note ?? ""} rows={2} disabled={!canEdit || !!done} placeholder="What needed fixing, and what was done" onBlur={(e) => { if ((e.target.value || null) !== p.note) void run(p.key, { note: e.target.value || null }); }} data-recheck-note />
                  <button type="button" disabled={!canEdit || !!done || busy === p.key} aria-pressed={!!p.fixedAt} onClick={() => run(p.key, { fixed: !p.fixedAt })} className={`self-start min-h-11 rounded-control border-2 px-4 text-sm font-bold ${p.fixedAt ? "border-green bg-green text-white" : "border-ink bg-white"}`} data-recheck-fixed>
                    {p.fixedAt ? "Fixed ✓" : "Tick when fixed"}
                  </button>
                </div>
              ) : null}
              {stageId && p.status !== "na" ? (
                <JobFileUpload jobId={jobId} kind="bodyshop_photo" refId={stageId} files={pointFiles} caption={`10-day check · ${p.label}`} compact disabled={!canEdit || !!done} label="Photo" onAdded={(f) => setPhotos((x) => [...x, f])} />
              ) : null}
            </li>
          );
        })}
      </ol>
      {error ? <p className="text-sm font-semibold text-red" data-recheck-error>{error}</p> : null}
      {done ? null : <p className="text-xs text-muted">All answered and fixed: hand the stage over below (photos and the leader&apos;s PIN). The original job&apos;s warranty then shows &quot;Final check done&quot;.</p>}
    </Card>
  );
}
