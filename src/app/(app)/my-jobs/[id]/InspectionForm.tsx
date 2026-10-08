"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InspectionMedia, type InspectionFile } from "@/components/InspectionMedia";
import { ActionForm, type FormAction } from "@/components/forms";
import { JumpButton, ProblemsBar, jumpTo } from "@/components/FormAssist";
import { PrescanToggle } from "@/components/PrescanToggle";
import { Card, Input, Notice, SectionLabel, Textarea } from "@/components/ui";
import {
  CHECK_STATUSES,
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  MEASUREMENTS,
  OPTIONAL_SECTION_KEY,
  ROAD_TEST_SECTION_KEY,
  TYRE_ACTIONS,
  TYRE_CONDITIONS,
  TYRE_POSITIONS,
  cleanTyreConditions,
  reportProblemsOf,
  reportProgressOf,
  tyreItemStatus,
  type ChecklistSection,
  type ItemStatus,
} from "@/lib/inspection";

export type ItemState = { key: string; label: string; sectionKey: string; status: ItemStatus | null; remarks: string; parts_needed: string; editedBy?: string | null };
export type FindingState = { requestId: string; text: string; found: string; needs: string; status: ItemStatus | null };

const STATUS_CLASS: Record<ItemStatus, string> = {
  good: "border-green bg-green text-white",
  average: "border-amber-bar bg-amber-bar text-white",
  bad: "border-red-bar bg-red-bar text-white",
  na: "border-line-strong bg-chip text-muted",
};

type Op = Record<string, unknown>;

/** Saves go through a queue kept in the browser's storage, so a closed page or a lost connection never loses a tap. */
function useAutosave(inspectionId: string) {
  const storageKey = `erp-inspection-queue-${inspectionId}`;
  const queue = useRef<Op[]>([]);
  const busy = useRef(false);
  const [state, setState] = useState<"saved" | "saving" | "offline">("saved");
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback(() => {
    try {
      if (queue.current.length) localStorage.setItem(storageKey, JSON.stringify(queue.current));
      else localStorage.removeItem(storageKey);
    } catch {}
  }, [storageKey]);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const op = queue.current[0];
      setState("saving");
      try {
        const res = await fetch("/api/inspection/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inspectionId, ...op }) });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (res.status === 423 || res.status === 403 || res.status === 400) {
          // Not a connection problem: drop the change and tell the person.
          queue.current.shift();
          persist();
          setError(data.error ?? "Could not save.");
          continue;
        }
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save.");
        queue.current.shift();
        persist();
        setError(null);
      } catch {
        setState("offline");
        busy.current = false;
        return; // retried by the timer
      }
    }
    setState("saved");
    busy.current = false;
  }, [inspectionId, persist]);

  const save = useCallback(
    (op: Op) => {
      queue.current.push(op);
      persist();
      void flush();
    },
    [flush, persist],
  );

  useEffect(() => {
    try {
      const pending = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Op[];
      if (pending.length) {
        queue.current.push(...pending);
        void flush();
      }
    } catch {}
    const retry = setInterval(() => {
      if (queue.current.length) void flush();
    }, 4000);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      clearInterval(retry);
      window.removeEventListener("online", online);
    };
  }, [storageKey, flush]);

  return { save, state, error };
}

/** GOOD / AVERAGE / BAD, plus N/A in grey on checklist items. */
function StatusButtons({ value, onPick, disabled, statuses }: { value: ItemStatus | null; onPick: (s: ItemStatus) => void; disabled: boolean; statuses: readonly ItemStatus[] }) {
  return (
    <div className={`grid gap-2 ${statuses.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
      {statuses.map((s) => (
        <button key={s} type="button" disabled={disabled} onClick={() => onPick(s)} aria-pressed={value === s} className={`min-h-12 rounded-control border-2 text-sm font-extrabold tracking-[0.04em] ${value === s ? STATUS_CLASS[s] : s === "na" ? "border-line bg-white text-muted" : "border-line-strong bg-white"} ${disabled ? "opacity-60" : ""}`}>
          {ITEM_STATUS_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

/** Green tick when complete. Before Submit was tapped an open section shows a grey dot; after, red. */
function Dot({ ok, attempted }: { ok: boolean; attempted: boolean }) {
  if (ok) return <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green text-white text-xs font-bold" aria-label="complete">✓</span>;
  return <span className={`inline-block h-3 w-3 rounded-full ${attempted ? "bg-red-bar" : "bg-line-strong"}`} aria-label="incomplete" />;
}

/**
 * The technician's report: findings per customer request, the checklist with one-tap statuses,
 * the numbers with tyre conditions, the optional pre-scan PDF, notes. Every tap is saved at once,
 * with a "Saved" indicator; the bar at the bottom shows neutral progress until Submit is tapped
 * with something missing, then lists what is missing in red.
 */
export function InspectionForm({
  inspectionId,
  checklist,
  items: initialItems,
  findings: initialFindings,
  measurements: initialMeasurements,
  files: initialFiles,
  notes: initialNotes,
  prescanVisible,
  showPrescanToggle = false,
  canAddPrescan = false,
  readOnly,
  submitAction,
  submitLabel = "Submit to workshop manager",
}: {
  inspectionId: string;
  checklist: ChecklistSection[];
  items: ItemState[];
  findings: FindingState[];
  measurements: Record<string, string>;
  files: (InspectionFile & { itemKey: string | null; requestId: string | null })[];
  notes: string;
  prescanVisible: boolean;
  /** Show to customer / Hide from customer: advisors and the owner only. */
  showPrescanToggle?: boolean;
  /** The pre-scan PDF can still be attached while the rest of the report is read only. */
  canAddPrescan?: boolean;
  readOnly: boolean;
  submitAction: FormAction | null;
  submitLabel?: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [findings, setFindings] = useState(initialFindings);
  const [measurements, setMeasurements] = useState(initialMeasurements);
  const latestMeasurements = useRef(initialMeasurements);
  const [files, setFiles] = useState(initialFiles);
  const [notes, setNotes] = useState(initialNotes);
  const [attempted, setAttempted] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const { save, state, error } = useAutosave(inspectionId);
  const disabled = readOnly;
  const sections = checklist.filter((s) => s.key !== ROAD_TEST_SECTION_KEY);

  function debounced(key: string, op: () => Op) {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => save(op()), 500);
  }

  function setItemStatus(key: string, status: ItemStatus) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, status } : i)));
    save({ item: { key, status } });
  }
  function setItemText(key: string, field: "remarks" | "parts_needed", value: string) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
    debounced(`${key}.${field}`, () => ({ item: { key, [field]: value } }));
  }
  function allGood(sectionKey: string) {
    setItems((prev) => prev.map((i) => (i.sectionKey === sectionKey && !i.status ? { ...i, status: "good" } : i)));
    save({ sectionAllGood: sectionKey });
  }
  function allNa(sectionKey: string) {
    setItems((prev) => prev.map((i) => (i.sectionKey === sectionKey ? { ...i, status: "na" } : i)));
    save({ sectionAll: { key: sectionKey, status: "na" } });
  }
  function setFindingStatus(requestId: string, status: ItemStatus) {
    setFindings((prev) => prev.map((f) => (f.requestId === requestId ? { ...f, status } : f)));
    save({ finding: { requestId, status } });
  }
  function setFindingText(requestId: string, field: "found" | "needs", value: string) {
    setFindings((prev) => prev.map((f) => (f.requestId === requestId ? { ...f, [field]: value } : f)));
    debounced(`${requestId}.${field}`, () => ({ finding: { requestId, [field]: value } }));
  }
  function setMeasurement(key: string, value: string, immediate = false) {
    const next = { ...latestMeasurements.current, [key]: value };
    latestMeasurements.current = next;
    setMeasurements(next);
    if (immediate) save({ measurements: next });
    else debounced("measurements", () => ({ measurements: latestMeasurements.current }));
    // Tyre actions decide the Tyres item on their own.
    if (key.endsWith("_action")) {
      const status = tyreItemStatus(next);
      const tyreItem = items.find((i) => /^tyres/i.test(i.label));
      if (status && tyreItem && tyreItem.status !== "bad" && tyreItem.status !== status) setItemStatus(tyreItem.key, status);
    }
  }
  function toggleTyreCondition(pos: string, value: string) {
    const current = (latestMeasurements.current[`tyre_${pos}_cond`] ?? "").split(",").filter(Boolean);
    const next = current.includes(value) ? current.filter((c) => c !== value) : value === "good" ? ["good"] : cleanTyreConditions([...current.filter((c) => c !== "good"), value]);
    setMeasurement(`tyre_${pos}_cond`, next.join(","), true);
  }
  function setNotesText(value: string) {
    setNotes(value);
    debounced("notes", () => ({ technicianNotes: value }));
  }
  const filesFor = (where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }) =>
    files.filter((f) => (where.isPrescan ? f.isPrescan : !f.isPrescan && (f.itemKey ?? null) === (where.itemKey ?? null) && (f.requestId ?? null) === (where.requestId ?? null)));
  const addFile = (where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }) => (f: InspectionFile) =>
    setFiles((prev) => [...prev, { ...f, itemKey: where.itemKey ?? null, requestId: where.requestId ?? null, isPrescan: !!where.isPrescan }]);

  const reportState = { items, findings, measurements };
  const problems = reportProblemsOf(reportState);
  const progress = reportProgressOf(reportState);
  const problemKeys = new Set(problems.map((p) => p.key));
  const sectionOk = (sectionKey: string) => !items.some((i) => i.sectionKey === sectionKey && problemKeys.has(i.key));
  const marked = items.filter((i) => i.sectionKey !== ROAD_TEST_SECTION_KEY && i.status).length;
  const total = items.filter((i) => i.sectionKey !== ROAD_TEST_SECTION_KEY).length;
  const tyresOk = !problems.some((p) => p.key.startsWith("m-tyre"));
  const numbersOk = !problems.some((p) => p.key.startsWith("m-") && !p.key.startsWith("m-tyre"));
  const tyreBtn = (on: boolean) => `min-h-11 rounded-control border-2 px-2 text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"} ${disabled ? "opacity-60" : ""}`;
  const prescanFiles = filesFor({ isPrescan: true });

  return (
    <div className="flex flex-col gap-6 pb-24">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel right={`${findings.filter((f) => f.status).length} of ${findings.length}`}>Part 1 · Customer requests</SectionLabel>
          <Dot ok={!problems.some((p) => p.key.startsWith("req-"))} attempted={attempted} />
        </div>
        {findings.length === 0 ? <p className="text-sm text-muted">No customer requests were recorded at gate-in.</p> : null}
        {findings.map((f, i) => (
          <div key={f.requestId} id={`item-req-${f.requestId}`} className={`rounded-card border p-3 flex flex-col gap-3 ${problemKeys.has(`req-${f.requestId}`) ? "border-line" : "border-green"}`}>
            <p className="font-bold">
              {i + 1}. {f.text}
            </p>
            <StatusButtons value={f.status} onPick={(s) => setFindingStatus(f.requestId, s)} disabled={disabled} statuses={CHECK_STATUSES} />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">What was found (required)</span>
              <Textarea value={f.found} onChange={(e) => setFindingText(f.requestId, "found", e.target.value)} rows={2} disabled={disabled} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">What it needs</span>
              <Textarea value={f.needs} onChange={(e) => setFindingText(f.requestId, "needs", e.target.value)} rows={2} disabled={disabled} />
            </label>
            <InspectionMedia inspectionId={inspectionId} files={filesFor({ requestId: f.requestId })} where={{ requestId: f.requestId }} disabled={disabled} onAdded={addFile({ requestId: f.requestId })} />
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${marked} of ${total} marked`}>Part 2 · Full inspection</SectionLabel>
        <p className="text-sm text-muted">Tap GOOD, AVERAGE, BAD or N/A on every item. AVERAGE and BAD need a remark; a photo or short video is optional. N/A means it does not apply to this car. List the parts needed against the item.</p>
      </Card>

      {sections.map((section) => {
        const sectionItems = items.filter((i) => i.sectionKey === section.key);
        const open = sectionItems.filter((i) => !i.status).length;
        const optional = section.key === OPTIONAL_SECTION_KEY;
        return (
          <Card key={section.key} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2">
                <Dot ok={sectionOk(section.key)} attempted={attempted} />
                <SectionLabel right={open ? `${open} to mark${optional ? ", optional" : ""}` : undefined}>{section.title}</SectionLabel>
              </span>
              {!disabled && open ? (
                <span className="flex gap-2">
                  <button type="button" onClick={() => allGood(section.key)} className="min-h-11 rounded-control border border-green bg-green-soft px-4 text-sm font-bold text-green">
                    All GOOD
                  </button>
                  <button type="button" onClick={() => allNa(section.key)} className="min-h-11 rounded-control border border-line-strong bg-chip px-4 text-sm font-bold text-muted">
                    All N/A
                  </button>
                </span>
              ) : null}
            </div>
            {sectionItems.map((it) => {
              const needsDetail = it.status === "average" || it.status === "bad";
              return (
                <div key={it.key} id={`item-${it.key}`} className={`rounded-card border p-3 flex flex-col gap-3 ${it.status === "bad" ? "border-red-bar" : it.status === "average" ? "border-amber-bar" : "border-line"}`}>
                  <p className="font-semibold">
                    {it.label}
                    {it.editedBy ? <span className="ml-2 text-xs font-medium text-muted">edited by {it.editedBy}</span> : null}
                  </p>
                  <StatusButtons value={it.status} onPick={(s) => setItemStatus(it.key, s)} disabled={disabled} statuses={ITEM_STATUSES} />
                  {needsDetail || it.remarks ? (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted">Remarks{needsDetail ? " (required)" : ""}</span>
                      <Textarea value={it.remarks} onChange={(e) => setItemText(it.key, "remarks", e.target.value)} rows={2} disabled={disabled} />
                    </label>
                  ) : null}
                  {needsDetail ? (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted">Parts needed</span>
                      <Textarea value={it.parts_needed} onChange={(e) => setItemText(it.key, "parts_needed", e.target.value)} rows={2} disabled={disabled} placeholder="Part names or numbers, one per line" />
                    </label>
                  ) : null}
                  {needsDetail || filesFor({ itemKey: it.key }).length ? (
                    <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: it.key })} where={{ itemKey: it.key }} disabled={disabled} onAdded={addFile({ itemKey: it.key })} />
                  ) : null}
                </div>
              );
            })}
          </Card>
        );
      })}

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Tyres (all required)</SectionLabel>
          <Dot ok={tyresOk} attempted={attempted} />
        </div>
        {[...TYRE_POSITIONS, { key: "spare", label: "Spare (optional)" }].map((p) => {
          const cond = (measurements[`tyre_${p.key}_cond`] ?? "").split(",").filter(Boolean);
          const action = measurements[`tyre_${p.key}_action`] ?? "";
          return (
            <div key={p.key} className="rounded-card border border-line p-3 flex flex-col gap-3">
              <p className="font-semibold">{p.label}</p>
              <div className="grid grid-cols-2 gap-3">
                <label id={`item-m-tyre_${p.key}_tread`} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Tread depth (mm)</span>
                  <Input value={measurements[`tyre_${p.key}_tread`] ?? ""} onChange={(e) => setMeasurement(`tyre_${p.key}_tread`, e.target.value)} inputMode="decimal" disabled={disabled} />
                </label>
                <label id={`item-m-tyre_${p.key}_year`} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Tyre year</span>
                  <Input value={measurements[`tyre_${p.key}_year`] ?? ""} onChange={(e) => setMeasurement(`tyre_${p.key}_year`, e.target.value)} inputMode="numeric" placeholder="2023" disabled={disabled} />
                </label>
              </div>
              <div id={`item-m-tyre_${p.key}_cond`} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted">Condition (tap all that apply)</span>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {TYRE_CONDITIONS.map((c) => (
                    <button key={c.value} type="button" disabled={disabled} onClick={() => toggleTyreCondition(p.key, c.value)} aria-pressed={cond.includes(c.value)} className={tyreBtn(cond.includes(c.value))}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div id={`item-m-tyre_${p.key}_action`} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted">Action</span>
                <div className="grid grid-cols-3 gap-2">
                  {TYRE_ACTIONS.map((a) => (
                    <button key={a.value} type="button" disabled={disabled} onClick={() => setMeasurement(`tyre_${p.key}_action`, a.value, true)} aria-pressed={action === a.value} className={tyreBtn(action === a.value)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted">Replace soon marks the Tyres item AVERAGE; Replace now marks it BAD.</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Numbers (all required)</SectionLabel>
          <Dot ok={numbersOk} attempted={attempted} />
        </div>
        {["Brake pads", "Battery test", "Air conditioning"].map((g) => (
          <div key={g} className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{g}</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MEASUREMENTS.filter((m) => m.group === g).map((m) => (
                <label key={m.key} id={`item-m-${m.key}`} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">
                    {m.label}
                    {m.unit ? ` (${m.unit})` : ""}
                  </span>
                  {m.kind === "choice" ? (
                    <div className="grid grid-cols-3 gap-1">
                      {m.choices!.map((c) => (
                        <button key={c.value} type="button" disabled={disabled} onClick={() => setMeasurement(m.key, c.value, true)} aria-pressed={measurements[m.key] === c.value} className={`min-h-11 rounded-control border text-xs font-bold ${measurements[m.key] === c.value ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Input value={measurements[m.key] ?? ""} onChange={(e) => setMeasurement(m.key, e.target.value)} inputMode="decimal" disabled={disabled} />
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <div id="item-prescan">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel right={prescanFiles.length ? `${prescanFiles.length} attached` : "optional"}>Pre-scan (Autel fault code report, PDF)</SectionLabel>
            {prescanFiles.length ? <Dot ok attempted={attempted} /> : null}
          </div>
          <p className="text-xs text-muted">Optional. The technician or the workshop manager can attach it now or later, from the tablet or a PC.</p>
          <InspectionMedia inspectionId={inspectionId} files={prescanFiles} where={{ isPrescan: true }} accept="pdf" disabled={disabled && !canAddPrescan} onAdded={addFile({ isPrescan: true })} />
          {showPrescanToggle ? <PrescanToggle inspectionId={inspectionId} initial={prescanVisible} /> : null}
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Technician&apos;s notes</SectionLabel>
        <Textarea value={notes} onChange={(e) => setNotesText(e.target.value)} rows={4} disabled={disabled} placeholder="Anything the workshop manager and advisor should know." />
      </Card>

      {!disabled ? (
        <>
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 rounded-full bg-ink/85 px-3 py-1 text-[11px] font-bold text-white pointer-events-none">
            {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "No connection · changes kept, will save"}
          </div>
          {submitAction ? (
            <ActionForm action={submitAction} className="hidden">
              {() => <button type="submit" id="inspection-submit" />}
            </ActionForm>
          ) : null}
          <ProblemsBar
            problems={problems}
            attempted={attempted}
            progress={progress}
            onJump={jumpTo}
            submitLabel={submitLabel}
            onSubmit={
              submitAction
                ? () => {
                    if (problems.length) {
                      setAttempted(true);
                      jumpTo(problems[0].key);
                      return;
                    }
                    (document.getElementById("inspection-submit") as HTMLButtonElement | null)?.click();
                  }
                : undefined
            }
          />
          <JumpButton />
        </>
      ) : null}
    </div>
  );
}
