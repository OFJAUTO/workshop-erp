"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InspectionMedia, type InspectionFile } from "@/components/InspectionMedia";
import { ActionForm, type FormAction } from "@/components/forms";
import { JumpButton, ProblemsBar, jumpTo } from "@/components/FormAssist";
import { PrescanToggle } from "@/components/PrescanToggle";
import { QuickCodeButton } from "@/components/QuickCodeButton";
import { Card, Input, Notice, SectionLabel, Select, Textarea } from "@/components/ui";
import {
  CHECK_STATUSES,
  DISC_ACTIONS,
  DISC_CONDITIONS,
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  LEAK_REPAIRS,
  LEAK_SEVERITIES,
  MEASUREMENTS,
  OPTIONAL_SECTION_KEY,
  PARTS_UNITS,
  ROAD_TEST_SECTION_KEY,
  TYRE_ACTIONS,
  TYRE_CONDITIONS,
  TYRE_POSITIONS,
  cleanTyreConditions,
  discStatus,
  fluidGradesFor,
  fluidUnitFor,
  isDiscItem,
  isFluidItem,
  isLeakItem,
  leakPartFor,
  leakRemark,
  reportProblemsOf,
  reportProgressOf,
  tyreItemStatus,
  tyreYearOptions,
  type ChecklistSection,
  type InspectionLimits,
  type ItemStatus,
  type PartsRow,
} from "@/lib/inspection";

export type ItemState = {
  key: string;
  label: string;
  sectionKey: string;
  status: ItemStatus | null;
  remarks: string;
  parts_needed: string;
  editedBy?: string | null;
  dangerous: boolean;
  dangerous_reason: string;
  leak_severity: string;
  leak_repair: string;
  fluid_qty: string;
  fluid_unit: string;
  fluid_grade: string;
  fluid_spec: string;
  disc_condition: string;
  disc_action: string;
  disc_thickness: string;
  disc_minimum: string;
  parts_rows: PartsRow[];
};
export type FindingState = { requestId: string; text: string; found: string; needs: string; status: ItemStatus | null };
export type Suggestions = Record<string, { parts?: string[]; remarks?: string[] }>;
export type ScanState = { gate: boolean; readAt: string | null; notPossibleReason: string | null; approvedAt: string | null };

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
        if (res.status === 423 || res.status === 403 || res.status === 400 || res.status === 404) {
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

/** One-tap choices in a row; the chosen one is solid black (or red when `danger`). */
function Chips({ options, value, onPick, disabled, danger = false, small = false }: { options: readonly { value: string; label: string }[]; value: string | null | undefined; onPick: (v: string) => void; disabled: boolean; danger?: boolean; small?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" disabled={disabled} onClick={() => onPick(o.value)} aria-pressed={on} className={`${small ? "min-h-9 px-2 text-xs" : "min-h-11 px-3 text-sm"} rounded-control border-2 font-bold ${on ? (danger ? "border-red-bar bg-red-bar text-white" : "border-ink bg-ink text-white") : "border-line-strong bg-white"} ${disabled ? "opacity-60" : ""}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Green tick when complete. Before Submit was tapped an open section shows a grey dot; after, red. */
function Dot({ ok, attempted }: { ok: boolean; attempted: boolean }) {
  if (ok) return <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green text-white text-xs font-bold" aria-label="complete">✓</span>;
  return <span className={`inline-block h-3 w-3 rounded-full ${attempted ? "bg-red-bar" : "bg-line-strong"}`} aria-label="incomplete" />;
}

const AUTO_LIMITS: InspectionLimits = { tread_max: 12, pads_max: 20, battery_max: 16, vent_min: -5, vent_max: 40, fluid_max: 30, tyre_years: 15 };

/**
 * The technician's report: the scan step (when the gate is on), findings per customer request, the
 * checklist with one-tap statuses and tap-first details (leaks, fluids, brake discs, parts rows, the
 * Dangerous switch), tyres and numbers with sensible limits, photos with a "continue on my phone" code,
 * big-job tags, the estimated hours, notes. Every tap is saved at once, with a "Saved" indicator; the bar at
 * the bottom shows neutral progress until Submit is tapped with something missing, then lists what is missing in red.
 */
export function InspectionForm({
  inspectionId,
  jobId,
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
  limits = AUTO_LIMITS,
  suggestions = {},
  fluidGrades = [],
  bigJobTags = [],
  initialTags = [],
  estimatedHours: initialEstimate = "",
  estimateReason: initialEstimateReason = "",
  scan = null,
  thisYear = new Date().getFullYear(),
}: {
  inspectionId: string;
  jobId: string;
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
  limits?: InspectionLimits;
  /** Tap-first suggestions per checklist item, learned from approved reports and editable in Settings. */
  suggestions?: Suggestions;
  fluidGrades?: string[];
  bigJobTags?: string[];
  initialTags?: string[];
  estimatedHours?: string;
  estimateReason?: string;
  /** The scan step: null when the report has no scan gate at all (the setting is off). */
  scan?: ScanState | null;
  thisYear?: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [findings, setFindings] = useState(initialFindings);
  const [measurements, setMeasurements] = useState(initialMeasurements);
  const latestMeasurements = useRef(initialMeasurements);
  const [files, setFiles] = useState(initialFiles);
  const [notes, setNotes] = useState(initialNotes);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [estimate, setEstimate] = useState(initialEstimate);
  const [estimateReason, setEstimateReason] = useState(initialEstimateReason);
  const [scanState, setScanState] = useState<ScanState | null>(scan);
  const [scanReason, setScanReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const { save, state, error } = useAutosave(inspectionId);
  const disabled = readOnly;
  const sections = checklist.filter((s) => s.key !== ROAD_TEST_SECTION_KEY);
  const scanGateOpen = !scanState?.gate || !!scanState.readAt || !!scanState.approvedAt;
  const locked = disabled || !scanGateOpen;

  function debounced(key: string, op: () => Op) {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => save(op()), 500);
  }
  const patchItem = (key: string, fields: Partial<ItemState>, immediate = true) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...fields } : i)));
    const op = () => ({ item: { key, ...fields } });
    if (immediate) save(op());
    else debounced(`${key}.${Object.keys(fields).join(",")}`, op);
  };
  function setItemStatus(key: string, status: ItemStatus) {
    const extra: Partial<ItemState> = status === "bad" ? {} : { dangerous: false };
    patchItem(key, { status, ...extra });
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
  function toggleTag(tag: string) {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setTags(next);
    save({ inspection: { big_job_tags: next } });
  }
  /** Leak severity or repair: the remark is written for the technician and the part is added on its own. */
  function setLeak(it: ItemState, field: "leak_severity" | "leak_repair", value: string) {
    const next = { ...it, [field]: it[field] === value ? "" : value };
    const auto = leakRemark(next.leak_severity, next.leak_repair);
    const remarks = !it.remarks.trim() || it.remarks === leakRemark(it.leak_severity, it.leak_repair) ? auto : it.remarks;
    const part = leakPartFor(next.leak_repair, it.label);
    const rows = part && !next.parts_rows.some((r) => r.part.toLowerCase() === part.toLowerCase()) ? [...next.parts_rows, { part, qty: 1, unit: "pc" }] : next.parts_rows;
    patchItem(it.key, { [field]: next[field], remarks, parts_rows: rows });
  }
  /** Brake discs: the condition and the action set AVERAGE or BAD by themselves; below minimum locks the action to replace. */
  function setDisc(it: ItemState, field: "disc_condition" | "disc_action", value: string) {
    const next = { ...it, [field]: value };
    if (next.disc_condition === "below_minimum") next.disc_action = "replace";
    const status = discStatus(next.disc_condition, next.disc_action);
    patchItem(it.key, { disc_condition: next.disc_condition, disc_action: next.disc_action, ...(status ? { status } : {}) });
  }
  const setRows = (it: ItemState, rows: PartsRow[], immediate: boolean) => patchItem(it.key, { parts_rows: rows }, immediate);

  const filesFor = (where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }) =>
    files.filter((f) => (where.isPrescan ? f.isPrescan : !f.isPrescan && (f.itemKey ?? null) === (where.itemKey ?? null) && (f.requestId ?? null) === (where.requestId ?? null)));
  const addFile = (where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }) => (f: InspectionFile) =>
    setFiles((prev) => [...prev, { ...f, itemKey: where.itemKey ?? null, requestId: where.requestId ?? null, isPrescan: !!where.isPrescan }]);

  const reportState = { items, findings, measurements, estimatedHours: submitAction ? estimate : null, scan: scanState?.gate ? { required: true, read: !!scanState.readAt, approved: !!scanState.approvedAt } : undefined };
  const problems = reportProblemsOf(reportState, { limits });
  const progress = reportProgressOf(reportState, { limits });
  const problemKeys = new Set(problems.map((p) => p.key));
  const sectionOk = (sectionKey: string) => !items.some((i) => i.sectionKey === sectionKey && problemKeys.has(i.key));
  const marked = items.filter((i) => i.sectionKey !== ROAD_TEST_SECTION_KEY && i.status).length;
  const total = items.filter((i) => i.sectionKey !== ROAD_TEST_SECTION_KEY).length;
  const tyresOk = !problems.some((p) => p.key.startsWith("m-tyre"));
  const numbersOk = !problems.some((p) => p.key.startsWith("m-") && !p.key.startsWith("m-tyre"));
  const tyreBtn = (on: boolean, danger = false) => `min-h-11 rounded-control border-2 px-2 text-xs font-bold ${on ? (danger ? "border-red-bar bg-red-bar text-white" : "border-ink bg-ink text-white") : "border-line-strong bg-white"} ${locked ? "opacity-60" : ""}`;
  const prescanFiles = filesFor({ isPrescan: true });
  const yearOptions = tyreYearOptions(thisYear, limits.tyre_years);
  const allPartSuggestions = Array.from(new Set(Object.values(suggestions).flatMap((s) => s.parts ?? []))).sort();
  const outOfRange = (key: string) => problems.some((p) => p.key === `m-${key}` && /to |between/.test(p.label));
  const dangerCount = items.filter((i) => i.dangerous).length + TYRE_POSITIONS.filter((p) => measurements[`tyre_${p.key}_danger`] === "1").length;

  return (
    <div className="flex flex-col gap-6 pb-24">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {dangerCount ? <Notice tone="error">{dangerCount === 1 ? "One finding is marked dangerous to drive." : `${dangerCount} findings are marked dangerous to drive.`} The manager, the advisor and the owner have been told.</Notice> : null}

      {scanState?.gate ? (
        <div id="item-prescan">
          <Card className={`flex flex-col gap-3 ${scanGateOpen ? "" : "border-ink"}`}>
            <div className="flex items-center justify-between gap-2">
              <SectionLabel right={prescanFiles.length ? `${prescanFiles.length} attached` : "waiting for the scanner's email"}>Step 1 · Scan report</SectionLabel>
              <Dot ok={scanGateOpen} attempted={attempted} />
            </div>
            {scanGateOpen ? (
              <p className="text-sm text-green font-semibold">{scanState.readAt ? "Scan report read. The checklist is open." : "Scan not possible, approved by the workshop manager. The checklist is open."}</p>
            ) : (
              <p className="text-sm text-muted">Open the scan report and tick that you have read it. The checklist opens after that. No report? Attach it here, or say why a scan is not possible; the manager approves that.</p>
            )}
            <InspectionMedia inspectionId={inspectionId} files={prescanFiles} where={{ isPrescan: true }} accept="pdf" disabled={disabled && !canAddPrescan} onAdded={addFile({ isPrescan: true })} />
            {!scanGateOpen && !disabled ? (
              <div className="flex flex-col gap-3 border-t border-line pt-3">
                <button type="button" disabled={!prescanFiles.length} onClick={() => { save({ inspection: { scan_read: true } }); setScanState((s) => (s ? { ...s, readAt: new Date().toISOString() } : s)); }} className={`min-h-14 rounded-control border-2 text-base font-extrabold ${prescanFiles.length ? "border-ink bg-ink text-white" : "border-line bg-chip text-muted"}`}>
                  I have read the scan report
                </button>
                {scanState.notPossibleReason ? (
                  <p className="text-sm font-semibold text-amber">Scan not possible: {scanState.notPossibleReason}. Waiting for the workshop manager&apos;s approval.</p>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 flex-1 min-w-48">
                      <span className="text-xs font-semibold text-muted">Scan not possible because</span>
                      <Input value={scanReason} onChange={(e) => setScanReason(e.target.value)} placeholder="For example: no OBD power, module not reachable" />
                    </label>
                    <button type="button" disabled={scanReason.trim().length < 3} onClick={() => { save({ inspection: { scan_not_possible_reason: scanReason.trim() } }); setScanState((s) => (s ? { ...s, notPossibleReason: scanReason.trim() } : s)); }} className="min-h-11 rounded-control border border-line-strong bg-white px-3 text-sm font-bold">
                      Ask the manager to approve
                    </button>
                  </div>
                )}
              </div>
            ) : null}
            {showPrescanToggle ? <PrescanToggle inspectionId={inspectionId} initial={prescanVisible} /> : null}
          </Card>
        </div>
      ) : null}
      {!scanGateOpen ? <Notice tone="info">The checklist opens once the scan report is read, or the manager approves that no scan was possible.</Notice> : null}

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel right={`${findings.filter((f) => f.status).length} of ${findings.length}`}>Customer requests</SectionLabel>
          <Dot ok={!problems.some((p) => p.key.startsWith("req-"))} attempted={attempted} />
        </div>
        {findings.length === 0 ? <p className="text-sm text-muted">No customer requests were recorded at gate-in.</p> : null}
        {findings.map((f, i) => (
          <div key={f.requestId} id={`item-req-${f.requestId}`} className={`rounded-card border p-3 flex flex-col gap-3 ${problemKeys.has(`req-${f.requestId}`) ? "border-line" : "border-green"}`}>
            <p className="font-bold">
              {i + 1}. {f.text}
            </p>
            <StatusButtons value={f.status} onPick={(s) => setFindingStatus(f.requestId, s)} disabled={locked} statuses={CHECK_STATUSES} />
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">What was found (required)</span>
              <Textarea value={f.found} onChange={(e) => setFindingText(f.requestId, "found", e.target.value)} rows={2} disabled={locked} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">What it needs</span>
              <Textarea value={f.needs} onChange={(e) => setFindingText(f.requestId, "needs", e.target.value)} rows={2} disabled={locked} />
            </label>
            <div className="flex flex-wrap items-start gap-3">
              <InspectionMedia inspectionId={inspectionId} files={filesFor({ requestId: f.requestId })} where={{ requestId: f.requestId }} disabled={locked} onAdded={addFile({ requestId: f.requestId })} />
              {!locked ? <QuickCodeButton jobId={jobId} target={`req-${f.requestId}`} label="Photo from my phone" compact /> : null}
            </div>
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${marked} of ${total} marked`}>Full inspection</SectionLabel>
        <p className="text-sm text-muted">Tap GOOD, AVERAGE, BAD or N/A on every item. AVERAGE and BAD need a remark: tap a suggestion or type. List the parts as rows with the quantity. N/A means it does not apply to this car.</p>
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
              {!locked && open ? (
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
              const sug = suggestions[it.key] ?? {};
              const disc = isDiscItem(it.label);
              const fluid = isFluidItem(it.label);
              const leak = isLeakItem(it.label);
              return (
                <div key={it.key} id={`item-${it.key}`} className={`rounded-card border p-3 flex flex-col gap-3 ${it.dangerous ? "border-red-bar border-2" : it.status === "bad" ? "border-red-bar" : it.status === "average" ? "border-amber-bar" : "border-line"}`}>
                  <p className="font-semibold flex flex-wrap items-center gap-2">
                    {it.label}
                    {it.dangerous ? <span className="rounded-control bg-red-bar px-2 py-0.5 text-xs font-extrabold text-white">DANGEROUS</span> : null}
                    {it.editedBy ? <span className="text-xs font-medium text-muted">edited by {it.editedBy}</span> : null}
                  </p>
                  <StatusButtons value={it.status} onPick={(s) => setItemStatus(it.key, s)} disabled={locked} statuses={ITEM_STATUSES} />
                  {disc ? (
                    <div className="flex flex-col gap-2 rounded-control bg-chip p-2">
                      <span className="text-xs font-semibold text-muted">Disc condition</span>
                      <Chips options={DISC_CONDITIONS} value={it.disc_condition} onPick={(v) => setDisc(it, "disc_condition", v)} disabled={locked} small />
                      <span className="text-xs font-semibold text-muted">Action{it.disc_condition === "below_minimum" ? " (below minimum: replace)" : ""}</span>
                      <Chips options={DISC_ACTIONS} value={it.disc_action} onPick={(v) => setDisc(it, "disc_action", v)} disabled={locked || it.disc_condition === "below_minimum"} small />
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Measured (mm, optional)</span><Input value={it.disc_thickness} onChange={(e) => patchItem(it.key, { disc_thickness: e.target.value }, false)} inputMode="decimal" disabled={locked} /></label>
                        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Minimum (mm, optional)</span><Input value={it.disc_minimum} onChange={(e) => patchItem(it.key, { disc_minimum: e.target.value }, false)} inputMode="decimal" disabled={locked} /></label>
                      </div>
                    </div>
                  ) : null}
                  {needsDetail || it.remarks ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted">Remarks{needsDetail ? " (required)" : ""}</span>
                      {sug.remarks?.length && !locked ? (
                        <div className="flex flex-wrap gap-1.5">
                          {sug.remarks.slice(0, 8).map((r) => (
                            <button key={r} type="button" onClick={() => patchItem(it.key, { remarks: it.remarks.trim() ? `${it.remarks.trim()} · ${r}` : r })} className="min-h-9 rounded-control border border-line-strong bg-white px-2 text-xs font-semibold">{r}</button>
                          ))}
                        </div>
                      ) : null}
                      <Textarea value={it.remarks} onChange={(e) => patchItem(it.key, { remarks: e.target.value }, false)} rows={2} disabled={locked} />
                    </div>
                  ) : null}
                  {needsDetail && leak ? (
                    <div className="flex flex-col gap-2 rounded-control bg-chip p-2">
                      <span className="text-xs font-semibold text-muted">Leak? Severity</span>
                      <Chips options={LEAK_SEVERITIES} value={it.leak_severity} onPick={(v) => setLeak(it, "leak_severity", v)} disabled={locked} small />
                      <span className="text-xs font-semibold text-muted">Repair</span>
                      <Chips options={LEAK_REPAIRS} value={it.leak_repair} onPick={(v) => setLeak(it, "leak_repair", v)} disabled={locked} small />
                      <span className="text-[11px] text-muted">Tapping these writes the remark and adds the part.</span>
                    </div>
                  ) : null}
                  {needsDetail && fluid ? (
                    <div className="flex flex-col gap-2 rounded-control bg-chip p-2">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity ({fluidUnitFor(it.label, it.fluid_unit) === "g" ? "grams" : "litres"}, max {limits.fluid_max} L)</span><Input value={it.fluid_qty} onChange={(e) => patchItem(it.key, { fluid_qty: e.target.value, fluid_unit: fluidUnitFor(it.label, it.fluid_unit) }, false)} inputMode="decimal" disabled={locked} className={Number(it.fluid_qty) > limits.fluid_max && fluidUnitFor(it.label, it.fluid_unit) === "l" ? "border-red-bar" : ""} /></label>
                        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Approval spec (optional)</span><Input value={it.fluid_spec} onChange={(e) => patchItem(it.key, { fluid_spec: e.target.value }, false)} disabled={locked} placeholder="For example: MB 229.5" /></label>
                      </div>
                      <span className="text-xs font-semibold text-muted">Grade (optional)</span>
                      <Chips options={fluidGradesFor(it.label, fluidGrades).map((g) => ({ value: g, label: g }))} value={it.fluid_grade} onPick={(v) => patchItem(it.key, { fluid_grade: it.fluid_grade === v ? "" : v })} disabled={locked} small />
                      <Input value={it.fluid_grade} onChange={(e) => patchItem(it.key, { fluid_grade: e.target.value }, false)} disabled={locked} placeholder="Or type the grade" className="max-w-56" />
                    </div>
                  ) : null}
                  {needsDetail ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-semibold text-muted">Parts needed</span>
                      {sug.parts?.length && !locked ? (
                        <div className="flex flex-wrap gap-1.5">
                          {sug.parts.slice(0, 10).map((p) => (
                            <button key={p} type="button" onClick={() => { if (!it.parts_rows.some((r) => r.part.toLowerCase() === p.toLowerCase())) setRows(it, [...it.parts_rows, { part: p, qty: 1, unit: "pc" }], true); }} className="min-h-9 rounded-control border border-line-strong bg-white px-2 text-xs font-semibold">+ {p}</button>
                          ))}
                        </div>
                      ) : null}
                      {it.parts_rows.map((r, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5 items-center">
                          <Input value={r.part} list="erp-part-suggestions" onChange={(e) => setRows(it, it.parts_rows.map((x, j) => (j === idx ? { ...x, part: e.target.value } : x)), false)} disabled={locked} placeholder="Part name or number" />
                          <span className="inline-flex items-center rounded-control border border-line-strong bg-white">
                            <button type="button" disabled={locked} onClick={() => setRows(it, it.parts_rows.map((x, j) => (j === idx ? { ...x, qty: Math.max(1, x.qty - 1) } : x)), true)} className="min-h-11 w-10 text-lg font-bold">−</button>
                            <span className="w-8 text-center text-sm font-bold">{r.qty}</span>
                            <button type="button" disabled={locked} onClick={() => setRows(it, it.parts_rows.map((x, j) => (j === idx ? { ...x, qty: x.qty + 1 } : x)), true)} className="min-h-11 w-10 text-lg font-bold">+</button>
                          </span>
                          <Select value={r.unit} onChange={(e) => setRows(it, it.parts_rows.map((x, j) => (j === idx ? { ...x, unit: e.target.value } : x)), true)} disabled={locked} className="w-24">
                            {PARTS_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </Select>
                          <button type="button" disabled={locked} aria-label="Remove part" onClick={() => setRows(it, it.parts_rows.filter((_, j) => j !== idx), true)} className="min-h-11 w-10 rounded-control border border-line text-sm font-bold text-red">×</button>
                        </div>
                      ))}
                      {!locked ? <button type="button" onClick={() => setRows(it, [...it.parts_rows, { part: "", qty: 1, unit: "pc" }], false)} className="self-start min-h-10 rounded-control border border-dashed border-line-strong px-3 text-xs font-bold">+ Add a part</button> : null}
                    </div>
                  ) : null}
                  {needsDetail || filesFor({ itemKey: it.key }).length ? (
                    <div className="flex flex-wrap items-start gap-3">
                      <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: it.key })} where={{ itemKey: it.key }} disabled={locked} onAdded={addFile({ itemKey: it.key })} />
                      {!locked ? <QuickCodeButton jobId={jobId} target={it.key} label="Photo from my phone" compact /> : null}
                    </div>
                  ) : null}
                  {it.status === "bad" ? (
                    <div className={`flex flex-col gap-2 rounded-control p-2 ${it.dangerous ? "bg-red-soft" : "bg-chip"}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={locked} onClick={() => patchItem(it.key, { dangerous: !it.dangerous })} aria-pressed={it.dangerous} className={`min-h-11 rounded-control border-2 px-3 text-sm font-extrabold ${it.dangerous ? "border-red-bar bg-red-bar text-white" : "border-line-strong bg-white"}`}>
                          {it.dangerous ? "DANGEROUS TO DRIVE: ON" : "Dangerous to drive?"}
                        </button>
                        <span className="text-xs text-muted">Optional. When on: the manager, advisor and owner are told at once; the line is Urgent and the customer sees a safety warning.</span>
                      </div>
                      {it.dangerous ? <Input value={it.dangerous_reason} onChange={(e) => patchItem(it.key, { dangerous_reason: e.target.value }, false)} disabled={locked} placeholder="Why it is dangerous (required)" className={!it.dangerous_reason.trim() ? "border-red-bar" : ""} /> : null}
                    </div>
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
          const year = measurements[`tyre_${p.key}_year`] ?? "";
          const age = year === "older" ? limits.tyre_years + 1 : /^\d{4}$/.test(year) ? thisYear - Number(year) : null;
          const danger = measurements[`tyre_${p.key}_danger`] === "1";
          return (
            <div key={p.key} className={`rounded-card border p-3 flex flex-col gap-3 ${danger ? "border-red-bar border-2" : "border-line"}`}>
              <p className="font-semibold flex flex-wrap items-center gap-2">{p.label}{danger ? <span className="rounded-control bg-red-bar px-2 py-0.5 text-xs font-extrabold text-white">DANGEROUS</span> : null}</p>
              <div className="grid grid-cols-2 gap-3">
                <label id={`item-m-tyre_${p.key}_tread`} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Tread depth (mm, 0 to {limits.tread_max})</span>
                  <Input value={measurements[`tyre_${p.key}_tread`] ?? ""} onChange={(e) => setMeasurement(`tyre_${p.key}_tread`, e.target.value)} inputMode="decimal" disabled={locked} className={outOfRange(`tyre_${p.key}_tread`) ? "border-red-bar" : ""} />
                </label>
                <div id={`item-m-tyre_${p.key}_year`} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Tyre year</span>
                  <div className="flex gap-1.5">
                    <Select value={year} onChange={(e) => setMeasurement(`tyre_${p.key}_year`, e.target.value, true)} disabled={locked} className="flex-1">
                      <option value="">Choose…</option>
                      {yearOptions.map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
                    </Select>
                    {p.key !== "fl" && measurements.tyre_fl_year && !locked ? <button type="button" onClick={() => setMeasurement(`tyre_${p.key}_year`, measurements.tyre_fl_year ?? "", true)} className="min-h-11 rounded-control border border-line-strong bg-white px-2 text-xs font-bold whitespace-nowrap">Same as front left</button> : null}
                  </div>
                  {age !== null && age > limits.tyre_years ? <span className="text-xs font-bold text-red">Older than {limits.tyre_years} years</span> : age !== null && age >= 6 ? <span className="text-xs font-bold text-amber">{age} years old</span> : null}
                </div>
              </div>
              <div id={`item-m-tyre_${p.key}_cond`} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted">Condition (tap all that apply)</span>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {TYRE_CONDITIONS.map((c) => (
                    <button key={c.value} type="button" disabled={locked} onClick={() => toggleTyreCondition(p.key, c.value)} aria-pressed={cond.includes(c.value)} className={tyreBtn(cond.includes(c.value))}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div id={`item-m-tyre_${p.key}_action`} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted">Action</span>
                <div className="grid grid-cols-3 gap-2">
                  {TYRE_ACTIONS.map((a) => (
                    <button key={a.value} type="button" disabled={locked} onClick={() => { setMeasurement(`tyre_${p.key}_action`, a.value, true); if (a.value !== "replace_now" && danger) setMeasurement(`tyre_${p.key}_danger`, "", true); }} aria-pressed={action === a.value} className={tyreBtn(action === a.value)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              {action === "replace_now" ? (
                <div className={`flex flex-col gap-2 rounded-control p-2 ${danger ? "bg-red-soft" : "bg-chip"}`}>
                  <button type="button" disabled={locked} onClick={() => setMeasurement(`tyre_${p.key}_danger`, danger ? "" : "1", true)} aria-pressed={danger} className={`self-start ${tyreBtn(danger, true)}`}>{danger ? "DANGEROUS TO DRIVE: ON" : "Dangerous to drive?"}</button>
                  {danger ? <Input value={measurements[`tyre_${p.key}_danger_reason`] ?? ""} onChange={(e) => setMeasurement(`tyre_${p.key}_danger_reason`, e.target.value)} disabled={locked} placeholder="Why it is dangerous (required)" className={!(measurements[`tyre_${p.key}_danger_reason`] ?? "").trim() ? "border-red-bar" : ""} /> : null}
                </div>
              ) : null}
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
          <div key={g} className="flex flex-col gap-2" id={g === "Battery test" ? "item-measure-battery" : undefined}>
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{g}</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MEASUREMENTS.filter((m) => m.group === g).map((m) => (
                <label key={m.key} id={`item-m-${m.key}`} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">
                    {m.label}
                    {m.unit ? ` (${m.unit}${m.key.startsWith("pad") ? `, 0 to ${limits.pads_max}` : m.key === "battery_voltage" ? `, 0 to ${limits.battery_max}` : m.key === "vent_temp" ? `, ${limits.vent_min} to ${limits.vent_max}` : ""})` : ""}
                  </span>
                  {m.kind === "choice" ? (
                    <div className="grid grid-cols-3 gap-1">
                      {m.choices!.map((c) => (
                        <button key={c.value} type="button" disabled={locked} onClick={() => setMeasurement(m.key, c.value, true)} aria-pressed={measurements[m.key] === c.value} className={`min-h-11 rounded-control border text-xs font-bold ${measurements[m.key] === c.value ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Input value={measurements[m.key] ?? ""} onChange={(e) => setMeasurement(m.key, e.target.value)} inputMode="decimal" disabled={locked} className={outOfRange(m.key) ? "border-red-bar" : ""} />
                  )}
                </label>
              ))}
            </div>
            {g === "Battery test" ? (
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Photo of the tester&apos;s printout</span>
                  <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: "measure.battery" })} where={{ itemKey: "measure.battery" }} disabled={locked} onAdded={addFile({ itemKey: "measure.battery" })} />
                </div>
                {!locked ? <QuickCodeButton jobId={jobId} target="measure-battery" label="Continue on my phone" /> : null}
              </div>
            ) : null}
          </div>
        ))}
      </Card>

      {!scanState?.gate ? (
        <div id="item-prescan">
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel right={prescanFiles.length ? `${prescanFiles.length} attached` : "optional"}>Pre-scan (Autel fault code report, PDF)</SectionLabel>
              {prescanFiles.length ? <Dot ok attempted={attempted} /> : null}
            </div>
            <p className="text-xs text-muted">Optional. Reports emailed by the scanner attach themselves; the technician or the workshop manager can also attach one here, now or later.</p>
            <InspectionMedia inspectionId={inspectionId} files={prescanFiles} where={{ isPrescan: true }} accept="pdf" disabled={disabled && !canAddPrescan} onAdded={addFile({ isPrescan: true })} />
            {showPrescanToggle ? <PrescanToggle inspectionId={inspectionId} initial={prescanVisible} /> : null}
          </Card>
        </div>
      ) : null}

      <Card className="flex flex-col gap-3" id="item-estimate">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Big job? Estimated hours</SectionLabel>
          {submitAction ? <Dot ok={!problemKeys.has("estimate")} attempted={attempted} /> : null}
        </div>
        <p className="text-sm text-muted">Mention anything big before you submit: tap the tags that apply.</p>
        {bigJobTags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {bigJobTags.map((t) => (
              <button key={t} type="button" disabled={locked} onClick={() => toggleTag(t)} aria-pressed={tags.includes(t)} className={`min-h-11 rounded-control border-2 px-3 text-sm font-bold ${tags.includes(t) ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{t}</button>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Estimated hours for this job (total{submitAction ? ", required" : ""})</span>
            <Input value={estimate} onChange={(e) => { setEstimate(e.target.value); debounced("estimate", () => ({ inspection: { estimated_hours: e.target.value } })); }} inputMode="decimal" disabled={locked} className={`w-32 ${attempted && problemKeys.has("estimate") ? "border-red-bar" : ""}`} placeholder="For example 6.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">How you got there (optional)</span>
            <Input value={estimateReason} onChange={(e) => { setEstimateReason(e.target.value); debounced("estimate-reason", () => ({ inspection: { estimate_reason: e.target.value } })); }} disabled={locked} placeholder="For example: engine out for the rear main seal" />
          </label>
        </div>
        <p className="text-xs text-muted">The workshop manager agrees or changes the hours when approving; the advisor sees them on the quotation as the workshop estimate.</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Technician&apos;s notes</SectionLabel>
        <Textarea value={notes} onChange={(e) => setNotesText(e.target.value)} rows={4} disabled={locked} placeholder="Anything the workshop manager and advisor should know." />
      </Card>

      {allPartSuggestions.length ? (
        <datalist id="erp-part-suggestions">
          {allPartSuggestions.map((p) => <option key={p} value={p} />)}
        </datalist>
      ) : null}

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
