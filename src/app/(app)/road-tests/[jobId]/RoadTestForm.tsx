"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, type FormAction } from "@/components/forms";
import { InspectionMedia, fileOfSent, useFilesOnDevice, useSendGuard, whereOf, type InspectionFile } from "@/components/InspectionMedia";
import { JumpButton, ProblemsBar, jumpTo } from "@/components/FormAssist";
import { Card, Notice, SectionLabel, Textarea } from "@/components/ui";
import { CHECK_STATUSES, ITEM_STATUS_LABELS, type CheckStatus } from "@/lib/inspection";
import { ROAD_TEST_ITEMS, roadTestProblems, type RoadTestItems } from "@/lib/road-test";
import { chipSentence, type ChipRow } from "@/lib/road-test-chips";
import type { PendingFile } from "@/lib/use-send-queue";

const STATUS_CLASS: Record<CheckStatus, string> = { good: "border-green bg-green text-white", average: "border-amber-bar bg-amber-bar text-white", bad: "border-red-bar bg-red-bar text-white" };

type RoadFile = InspectionFile & { itemKey: string | null };

function SubmitRow({ problems, attempted, notPossible, onSave, note }: { problems: { key: string; label: string }[]; attempted: boolean; notPossible: boolean; onSave: () => void; note: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    // The bar and, right above its button, what is still on this device ("2 photos still sending from this phone").
    <div className="sticky bottom-0 z-30">
      {note ? (
        <div className="-mx-4 border-t border-line bg-amber-soft py-2 pl-4 pr-16 sm:-mx-6 sm:pl-6 lg:-mx-8 lg:pl-8" data-send-note>
          {note}
        </div>
      ) : null}
      <ProblemsBar
        problems={problems}
        attempted={attempted}
        progress={{ done: ROAD_TEST_ITEMS.length - problems.length, total: ROAD_TEST_ITEMS.length }}
        onJump={jumpTo}
        submitLabel={notPossible ? "Save: road test not possible" : "Save road test"}
        submitting={pending}
        onSubmit={onSave}
      />
    </div>
  );
}

/**
 * Eight checks, each GOOD / AVERAGE / BAD. On Bad or Average, rows of one-tap chips (what, where, when) write the
 * remark; the sentence stays editable and typing is always possible. Photos or video per item, through the send queue
 * (kept on the phone until the server has them, so a drive with no signal loses nothing); or "not possible" with a
 * reason. Saving while files are still on the phone asks once: wait, or save now (they keep sending by themselves).
 */
export function RoadTestForm({ action, inspectionId, initial, initialFiles, initialNotPossible, initialReason, readOnly, chips = {} }: { action: FormAction; inspectionId: string | null; initial: RoadTestItems; initialFiles: RoadFile[]; initialNotPossible: boolean; initialReason: string; readOnly: boolean; chips?: Record<string, ChipRow[]> }) {
  const [items, setItems] = useState<RoadTestItems>(initial);
  const [notPossible, setNotPossible] = useState(initialNotPossible);
  const [files, setFiles] = useState(initialFiles);
  // A refresh hands the server's list again: it joins what this screen has; a photo taken off here stays off.
  const [goneIds, setGoneIds] = useState<string[]>([]);
  const serverKey = initialFiles.map((f) => f.id).join(",");
  const [prevKey, setPrevKey] = useState(serverKey);
  if (prevKey !== serverKey) {
    setPrevKey(serverKey);
    setFiles((local) => [...initialFiles.filter((f) => !goneIds.includes(f.id)), ...local.filter((l) => !initialFiles.some((f) => f.id === l.id))]);
  }
  const [attempted, setAttempted] = useState(false);
  // The chips tapped per item, row by row; the sentence they make goes into the remark.
  const [picked, setPicked] = useState<Record<string, string[][]>>({});
  const problems = roadTestProblems(items);
  const problemKeys = new Set(problems.map((p) => p.key));
  const open = notPossible ? [] : problems;
  const setStatus = (key: string, status: CheckStatus) => setItems((p) => ({ ...p, [key]: { ...(p[key as keyof RoadTestItems] ?? {}), status } }));
  const setRemarks = (key: string, remarks: string) => setItems((p) => ({ ...p, [key]: { ...(p[key as keyof RoadTestItems] ?? {}), remarks } }));
  const toggleChip = (key: string, rowIndex: number, chip: string) => {
    const rows = chips[key] ?? [];
    const cur = picked[key] ?? rows.map(() => []);
    const row = cur[rowIndex] ?? [];
    const nextRow = row.includes(chip) ? row.filter((c) => c !== chip) : [...row, chip];
    const next = cur.map((r, i) => (i === rowIndex ? nextRow : r));
    setPicked((p) => ({ ...p, [key]: next }));
    setRemarks(key, chipSentence(key, rows, next));
  };

  // Only files the server has recorded join the list, each once.
  const addFile = (itemKey: string) => (f: InspectionFile) => setFiles((p) => (p.some((x) => x.id === f.id) ? p : [...p, { ...f, itemKey }]));
  const removeFile = (id: string) => {
    setFiles((p) => p.filter((x) => x.id !== id));
    setGoneIds((g) => (g.includes(id) ? g : [...g, id]));
  };
  // Every road-test photo or video still on this device (an item's uploader may be off the screen when it arrives).
  const pending = useFilesOnDevice({
    target: "inspection",
    scopeId: inspectionId,
    match: (f) => String(f.itemKey ?? "").startsWith("road."),
    onSent: (r, fields) => {
      const f = fileOfSent(r);
      const key = whereOf(fields).itemKey;
      if (f && key) addFile(key)(f);
    },
  });
  const save = () => {
    if (open.length) {
      setAttempted(true);
      jumpTo(open[0].key);
      return;
    }
    const form = document.querySelector('input[name="outcome"]')?.closest("form");
    form?.requestSubmit();
  };
  const placeOf = (p: PendingFile) => {
    const key = whereOf(p.fields).itemKey ?? "";
    return { label: ROAD_TEST_ITEMS.find((i) => `road.${i.key}` === key)?.label ?? "Road test", key: key || null };
  };
  // Saving while photos are still on this phone asks once: wait (it then saves by itself), or save now – the queue keeps
  // sending after the page has gone, and the server takes road-test photos while the car is in.
  const guard = useSendGuard({
    pending,
    go: save,
    placeOf,
    words: { wait: "Wait, then save", now: "Save the road test now", nowNote: "They keep sending by themselves and join the road test when they arrive.", goes: "the road test is saved by itself." },
  });

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
                const rows = chips[it.key] ?? [];
                const sel = picked[it.key] ?? [];
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
                    {needs && rows.length && !readOnly ? (
                      <div className="flex flex-col gap-2 rounded-control bg-chip p-2" data-chips={it.key}>
                        {rows.map((row, i) => (
                          <div key={row.label + i} className="flex flex-col gap-1">
                            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{row.label}</span>
                            <div className="flex flex-wrap gap-1.5">
                              {row.chips.map((c) => {
                                const on = (sel[i] ?? []).includes(c);
                                return (
                                  <button key={c} type="button" onClick={() => toggleChip(it.key, i, c)} aria-pressed={on} className={`min-h-9 rounded-control border px-2.5 text-xs font-semibold ${on ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>
                                    {on ? "✓ " : ""}{c}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        <input type="hidden" name={`chips__${it.key}`} value={JSON.stringify(sel.flat())} />
                      </div>
                    ) : null}
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted">Remarks{needs ? " (required: tap the chips or type)" : ""}</span>
                      <Textarea name={`remarks__${it.key}`} value={v.remarks ?? ""} onChange={(e) => setRemarks(it.key, e.target.value)} rows={2} disabled={readOnly} spellCheck lang="en" />
                    </label>
                    {inspectionId ? (
                      <InspectionMedia inspectionId={inspectionId} files={files.filter((f) => f.itemKey === `road.${it.key}`)} where={{ itemKey: `road.${it.key}` }} disabled={readOnly} onAdded={addFile(`road.${it.key}`)} onRemoved={removeFile} />
                    ) : (
                      <p className="text-xs text-muted">Photos and video can be added once the technician&apos;s inspection record exists.</p>
                    )}
                  </Card>
                );
              })
            : null}

          {readOnly ? (
            <Notice tone="info">View only.</Notice>
          ) : (
            <SubmitRow
              problems={open}
              attempted={attempted}
              notPossible={notPossible}
              note={guard.note}
              onSave={() => {
                if (open.length) {
                  setAttempted(true);
                  jumpTo(open[0].key);
                  return;
                }
                if (!guard.mayGo()) return;
                save();
              }}
            />
          )}
          {guard.dialog}
          <JumpButton />
        </>
      )}
    </ActionForm>
  );
}
