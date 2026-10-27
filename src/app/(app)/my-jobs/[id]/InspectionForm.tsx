"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { flushTimers, onPageLeave } from "@/lib/app-version";
import { PARTS_LIST_CHANGED_EVENT } from "@/components/PartsListTick";
import { InspectionMedia, type InspectionFile } from "@/components/InspectionMedia";
import { AC_GASES, AC_GRAM_CHIPS, AC_LEAKS, AC_REPAIRS, LABOUR_HOUR_CHIPS, PAD_AUTO_REMARK_RE, PAD_MM_CHIPS, acPartFor, isPadItem, padMeasureKey, padStatusForMm, padWords } from "@/lib/inspection";
import { PartPicker } from "@/components/PartPicker";
import { BodyshopFindings, type BodyStateProps } from "./BodyshopFindings";
import { panelLabel } from "@/lib/car-outline";
import { batteryEntriesFrom, goesWithOffers, mergePartsList, newEntryId, offerEntry, partsListLine, positionsWords, suggestCatalogue, tyreEntriesFrom, withAutoEntries, type CatalogueRow, type PartsListEntry } from "@/lib/parts-list";
import { ActionForm, type FormAction } from "@/components/forms";
import { JumpButton, ProblemsBar, SubmitOutcome, jumpTo } from "@/components/FormAssist";
import { PrescanToggle } from "@/components/PrescanToggle";
import { QuickCodeButton } from "@/components/QuickCodeButton";
import { TyreSizeInput } from "@/components/TyreSizeInput";
import { Card, Input, Notice, SectionLabel, Select, Textarea } from "@/components/ui";
import {
  DISC_ACTIONS,
  DISC_CONDITIONS,
  LEAK_REPAIRS,
  LEAK_SEVERITIES,
  MEASUREMENTS,
  OPTIONAL_SECTION_KEY,
  ROAD_TEST_SECTION_KEY,
  TYRE_ACTIONS,
  TYRE_CONDITIONS,
  TYRE_POSITIONS,
  TYRE_REASON_ABOVE_MM,
  TYRE_REPLACE_REASONS,
  autoRemarkFor,
  cleanTyreConditions,
  discStatus,
  fluidGradesFor,
  fluidUnitFor,
  hasStructuredDetail,
  isDiscItem,
  isFluidItem,
  isLeakItem,
  itemStatusLabel,
  itemStatusesFor,
  leakPartFor,
  leakRemark,
  reportProblemsOf,
  reportProgressOf,
  tyreItemStatus,
  tyreReasonNeeded,
  tyreSizeComplete,
  tyreSizeText,
  tyreYearOptions,
  type ChecklistSection,
  type InspectionLimits,
  type ItemStatus,
  type ItemStyle,
  type PartsRow,
} from "@/lib/inspection";

export type ItemState = {
  key: string;
  label: string;
  sectionKey: string;
  /** grade: Good / Average / Bad. job: OK / Required. */
  style: ItemStyle;
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
  labour_hours: string;
  parts_rows: PartsRow[];
  /** A fluid whose change is due ("Service due?" on engine oil, brake fluid, coolant, transmission). */
  service_due?: boolean;
  /** The A/C gas: recharge needed (ticked by itself when Low or Empty). */
  recharge_needed?: boolean;
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
        const data = (await res.json()) as { ok?: boolean; error?: string; tickCleared?: boolean };
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
        // The manager's tick under the parts list came off with this change: the tick on screen follows at once.
        if (data.tickCleared) window.dispatchEvent(new CustomEvent(PARTS_LIST_CHANGED_EVENT));
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

  return { save, state, error, flush };
}

/** Good / Average / Bad (or OK / Required on a job item), plus N/A in grey. */
function StatusButtons({ value, onPick, disabled, statuses, style = "grade" }: { value: ItemStatus | null; onPick: (s: ItemStatus) => void; disabled: boolean; statuses: readonly ItemStatus[]; style?: ItemStyle }) {
  return (
    <div className={`grid gap-2 ${statuses.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
      {statuses.map((s) => (
        <button key={s} type="button" disabled={disabled} onClick={() => onPick(s)} aria-pressed={value === s} className={`min-h-12 rounded-control border-2 text-sm font-extrabold tracking-[0.04em] ${value === s ? STATUS_CLASS[s] : s === "na" ? "border-line bg-white text-muted" : "border-line-strong bg-white"} ${disabled ? "opacity-60" : ""}`}>
          {itemStatusLabel(s, style)}
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

const AUTO_LIMITS: InspectionLimits = { tread_max: 12, pads_max: 20, battery_max: 16, vent_min: -5, vent_max: 40, fluid_max: 30, tyre_years: 15, pads_bad_max: 3, pads_good_min: 6 };

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
  requests = [],
  requestsNote: initialRequestsNote = "",
  complaintKeywords = {},
  wheelConditions = [],
  tyreSizeSuggestion = null,
  catalogue = [],
  partsList: initialPartsList = [],
  noPartItems: initialNoPart = [],
  partsListFooter = null,
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
  quickRemarks = [],
  tyreBrands = [],
  fluidGrades = [],
  bigJobTags = [],
  initialTags = [],
  estimatedHours: initialEstimate = "",
  estimateReason: initialEstimateReason = "",
  scan = null,
  thisYear = new Date().getFullYear(),
  body = null,
}: {
  /** The bodyshop findings at the bottom (section 7, 23 October 2026): their state and who may change or check them. */
  body?: { initial: BodyStateProps; canEdit: boolean; canCheck: boolean } | null;
  inspectionId: string;
  jobId: string;
  checklist: ChecklistSection[];
  items: ItemState[];
  /** The customer's requests, read on the report (not answered). */
  requests?: { id: string; text: string }[];
  requestsNote?: string;
  /** Words in a request that tag a section "Customer complaint", by section key (Settings). */
  complaintKeywords?: Record<string, string[]>;
  /** What was ticked under each wheel at gate-in, shown next to the wheel item. */
  wheelConditions?: { label: string; text: string }[];
  /** The tyre sizes other cars of this model had, offered on an empty box. */
  tyreSizeSuggestion?: { front: string; rear: string } | null;
  /** The owner's parts pool for the picker. */
  catalogue?: CatalogueRow[];
  /** The parts gathered so far. */
  partsList?: PartsListEntry[];
  /** Bad items the technician said need no part. */
  noPartItems?: string[];
  /** Shown under the parts list (the manager's tick on the review). */
  partsListFooter?: ReactNode;
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
  /** One-tap remarks offered on every item (Settings), before the learned ones. */
  quickRemarks?: string[];
  /** The brand list under the tyre brand box (Settings); it filters as the technician types and anything else can still be typed. */
  tyreBrands?: string[];
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
  const [requestsNote, setRequestsNote] = useState(initialRequestsNote);
  const [barOpen, setBarOpen] = useState(false);
  const [partsList, setPartsList] = useState<PartsListEntry[]>(initialPartsList);
  const partsRef = useRef(initialPartsList);
  const [pickerFor, setPickerFor] = useState<{ itemKey: string | null; label: string } | null>(null);
  const [noPartItems, setNoPartItems] = useState<string[]>(initialNoPart);
  const [showAverage, setShowAverage] = useState(false);
  // Items whose choices already describe them keep the remark box folded; these were opened by hand.
  const [remarkOpen, setRemarkOpen] = useState<Set<string>>(new Set());
  const toggleNoPart = (key: string) => {
    const next = noPartItems.includes(key) ? noPartItems.filter((k) => k !== key) : [...noPartItems, key];
    setNoPartItems(next);
    save({ noPartItems: next });
  };
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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const { save, state, error, flush } = useAutosave(inspectionId);
  const disabled = readOnly;
  const sections = checklist.filter((s) => s.key !== ROAD_TEST_SECTION_KEY);
  const scanGateOpen = !scanState?.gate || !!scanState.readAt || !!scanState.approvedAt;
  const locked = disabled || !scanGateOpen;

  const waiting = useRef<Record<string, () => Op>>({});
  function debounced(key: string, op: () => Op) {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    waiting.current[key] = op;
    timers.current[key] = setTimeout(() => {
      delete timers.current[key];
      delete waiting.current[key];
      save(op());
    }, 500);
  }
  useEffect(() => onPageLeave(() => flushTimers(timers.current, waiting.current, save)), [save]);
  const [touchedKeys, setTouchedKeys] = useState<Set<string>>(() => new Set());
  const patchItem = (key: string, fields: Partial<ItemState>, immediate = true) => {
    setTouchedKeys((s) => (s.has(key) ? s : new Set(s).add(key)));
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...fields } : i)));
    const op = () => ({ item: { key, ...fields } });
    if (immediate) save(op());
    else debounced(`${key}.${Object.keys(fields).join(",")}`, op);
  };
  function setItemStatus(key: string, status: ItemStatus) {
    const extra: Partial<ItemState> = status === "bad" ? {} : { dangerous: false };
    // The A/C gas: Low or Empty ticks "Recharge needed" by itself; Good or N/A clears it.
    const it = items.find((i) => i.key === key);
    if (it?.style === "gas") extra.recharge_needed = status === "average" || status === "bad";
    patchItem(key, { status, ...extra });
  }
  /** The A/C gas: leak, repair, gas and grams; the remark is written from them unless the technician wrote his own, a repair adds its part. */
  function setAc(it: ItemState, fields: Partial<ItemState>) {
    const next = { ...it, ...fields };
    const auto = autoRemarkFor(next);
    const remarks = !it.remarks.trim() || it.remarks === autoRemarkFor(it) ? auto : it.remarks;
    const part = fields.leak_repair ? acPartFor(fields.leak_repair) : null;
    if (part) addEntryIfMissing(it.key, part);
    patchItem(it.key, { ...fields, remarks, ...(fields.fluid_qty !== undefined || fields.fluid_grade !== undefined ? { fluid_unit: "g" } : {}) });
  }
  // Items that also ask "Service due?" (marked in the checklist).
  const dueKeys = new Set(checklist.flatMap((s) => s.items.filter((i) => i.due).map((i) => i.key)));
  function allGood(sectionKey: string) {
    setItems((prev) => prev.map((i) => (i.sectionKey === sectionKey && !i.status ? { ...i, status: "good" } : i)));
    save({ sectionAllGood: sectionKey });
  }
  function allNa(sectionKey: string) {
    setItems((prev) => prev.map((i) => (i.sectionKey === sectionKey ? { ...i, status: "na" } : i)));
    save({ sectionAll: { key: sectionKey, status: "na" } });
  }
  function setRequestsNoteText(value: string) {
    setRequestsNote(value);
    debounced("requests-note", () => ({ inspection: { requests_note: value } }));
  }
  // The place on the page is remembered, so a tablet put down and picked up again opens where the technician was.
  useEffect(() => {
    const key = `erp-inspection-pos-${inspectionId}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const s = JSON.parse(raw) as { y: number; t: number };
        if (Date.now() - s.t < 86400000 && s.y > 120 && !location.hash) {
          const go = () => window.scrollTo({ top: s.y });
          requestAnimationFrame(go);
          setTimeout(go, 300);
        }
      }
    } catch {}
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        try {
          localStorage.setItem(key, JSON.stringify({ y: window.scrollY, t: Date.now() }));
        } catch {}
      }, 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [inspectionId]);
  /** The parts list is saved whole on every change; the tyre and battery entries follow their answers. */
  const setList = (list: PartsListEntry[]) => {
    partsRef.current = list;
    setPartsList(list);
    save({ partsList: list });
  };
  const syncAutoParts = (m: Record<string, string>) => {
    let list = withAutoEntries(partsRef.current, "tyre", tyreEntriesFrom(m, catalogue));
    list = withAutoEntries(list, "measure", batteryEntriesFrom(m, catalogue));
    if (list !== partsRef.current) setList(list);
  };
  const commitParts = (itemKey: string | null, entries: PartsListEntry[]) => {
    const kept = partsRef.current.filter((e) => !((e.item_key ?? null) === itemKey && (e.source === "item" || e.source === "custom")));
    setList([...kept, ...entries]);
    setPickerFor(null);
  };
  const removeEntry = (id: string) => setList(partsRef.current.filter((e) => e.id !== id));
  const addEntryIfMissing = (itemKey: string, name: string) => {
    if (partsRef.current.some((e) => e.item_key === itemKey && e.name.toLowerCase() === name.toLowerCase())) return;
    const row = catalogue.find((c) => c.name.toLowerCase() === name.toLowerCase());
    setList([...partsRef.current, { id: newEntryId(), catalogue_id: row?.id ?? null, name: row?.name ?? name, qty: 1, positions: [], item_key: itemKey, source: "item", note: null, unit: "pc" }]);
  };
  function setMeasurement(key: string, value: string, immediate = false) {
    const next = { ...latestMeasurements.current, [key]: value };
    latestMeasurements.current = next;
    setMeasurements(next);
    if (/^tyre_|^battery_/.test(key)) syncAutoParts(next);
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
    if (part) addEntryIfMissing(it.key, part);
    patchItem(it.key, { [field]: next[field], remarks });
  }
  /** Brake pads: the mm sets Good / Average / Bad by itself (thresholds from Settings); the technician can still change it. */
  function setPadMm(it: ItemState, value: string, immediate = false) {
    setMeasurement(padMeasureKey(it.label), value, immediate);
    const status = padStatusForMm(value, limits);
    const auto = padWords(value, status);
    const remarks = !it.remarks.trim() || PAD_AUTO_REMARK_RE.test(it.remarks.trim()) ? auto : it.remarks;
    patchItem(it.key, { remarks, ...(status ? { status } : {}) });
  }

  /** Brake discs: the condition and the action set AVERAGE or BAD by themselves; below minimum locks the action to replace. */
  function setDisc(it: ItemState, field: "disc_condition" | "disc_action", value: string) {
    const next = { ...it, [field]: value };
    if (next.disc_condition === "below_minimum") next.disc_action = "replace";
    const status = discStatus(next.disc_condition, next.disc_action);
    // The remark is written from the choices unless the technician wrote his own.
    const auto = autoRemarkFor(next);
    const remarks = !it.remarks.trim() || it.remarks === autoRemarkFor(it) ? auto : it.remarks;
    patchItem(it.key, { disc_condition: next.disc_condition, disc_action: next.disc_action, remarks, ...(status ? { status } : {}) });
  }

  const filesFor = (where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }) =>
    files.filter((f) => (where.isPrescan ? f.isPrescan : !f.isPrescan && (f.itemKey ?? null) === (where.itemKey ?? null) && (f.requestId ?? null) === (where.requestId ?? null)));
  const removeFile = (id: string) => setFiles((f) => f.filter((x) => x.id !== id));
  const addFile = (where: { itemKey?: string | null; requestId?: string | null; isPrescan?: boolean }) => (f: InspectionFile) =>
    setFiles((prev) => [...prev, { ...f, itemKey: where.itemKey ?? null, requestId: where.requestId ?? null, isPrescan: !!where.isPrescan }]);

  const reportState = { items, measurements, estimatedHours: submitAction ? estimate : null, scan: scanState?.gate ? { required: true, read: !!scanState.readAt, approved: !!scanState.approvedAt } : undefined };
  const problems = reportProblemsOf(reportState, { limits });
  const progress = reportProgressOf(reportState, { limits });
  const problemKeys = new Set(problems.map((p) => p.key));
  const sectionOk = (sectionKey: string) => !items.some((i) => i.sectionKey === sectionKey && problemKeys.has(i.key));
  const marked = items.filter((i) => i.sectionKey !== ROAD_TEST_SECTION_KEY && i.status).length;
  const total = items.filter((i) => i.sectionKey !== ROAD_TEST_SECTION_KEY).length;
  const tyresOk = !problems.some((p) => p.key.startsWith("m-tyre"));
  const numbersOk = !problems.some((p) => p.key.startsWith("m-") && !p.key.startsWith("m-tyre"));
  const tyreBtn = (on: boolean, danger = false) => `min-h-11 rounded-control border-2 px-2 text-xs font-bold ${on ? (danger ? "border-red-bar bg-red-bar text-white" : "border-green bg-green-soft text-green") : "border-line-strong bg-white"} ${locked ? "opacity-60" : ""}`;
  const prescanFiles = filesFor({ isPrescan: true });
  const yearOptions = tyreYearOptions(thisYear, limits.tyre_years);
  const mergedParts = mergePartsList(partsList);
  /** A position listed twice for the same part: it was probably picked twice. */
  const dupPositions = (line: { entries: PartsListEntry[] }) => {
    const seen = new Map<string, number>();
    for (const e of line.entries) for (const p of e.positions) seen.set(p, (seen.get(p) ?? 0) + 1);
    return Array.from(seen.entries()).filter(([, n]) => n > 1).map(([p]) => p);
  };
  /** The manager (or the technician) corrects a part's name on the list; the pool link is dropped when the name no longer matches. */
  const renameLine = (line: { entries: PartsListEntry[]; name: string }) => {
    const n = window.prompt("Correct the part name", line.name);
    const clean = n?.trim();
    if (!clean || clean === line.name) return;
    const ids = new Set(line.entries.map((e) => e.id));
    setList(partsRef.current.map((e) => (ids.has(e.id) ? { ...e, name: clean, catalogue_id: null } : e)));
  };
  /** A bundled line ("Radiator + pipes + hoses") becomes separate parts, each with its own quantity. */
  const splitLine = (line: { entries: PartsListEntry[]; name: string }) => {
    const text = window.prompt("Split into separate parts, separated by commas. For example: Radiator × 1, Pipes × 2, Hoses × 2", "");
    if (!text?.trim()) return;
    const parsed = text.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean).map((t) => {
      const m = t.match(/^(.*?)(?:\s*[×x*]\s*(\d+(?:\.\d+)?))?$/i);
      return { name: (m?.[1] ?? t).trim(), qty: m?.[2] ? Number(m[2]) : 1 };
    }).filter((p) => p.name);
    if (parsed.length < 2) {
      window.alert("Give at least two parts, separated by commas.");
      return;
    }
    const first = line.entries[0];
    const ids = new Set(line.entries.map((e) => e.id));
    const fresh: PartsListEntry[] = parsed.map((p) => ({ id: newEntryId(), catalogue_id: null, name: p.name, qty: p.qty, positions: [...first.positions], item_key: first.item_key, source: "custom", note: first.note, unit: "pc" }));
    setList([...partsRef.current.filter((e) => !ids.has(e.id)), ...fresh]);
  };
  const fromLabel = (line: { entries: PartsListEntry[] }) =>
    Array.from(new Set(line.entries.map((e) => (e.source === "tyre" ? "Tyres" : e.source === "measure" ? "Battery test" : e.item_key ? (items.find((i) => i.key === e.item_key)?.label ?? "") : "")))).filter(Boolean).join(", ");
  const outOfRange = (key: string) => problems.some((p) => p.key === `m-${key}` && /to |between/.test(p.label));
  const dangerCount = items.filter((i) => i.dangerous).length + TYRE_POSITIONS.filter((p) => measurements[`tyre_${p.key}_danger`] === "1").length;
  // Sections the customer's words point to.
  const complaintSections = new Set(
    Object.entries(complaintKeywords)
      .filter(([, words]) => Array.isArray(words) && requests.some((r) => words.some((w) => w && r.text.toLowerCase().includes(String(w).toLowerCase()))))
      .map(([k]) => k),
  );
  const complaintTag = (sectionKey: string) => (complaintSections.has(sectionKey) ? <span className="rounded-control border border-ink px-2 py-0.5 text-[11px] font-bold">Customer complaint</span> : null);

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
            <InspectionMedia inspectionId={inspectionId} files={prescanFiles} where={{ isPrescan: true }} accept="pdf" disabled={disabled && !canAddPrescan} onAdded={addFile({ isPrescan: true })} onRemoved={removeFile} />
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

      {requests.length ? (
        <>
          <button type="button" onClick={() => setBarOpen((o) => !o)} className="sticky top-1 z-20 flex items-start gap-2 rounded-control border border-line bg-white/95 px-3 py-1.5 text-left text-xs shadow-sm backdrop-blur" aria-expanded={barOpen}>
            <span className="shrink-0 font-bold">Customer says:</span>
            <span className={barOpen ? "whitespace-pre-wrap" : "truncate"}>{requests.map((r, i) => `${i + 1}. ${r.text}`).join(barOpen ? "\n" : " · ")}</span>
          </button>
          <Card className="flex flex-col gap-2" id="item-requests">
            <SectionLabel right={`${requests.length}`}>The customer says</SectionLabel>
            <ol className="flex flex-col gap-1.5">
              {requests.map((r, i) => (
                <li key={r.id} className="flex gap-3 text-base font-semibold leading-snug">
                  <span className="w-6 shrink-0 text-muted">{i + 1}.</span>
                  <span>{r.text}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted">For your information: nothing to answer here. The sections these words point to are marked &quot;Customer complaint&quot; below.</p>
          </Card>
        </>
      ) : null}

      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${marked} of ${total} marked`}>Full inspection</SectionLabel>
        <p className="text-sm text-muted">Tap Good, Average, Bad or N/A on every part of the car; service items are OK or Required. Average and Bad need a remark: tap a suggestion or type. N/A means it does not apply to this car.</p>
      </Card>

      {sections.map((section) => {
        const sectionItems = items.filter((i) => i.sectionKey === section.key);
        const open = sectionItems.filter((i) => !i.status).length;
        const optional = section.key === OPTIONAL_SECTION_KEY;
        const allJobs = sectionItems.length > 0 && sectionItems.every((i) => i.style === "job");
        return (
          <Card key={section.key} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex flex-wrap items-center gap-2">
                <Dot ok={sectionOk(section.key)} attempted={attempted} />
                <SectionLabel right={open ? `${open} to mark${optional ? ", optional" : ""}` : undefined}>{section.title}</SectionLabel>
                {complaintTag(section.key)}
              </span>
              {!locked && open ? (
                <span className="flex gap-2">
                  <button type="button" onClick={() => allGood(section.key)} className="min-h-11 rounded-control border border-green bg-green-soft px-4 text-sm font-bold text-green">
                    {allJobs ? "All OK" : "All good"}
                  </button>
                  <button type="button" onClick={() => allNa(section.key)} className="min-h-11 rounded-control border border-line-strong bg-chip px-4 text-sm font-bold text-muted">
                    All N/A
                  </button>
                </span>
              ) : null}
            </div>
            {sectionItems.map((it) => {
              const isJob = it.style === "job";
              const needsDetail = !isJob && (it.status === "average" || it.status === "bad");
              // Choices that already describe the item (disc condition, leak severity, measured pads...) make the written remark optional and folded.
              const structured = needsDetail && hasStructuredDetail(it, measurements);
              const remarkRequired = needsDetail && !structured;
              const remarkShown = remarkRequired || remarkOpen.has(it.key) || (!structured && !!it.remarks) || (isJob && it.status === "bad");
              const sug = suggestions[it.key] ?? {};
              const disc = isDiscItem(it.label);
              const pads = !disc && isPadItem(it.label) && /front|rear/i.test(it.label);
              const padKey = pads ? padMeasureKey(it.label) : null;
              const gas = it.style === "gas";
              const fluid = !gas && isFluidItem(it.label);
              const leak = !gas && isLeakItem(it.label);
              return (
                <div key={it.key} id={`item-${it.key}`} className={`rounded-card border p-3 flex flex-col gap-3 ${it.dangerous ? "border-red-bar border-2" : isJob ? (it.status === "bad" ? "border-ink" : "border-line") : it.status === "bad" ? "border-red-bar" : it.status === "average" ? "border-amber-bar" : "border-line"}`}>
                  <p className="font-semibold flex flex-wrap items-center gap-2">
                    {it.label}
                    {/* The tick keeps its place whether shown or not, so the line never changes width while typing. */}
                    <span className={`inline-block w-4 text-center text-xs font-bold ${state === "saving" ? "text-muted" : state === "offline" ? "text-amber" : "text-green"}`} title={!touchedKeys.has(it.key) ? undefined : state === "saving" ? "Saving…" : state === "offline" ? "Not saved yet: no connection" : "Saved"} data-item-saved={touchedKeys.has(it.key) ? state : undefined} aria-hidden={!touchedKeys.has(it.key)}>{!touchedKeys.has(it.key) ? "" : state === "saving" ? "…" : state === "offline" ? "!" : "✓"}</span>
                    {it.dangerous ? <span className="rounded-control bg-red-bar px-2 py-0.5 text-xs font-extrabold text-white">DANGEROUS</span> : null}
                    {it.editedBy ? <span className="text-xs font-medium text-muted">edited by {it.editedBy}</span> : null}
                  </p>
                  {/wheel condition/i.test(it.label) && wheelConditions.length ? <p className="text-xs text-muted">At gate-in: {wheelConditions.map((w) => `${w.label} ${w.text}`).join(" · ")}</p> : null}
                  <StatusButtons value={it.status} onPick={(s) => setItemStatus(it.key, s)} disabled={locked} statuses={itemStatusesFor(it.style)} style={it.style} />
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
                      <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: `item.${it.key}` })} where={{ itemKey: `item.${it.key}` }} disabled={locked} iconOnly label="Photo of the discs" onAdded={addFile({ itemKey: `item.${it.key}` })} onRemoved={removeFile} />
                    </div>
                  ) : null}
                  {pads && padKey ? (
                    <div className="flex flex-col gap-2 rounded-control bg-chip p-2" data-pads-panel={padKey}>
                      <span className="text-xs font-semibold text-muted">Thickness (mm) · at or under {limits.pads_bad_max} = Bad · under {limits.pads_good_min} = Average · from {limits.pads_good_min} = Good</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {PAD_MM_CHIPS.map((c) => (
                          <button key={c} type="button" disabled={locked} aria-pressed={(measurements[padKey] ?? "") === c} onClick={() => setPadMm(it, c, true)} className={`min-h-11 min-w-11 rounded-control border px-2 text-sm font-bold ${(measurements[padKey] ?? "") === c ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-pad-chip={c}>{c}</button>
                        ))}
                        <Input value={measurements[padKey] ?? ""} onChange={(e) => setPadMm(it, e.target.value)} inputMode="decimal" disabled={locked} aria-label={`${it.label} thickness in mm`} style={{ width: "5rem" }} className={outOfRange(padKey) ? "border-red-bar" : ""} data-pad-mm={padKey} />
                        <span className="text-xs text-muted">mm</span>
                      </div>
                      <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: `measure.${padKey}` })} where={{ itemKey: `measure.${padKey}` }} disabled={locked} iconOnly label="Photo of the pads" onAdded={addFile({ itemKey: `measure.${padKey}` })} onRemoved={removeFile} />
                    </div>
                  ) : null}
                  {structured && !remarkOpen.has(it.key) ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted">{it.remarks.trim() ? <>Remark: <span className="font-semibold text-ink">{it.remarks}</span></> : "The choices above describe this item; no remark needed."}</span>
                      {!locked ? <button type="button" onClick={() => setRemarkOpen((s) => new Set(s).add(it.key))} className="min-h-8 rounded-control px-2 font-bold underline underline-offset-4">{it.remarks.trim() ? "Edit the remark" : "Add a remark"}</button> : null}
                    </div>
                  ) : null}
                  {remarkShown ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted">Remarks{remarkRequired ? " (required)" : " (optional)"}</span>
                      {(quickRemarks.length || sug.remarks?.length) && !locked ? (
                        <div className="flex flex-wrap gap-1.5">
                          {Array.from(new Set([...quickRemarks, ...(sug.remarks ?? [])])).slice(0, 12).map((r) => (
                            <button key={r} type="button" aria-pressed={it.remarks.includes(r)} onClick={() => patchItem(it.key, { remarks: it.remarks.includes(r) ? it.remarks.split(" · ").filter((x) => x.trim() !== r).join(" · ").trim() : it.remarks.trim() ? `${it.remarks.trim()} · ${r}` : r })} className={`min-h-9 rounded-control border px-2 text-xs font-semibold ${it.remarks.includes(r) ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{it.remarks.includes(r) ? "✓ " : ""}{r}</button>
                          ))}
                        </div>
                      ) : null}
                      <Textarea value={it.remarks} onChange={(e) => patchItem(it.key, { remarks: e.target.value }, false)} rows={2} disabled={locked} textCase="sentence" />
                    </div>
                  ) : null}
                  {dueKeys.has(it.key) && it.status !== "na" ? (
                    <div className="flex flex-wrap items-center gap-2" data-service-due={it.key}>
                      <span className="text-xs font-semibold text-muted">Service due?</span>
                      {[{ v: false, l: "No" }, { v: true, l: "Yes, due" }].map((o) => (
                        <button key={o.l} type="button" disabled={locked} aria-pressed={!!it.service_due === o.v} onClick={() => patchItem(it.key, { service_due: o.v })} className={`min-h-10 rounded-control border px-3 text-sm font-bold ${!!it.service_due === o.v ? (o.v ? "border-ink bg-ink text-white" : "border-green bg-green-soft text-green") : "border-line-strong bg-white"}`} data-service-due-choice={o.v ? "yes" : "no"}>{o.l}</button>
                      ))}
                    </div>
                  ) : null}
                  {gas && needsDetail ? (
                    <div className="flex flex-col gap-2 rounded-control bg-chip p-2" data-ac-panel>
                      <span className="text-xs font-semibold text-muted">Leak?</span>
                      <Chips options={AC_LEAKS} value={it.leak_severity} onPick={(v) => setAc(it, { leak_severity: it.leak_severity === v ? "" : v })} disabled={locked} small />
                      {it.leak_severity && it.leak_severity !== "none" ? (
                        <>
                          <span className="text-xs font-semibold text-muted">Repair</span>
                          <Chips options={AC_REPAIRS} value={it.leak_repair} onPick={(v) => setAc(it, { leak_repair: it.leak_repair === v ? "" : v })} disabled={locked} small />
                        </>
                      ) : null}
                      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!it.recharge_needed} onChange={(e) => setAc(it, { recharge_needed: e.target.checked })} disabled={locked} className="h-5 w-5 accent-ink" data-ac-recharge />Recharge needed</label>
                      <span className="text-xs font-semibold text-muted">Gas</span>
                      <Chips options={AC_GASES.map((g) => ({ value: g, label: g }))} value={it.fluid_grade} onPick={(v) => setAc(it, { fluid_grade: it.fluid_grade === v ? "" : v })} disabled={locked} small />
                      <span className="text-xs font-semibold text-muted">Quantity (grams)</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {AC_GRAM_CHIPS.map((c) => (
                          <button key={c} type="button" disabled={locked} aria-pressed={it.fluid_qty === c} onClick={() => setAc(it, { fluid_qty: it.fluid_qty === c ? "" : c })} className={`min-h-11 min-w-12 rounded-control border px-2 text-sm font-bold ${it.fluid_qty === c ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-ac-grams={c}>{c}</button>
                        ))}
                        <Input value={it.fluid_qty} onChange={(e) => setAc(it, { fluid_qty: e.target.value })} inputMode="numeric" disabled={locked} aria-label="A/C gas in grams" style={{ width: "6rem" }} data-ac-grams-box />
                        <span className="text-xs text-muted">g</span>
                      </div>
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
                  {(it.status === "average" || it.status === "bad") || Number(it.labour_hours) > 0 ? (
                    <div className="flex flex-col gap-1.5" data-labour-hours={it.key}>
                      <span className="text-xs font-semibold text-muted">Labour hours (internal, never shown to the customer)</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {LABOUR_HOUR_CHIPS.map((c) => (
                          <button key={c} type="button" disabled={locked} aria-pressed={it.labour_hours === c} onClick={() => patchItem(it.key, { labour_hours: it.labour_hours === c ? "" : c })} className={`min-h-11 min-w-11 rounded-control border px-2 text-sm font-bold ${it.labour_hours === c ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-hour-chip={c}>{c}</button>
                        ))}
                        <Input value={it.labour_hours} onChange={(e) => patchItem(it.key, { labour_hours: e.target.value }, false)} inputMode="decimal" disabled={locked} aria-label={`${it.label} labour hours`} style={{ width: "5rem" }} data-labour-box />
                        <span className="text-xs text-muted">h</span>
                      </div>
                    </div>
                  ) : null}
                  {needsDetail || partsList.some((e) => e.item_key === it.key) ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-muted">Parts</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {partsList.filter((e) => e.item_key === it.key).map((e) => (
                          <span key={e.id} className="inline-flex items-center gap-1 rounded-control border border-line-strong bg-white px-2 py-1 text-xs font-semibold">
                            {partsListLine(e)}
                            {!locked ? <button type="button" aria-label={`Remove ${e.name}`} onClick={() => removeEntry(e.id)} className="min-h-6 px-1 font-bold text-red">×</button> : null}
                          </span>
                        ))}
                        {!locked ? <button type="button" onClick={() => setPickerFor({ itemKey: it.key, label: it.label })} className="min-h-9 rounded-control border border-dashed border-line-strong px-3 text-xs font-bold">{partsList.some((e) => e.item_key === it.key) ? "+ Add another part" : "+ Parts"}</button> : null}
                      </div>
                    </div>
                  ) : null}
                  {needsDetail || filesFor({ itemKey: it.key }).length ? (
                    <div className="flex flex-wrap items-start gap-3">
                      <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: it.key })} where={{ itemKey: it.key }} disabled={locked} onAdded={addFile({ itemKey: it.key })} onRemoved={removeFile} extra={!locked ? <QuickCodeButton jobId={jobId} target={it.key} label="Photo from my phone" icon /> : null} />
                    </div>
                  ) : null}
                  {it.status === "bad" && !isJob ? (
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex flex-wrap items-center gap-2"><SectionLabel>Tyres (all required)</SectionLabel>{complaintTag("wheels_tyres_and_brakes")}</span>
          <datalist id="tyre-brands">{tyreBrands.filter((b) => b.toLowerCase() !== "other").map((b) => <option key={b} value={b} />)}</datalist>
          <Dot ok={tyresOk} attempted={attempted} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TyreSizeInput
            id="item-m-tyre_size_front"
            label="Tyre size front"
            value={measurements.tyre_size_front ?? ""}
            onChange={(v, complete) => setMeasurement("tyre_size_front", v, complete)}
            disabled={locked}
            suggestion={tyreSizeSuggestion?.front ?? null}
            problem={outOfRange("tyre_size_front") || (attempted && problemKeys.has("m-tyre_size_front"))}
          />
          <TyreSizeInput
            id="item-m-tyre_size_rear"
            label="Tyre size rear"
            value={measurements.tyre_size_rear ?? ""}
            onChange={(v, complete) => setMeasurement("tyre_size_rear", v, complete)}
            disabled={locked}
            sameAs={tyreSizeComplete(measurements.tyre_size_front) ? { label: "Same as front", value: measurements.tyre_size_front } : null}
            suggestion={tyreSizeSuggestion?.rear ?? null}
            problem={outOfRange("tyre_size_rear") || (attempted && problemKeys.has("m-tyre_size_rear"))}
          />
        </div>
        {[...TYRE_POSITIONS, { key: "spare", label: "Spare (optional)" }].map((p) => {
          const cond = (measurements[`tyre_${p.key}_cond`] ?? "").split(",").filter(Boolean);
          const action = measurements[`tyre_${p.key}_action`] ?? "";
          const year = measurements[`tyre_${p.key}_year`] ?? "";
          const age = year === "older" ? limits.tyre_years + 1 : /^\d{4}$/.test(year) ? thisYear - Number(year) : null;
          const danger = measurements[`tyre_${p.key}_danger`] === "1";
          return (
            <div key={p.key} className={`rounded-card border p-3 flex flex-col gap-3 ${danger ? "border-red-bar border-2" : "border-line"}`}>
              <p className="font-semibold flex flex-wrap items-center gap-2">
                {p.label}{danger ? <span className="rounded-control bg-red-bar px-2 py-0.5 text-xs font-extrabold text-white">DANGEROUS</span> : null}
                <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: `tyre.${p.key}` })} where={{ itemKey: `tyre.${p.key}` }} disabled={locked} iconOnly label={`${p.label} tyre: photo`} onAdded={addFile({ itemKey: `tyre.${p.key}` })} onRemoved={removeFile} />
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                    {p.key !== "fl" && measurements.tyre_fl_year && !locked ? <button type="button" onClick={() => { for (const f of ["year", "tread", "brand", "model"]) setMeasurement(`tyre_${p.key}_${f}`, measurements[`tyre_fl_${f}`] ?? "", true); if ((p.key === "rl" || p.key === "rr") && measurements.tyre_size_front) setMeasurement("tyre_size_rear", tyreSizeText(measurements.tyre_size_front ?? ""), true); }} className="min-h-11 rounded-control border border-line-strong bg-white px-2 text-xs font-bold whitespace-nowrap" title="Copies the year, size, brand, model and tread">Same as front left</button> : null}
                  </div>
                  {age !== null && age > limits.tyre_years ? <span className="text-xs font-bold text-red">Older than {limits.tyre_years} years</span> : age !== null && age >= 6 ? <span className="text-xs font-bold text-amber">{age} years old</span> : null}
                </div>
                <label id={`item-m-tyre_${p.key}_brand`} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Brand</span>
                  <Input value={measurements[`tyre_${p.key}_brand`] ?? ""} onChange={(e) => setMeasurement(`tyre_${p.key}_brand`, e.target.value)} onBlur={(e) => setMeasurement(`tyre_${p.key}_brand`, e.target.value.trim(), true)} disabled={locked} placeholder="Michelin" textCase="title" list="tyre-brands" />
                </label>
                <label id={`item-m-tyre_${p.key}_model`} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Model (optional)</span>
                  <Input value={measurements[`tyre_${p.key}_model`] ?? ""} onChange={(e) => setMeasurement(`tyre_${p.key}_model`, e.target.value)} onBlur={(e) => setMeasurement(`tyre_${p.key}_model`, e.target.value.trim(), true)} disabled={locked} placeholder="Pilot Sport 4S" />
                </label>
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
                  {tyreReasonNeeded(measurements, p.key) ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-muted">More than {TYRE_REASON_ABOVE_MM} mm of tread. Why replace now? (one tap, required)</span>
                      <Chips options={TYRE_REPLACE_REASONS} value={measurements[`tyre_${p.key}_reason`] ?? ""} onPick={(v) => setMeasurement(`tyre_${p.key}_reason`, v, true)} disabled={locked} small />
                    </div>
                  ) : null}
                  <button type="button" disabled={locked} onClick={() => setMeasurement(`tyre_${p.key}_danger`, danger ? "" : "1", true)} aria-pressed={danger} className={`self-start ${tyreBtn(danger, true)}`}>{danger ? "DANGEROUS TO DRIVE: ON" : "Dangerous to drive?"}</button>
                  {danger ? <Input value={measurements[`tyre_${p.key}_danger_reason`] ?? ""} onChange={(e) => setMeasurement(`tyre_${p.key}_danger_reason`, e.target.value)} disabled={locked} placeholder="Why it is dangerous (required)" className={!(measurements[`tyre_${p.key}_danger_reason`] ?? "").trim() ? "border-red-bar" : ""} /> : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <p className="text-xs text-muted">Replace now goes on the report as needing attention; Replace soon as recommended.</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Numbers (all required)</SectionLabel>
          <Dot ok={numbersOk} attempted={attempted} />
        </div>
        {["Brake pads", "Battery test", "Air conditioning"].filter((g) => !(g === "Brake pads" && items.some((i) => isPadItem(i.label) && /front|rear/i.test(i.label)))).map((g) => (
          <div key={g} className="flex flex-col gap-2" id={g === "Battery test" ? "item-measure-battery" : undefined}>
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{g}</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MEASUREMENTS.filter((m) => m.group === g).map((m) => (
                <div key={m.key} className="flex flex-col gap-1">
                <label id={`item-m-${m.key}`} className="flex flex-col gap-1">
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
                {m.key === "vent_temp" ? <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: "measure.vent" })} where={{ itemKey: "measure.vent" }} disabled={locked} iconOnly label="Thermometer reading: photo" onAdded={addFile({ itemKey: "measure.vent" })} onRemoved={removeFile} /> : null}
                </div>
              ))}
            </div>
            {g === "Battery test" ? (
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Photo of the tester&apos;s printout</span>
                  <InspectionMedia inspectionId={inspectionId} files={filesFor({ itemKey: "measure.battery" })} where={{ itemKey: "measure.battery" }} disabled={locked} onAdded={addFile({ itemKey: "measure.battery" })} onRemoved={removeFile} />
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
            <InspectionMedia inspectionId={inspectionId} files={prescanFiles} where={{ isPrescan: true }} accept="pdf" disabled={disabled && !canAddPrescan} onAdded={addFile({ isPrescan: true })} onRemoved={removeFile} />
            {showPrescanToggle ? <PrescanToggle inspectionId={inspectionId} initial={prescanVisible} /> : null}
          </Card>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6 items-start">
      <Card className="flex flex-col gap-3" id="item-parts-list">
        <SectionLabel right={mergedParts.length ? `${mergedParts.length} line${mergedParts.length === 1 ? "" : "s"}` : "none yet"}>Parts list</SectionLabel>
        <p className="text-xs text-muted">Everything picked above, one line per part. Check it before you submit: the workshop manager confirms it, then Parts price it. Tyres and the battery follow their answers.</p>
        {mergedParts.length ? (
          <ul className="divide-y divide-line">
            {mergedParts.map((line) => {
              const auto = line.entries.every((e) => e.source === "tyre" || e.source === "measure");
              const first = line.entries.find((e) => e.source === "item" || e.source === "custom") ?? line.entries[0];
              return (
                <li key={line.key} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{line.name}</span>
                  {line.positions.length ? <span className="text-muted">{positionsWords(line.positions)}</span> : null}
                  <span className="text-xs text-muted">· {fromLabel(line)}</span>
                  {dupPositions(line).length ? <span className="text-[11px] font-semibold text-amber">Appears twice for {dupPositions(line).join(", ")}: check the quantity</span> : null}
                  <span className="ml-auto inline-flex items-center rounded-control border border-line-strong bg-white">
                    <button type="button" disabled={locked || auto} aria-label={`One less ${line.name}`} onClick={() => setList(partsRef.current.map((e) => (e.id === first.id ? { ...e, qty: Math.max(1, e.qty - 1) } : e)))} className="min-h-10 w-10 text-lg font-bold disabled:text-faint">−</button>
                    <span className="w-8 text-center text-sm font-bold">{line.qty}</span>
                    <button type="button" disabled={locked || auto} aria-label={`One more ${line.name}`} onClick={() => setList(partsRef.current.map((e) => (e.id === first.id ? { ...e, qty: e.qty + 1 } : e)))} className="min-h-10 w-10 text-lg font-bold disabled:text-faint">+</button>
                  </span>
                  {!locked && !auto ? <button type="button" onClick={() => renameLine(line)} className="min-h-10 rounded-control border border-line px-2 text-xs font-bold">Rename</button> : null}
                  {!locked && !auto ? <button type="button" onClick={() => splitLine(line)} className="min-h-10 rounded-control border border-line px-2 text-xs font-bold">Split</button> : null}
                  {!locked && !auto ? <button type="button" aria-label={`Remove ${line.name}`} onClick={() => setList(partsRef.current.filter((e) => !(e.name.toLowerCase() === line.key && (e.source === "item" || e.source === "custom"))))} className="min-h-10 w-10 rounded-control border border-line text-sm font-bold text-red">×</button> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {(() => {
          // Parts that go with one on the list (a wear sensor with brake pads): offered, never added by themselves.
          const offers = locked ? [] : goesWithOffers(partsList, catalogue);
          return offers.length ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-control bg-chip p-2 text-xs" data-goes-with>
              <span className="font-semibold">Goes with:</span>
              {offers.map((o) => (
                <button key={o.key} type="button" onClick={() => setList([...partsRef.current, offerEntry(o)])} className="min-h-9 rounded-control border border-line-strong bg-white px-2.5 font-bold">+ Add {o.label.charAt(0).toLowerCase()}{o.label.slice(1)}?</button>
              ))}
              <span className="text-muted">Offered only; nothing is added by itself.</span>
            </div>
          ) : null;
        })()}
        {!locked ? <button type="button" onClick={() => setPickerFor({ itemKey: null, label: "" })} className="self-start min-h-11 rounded-control border border-dashed border-line-strong px-4 text-sm font-bold">+ Add a part</button> : null}
        {partsListFooter}
      </Card>
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel right={`${items.filter((i) => i.status === "bad" && i.style !== "job").length}`}>Marked Bad</SectionLabel>
          <button type="button" onClick={() => setShowAverage((s) => !s)} aria-pressed={showAverage} className={`min-h-8 rounded-control border px-2 text-xs font-semibold ${showAverage ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{showAverage ? "✓ " : ""}Show Average</button>
        </div>
        {items.filter((i) => i.style !== "job" && (i.status === "bad" || (showAverage && i.status === "average"))).length === 0 ? (
          <p className="text-xs text-muted">Nothing marked Bad{showAverage ? " or Average" : ""} yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.filter((i) => i.style !== "job" && (i.status === "bad" || (showAverage && i.status === "average"))).map((i) => {
              const has = partsList.some((e) => e.item_key === i.key);
              const none = noPartItems.includes(i.key);
              return (
                <li key={i.key} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1 min-w-[10rem]">
                    <span className="font-semibold">{i.label}</span>
                    {i.status === "average" ? <span className="ml-1 text-xs text-muted">Average</span> : null}
                    {i.remarks ? <span className="block text-xs text-muted truncate">{i.remarks}</span> : null}
                  </span>
                  {has ? (
                    <span className="inline-flex items-center gap-1 rounded-control border border-green bg-green-soft px-2 py-1 text-xs font-bold text-green">✓ Part listed</span>
                  ) : none ? (
                    <button type="button" disabled={locked} onClick={() => toggleNoPart(i.key)} className="min-h-9 rounded-control border border-line-strong bg-white px-2 text-xs font-semibold text-muted">No part needed · undo</button>
                  ) : (
                    <>
                      <span className="rounded-control bg-amber-soft px-2 py-1 text-xs font-bold text-amber">No part listed</span>
                      {!locked ? <button type="button" onClick={() => setPickerFor({ itemKey: i.key, label: i.label })} className="min-h-9 rounded-control border border-dashed border-line-strong px-2 text-xs font-bold">+ Add part</button> : null}
                      {!locked ? <button type="button" onClick={() => toggleNoPart(i.key)} className="min-h-9 rounded-control px-2 text-xs font-semibold text-muted underline underline-offset-4">No part needed</button> : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      </div>

      <Card className="flex flex-col gap-3" id="item-estimate">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Big job? Estimated hours</SectionLabel>
          {submitAction ? <Dot ok={!problemKeys.has("estimate")} attempted={attempted} /> : null}
        </div>
        <p className="text-sm text-muted">Mention anything big before you submit: tap the tags that apply.</p>
        {bigJobTags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {bigJobTags.map((t) => (
              <button key={t} type="button" disabled={locked} onClick={() => toggleTag(t)} aria-pressed={tags.includes(t)} className={`min-h-11 rounded-control border-2 px-3 text-sm font-bold ${tags.includes(t) ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{tags.includes(t) ? "✓ " : ""}{t}</button>
            ))}
          </div>
        ) : null}
        {(() => {
          const withHours = items.filter((i) => Number(i.labour_hours) > 0);
          if (!withHours.length) return null;
          const total = Math.round(withHours.reduce((a, i) => a + (Number(i.labour_hours) || 0), 0) * 100) / 100;
          return (
            <div className="flex flex-col gap-1 rounded-control bg-chip p-3" data-labour-total>
              <span className="text-sm font-extrabold">Total labour: {total} h</span>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">{withHours.map((i) => <span key={i.key}>{i.label}: {i.labour_hours} h</span>)}</div>
              {!locked && estimate !== String(total) ? <button type="button" onClick={() => { setEstimate(String(total)); debounced("estimate", () => ({ inspection: { estimated_hours: String(total) } })); }} className="self-start min-h-9 px-2 text-xs font-bold underline underline-offset-4" data-use-total>Use {total} h as the estimate</button> : null}
            </div>
          );
        })()}
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

      {requests.length ? (
        <Card className="flex flex-col gap-2" id="item-requests-note">
          <SectionLabel right="optional">Anything to tell the advisor about the customer&apos;s requests?</SectionLabel>
          <Textarea value={requestsNote} onChange={(e) => setRequestsNoteText(e.target.value)} rows={2} disabled={locked} textCase="sentence" placeholder="For example: the noise the customer heard comes from the front left wheel bearing." />
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <SectionLabel>Technician&apos;s notes</SectionLabel>
        <Textarea value={notes} onChange={(e) => setNotesText(e.target.value)} rows={4} disabled={locked} placeholder="Anything the workshop manager and advisor should know." />
      </Card>

      {body ? (
        <BodyshopFindings
          inspectionId={inspectionId}
          initial={body.initial}
          canEdit={body.canEdit}
          canCheck={body.canCheck}
          photos={(panel) => {
            const where = { itemKey: `body.${panel}` };
            return { count: filesFor(where).length, node: <InspectionMedia inspectionId={inspectionId} files={filesFor(where)} where={where} disabled={!body.canEdit} onAdded={addFile(where)} onRemoved={removeFile} /> };
          }}
          parts={(panel) => (
            <div className="flex flex-wrap items-center gap-1.5" data-body-parts={panel}>
              {partsList.filter((e) => e.item_key === `body.${panel}`).map((e) => (
                <span key={e.id} className="inline-flex items-center gap-1 rounded-control border border-line-strong bg-white px-2 py-1 text-xs font-semibold">
                  {partsListLine(e)}
                  {body.canEdit ? <button type="button" aria-label={`Remove ${e.name}`} onClick={() => removeEntry(e.id)} className="min-h-6 px-1 font-bold text-red">×</button> : null}
                </span>
              ))}
              {body.canEdit ? <button type="button" onClick={() => setPickerFor({ itemKey: `body.${panel}`, label: panelLabel(panel) })} className="min-h-9 rounded-control border border-dashed border-line-strong px-3 text-xs font-bold" data-body-add-part>+ Parts</button> : null}
            </div>
          )}
        />
      ) : null}
      {pickerFor ? (
        <PartPicker
          title={pickerFor.itemKey ? `Parts · ${pickerFor.label}` : "Add a part"}
          catalogue={catalogue}
          selected={partsList.filter((e) => (e.item_key ?? null) === pickerFor.itemKey && (e.source === "item" || e.source === "custom"))}
          suggested={pickerFor.itemKey ? suggestCatalogue(pickerFor.label, catalogue, suggestions[pickerFor.itemKey]?.parts ?? []) : []}
          itemKey={pickerFor.itemKey}
          source={pickerFor.itemKey ? "item" : "custom"}
          onDone={(entries) => commitParts(pickerFor.itemKey, entries)}
          onClose={() => setPickerFor(null)}
        />
      ) : null}

      {!disabled ? (
        <>
          {state !== "saved" ? (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 rounded-full bg-ink/85 px-3 py-1 text-[11px] font-bold text-white pointer-events-none">
              {state === "saving" ? "Saving…" : "No connection · changes kept, will save"}
            </div>
          ) : null}
          {submitAction ? (
            <ActionForm action={submitAction} className="hidden">
              {(_v, s) => <><button type="submit" id="inspection-submit" /><SubmitOutcome error={s.error ?? null} onError={(e) => { setSubmitting(false); setSubmitError(e); }} /></>}
            </ActionForm>
          ) : null}
          <ProblemsBar
            problems={problems}
            attempted={attempted}
            progress={progress}
            onJump={jumpTo}
            submitLabel={submitLabel}
            submitting={submitting}
            error={submitError}
            onSubmit={
              submitAction
                ? () => {
                    if (problems.length) {
                      setAttempted(true);
                      jumpTo(problems[0].key);
                      return;
                    }
                    if (submitting) return;
                    setSubmitting(true);
                    setSubmitError(null);
                    // Everything typed so far is saved first, so the server checks the same report the screen shows.
                    void flush().finally(() => (document.getElementById("inspection-submit") as HTMLButtonElement | null)?.click());
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
