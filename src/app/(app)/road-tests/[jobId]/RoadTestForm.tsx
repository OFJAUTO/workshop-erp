"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, type FormAction } from "@/components/forms";
import { InspectionMedia, type InspectionFile } from "@/components/InspectionMedia";
import { JumpButton, ProblemsBar, jumpTo } from "@/components/FormAssist";
import { Card, Notice, SectionLabel, Textarea } from "@/components/ui";
import { CHECK_STATUSES, ITEM_STATUS_LABELS, type CheckStatus } from "@/lib/inspection";
import { ROAD_TEST_ITEMS, roadTestProblems, type RoadTestItems } from "@/lib/road-test";

const STATUS_CLASS: Record<CheckStatus, string> = { good: "border-green bg-green text-white", average: "border-amber-bar bg-amber-bar text-white", bad: "border-red-bar bg-red-bar text-white" };

function SubmitRow({ problems, attempted, notPossible, onAttempt, onJump }: { problems: { key: string; label: string }[]; attempted: boolean; notPossible: boolean; onAttempt: () => void; onJump: (k: string) => void }) {
  const { pending } = useFormStatus();
  const open = notPossible ? [] : problems;
  return (
    <ProblemsBar
      problems={open}
      attempted={attempted}
      progress={{ done: ROAD_TEST_ITEMS.length - open.length, total: ROAD_TEST_ITEMS.length }}
      onJump={onJump}
      submitLabel={notPossible ? "Save: road test not possible" : "Save road test"}
      submitting={pending}
      onSubmit={() => {
        if (open.length) {
          onAttempt();
          onJump(open[0].key);
          return;
        }
        const form = document.querySelector('input[name="outcome"]')?.closest("form");
        form?.requestSubmit();
      }}
    />
  );
}

/** Five checks, each GOOD / AVERAGE / BAD with remarks and optional photos or video; or "not possible" with a reason. */
export function RoadTestForm({ action, inspectionId, initial, initialFiles, initialNotPossible, initialReason, readOnly }: { action: FormAction; inspectionId: string | null; initial: RoadTestItems; initialFiles: (InspectionFile & { itemKey: string | null })[]; initialNotPossible: boolean; initialReason: string; readOnly: boolean }) {
  const [items, setItems] = useState<RoadTestItems>(initial);
  const [notPossible, setNotPossible] = useState(initialNotPossible);
  const [files, setFiles] = useState(initialFiles);
  const [attempted, setAttempted] = useState(false);
  const problems = roadTestProblems(items);
  const problemKeys = new Set(problems.map((p) => p.key));
  const setStatus = (key: string, status: CheckStatus) => setItems((p) => ({ ...p, [key]: { ...(p[key as keyof RoadTestItems] ?? {}), status } }));
  const setRemarks = (key: string, remarks: string) => setItems((p) => ({ ...p, [key]: { ...(p[key as keyof RoadTestItems] ?? {}), remarks } }));

  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {() => (
        <>
          <input type="hidden" name="outcome" value={notPossible ? "not_possible" : "done"} />
          <Card className="flex flex-col gap-3">
            <SectionLabel>Can the car be road tested?</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={readOnly} onClick={() => setNotPossible(false)} aria-pressed={!notPossible} className={`min-h-12 rounded-control border-2 text-sm font-bold ${!notPossible ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                Yes, road test done
              </button>
              <button type="button" disabled={readOnly} onClick={() => setNotPossible(true)} aria-pressed={notPossible} className={`min-h-12 rounded-control border-2 text-sm font-bold ${notPossible ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                Road test not possible
              </button>
            </div>
            {notPossible ? (
              <label className="flex flex-col gap-1">
                <span className="text-sm font-semibold">Why (required)</span>
                <Textarea name="not_possible_reason" defaultValue={initialReason} rows={2} required disabled={readOnly} placeholder="For example: does not run, no fuel, no plates" />
              </label>
            ) : null}
          </Card>

          {!notPossible
            ? ROAD_TEST_ITEMS.map((it) => {
                const v = items[it.key] ?? {};
                const needs = v.status === "average" || v.status === "bad";
                const done = !problemKeys.has(it.key);
                return (
                  <Card key={it.key} className={`flex flex-col gap-3 ${v.status === "bad" ? "border-red-bar" : v.status === "average" ? "border-amber-bar" : ""}`}>
                    <div id={`item-${it.key}`} className="flex items-center justify-between gap-2">
                      <span className="font-bold">{it.label}</span>
                      {done ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green text-white text-xs font-bold" aria-label="complete">✓</span>
                      ) : (
                        <span className={`inline-block h-3 w-3 rounded-full ${attempted ? "bg-red-bar" : "bg-line-strong"}`} aria-label="incomplete" />
                      )}
                    </div>
                    <input type="hidden" name={`status__${it.key}`} value={v.status ?? ""} />
                    <div className="grid grid-cols-3 gap-2">
                      {CHECK_STATUSES.map((s) => (
                        <button key={s} type="button" disabled={readOnly} onClick={() => setStatus(it.key, s)} aria-pressed={v.status === s} className={`min-h-12 rounded-control border-2 text-sm font-extrabold tracking-[0.04em] ${v.status === s ? STATUS_CLASS[s] : "border-line-strong bg-white"}`}>
                          {ITEM_STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted">Remarks{needs ? " (required)" : ""}</span>
                      <Textarea name={`remarks__${it.key}`} value={v.remarks ?? ""} onChange={(e) => setRemarks(it.key, e.target.value)} rows={2} disabled={readOnly} />
                    </label>
                    {inspectionId ? (
                      <InspectionMedia inspectionId={inspectionId} files={files.filter((f) => f.itemKey === `road.${it.key}`)} where={{ itemKey: `road.${it.key}` }} disabled={readOnly} onAdded={(f) => setFiles((p) => [...p, { ...f, itemKey: `road.${it.key}` }])} />
                    ) : (
                      <p className="text-xs text-muted">Photos and video can be added once the technician&apos;s inspection record exists.</p>
                    )}
                  </Card>
                );
              })
            : null}

          {readOnly ? <Notice tone="info">View only.</Notice> : <SubmitRow problems={problems} attempted={attempted} notPossible={notPossible} onAttempt={() => setAttempted(true)} onJump={jumpTo} />}
          <JumpButton />
        </>
      )}
    </ActionForm>
  );
}
