"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ServicePicker } from "@/components/ServicePicker";
import { Badge, Button, Card, Input, Notice, SectionLabel, Select, Textarea } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import { AVAILABILITY_LABELS, aed, blockOf, floorPrice, hasCostFloor, hoursText, isHidden, isUnchosen, lineCost, lineTotal, lineUnitPrice, ownerApprovalReasons, partTypeText, quoteTotals, sendBlockers, type PartItem, type QuoteLine, type QuoteRow, type Service, type ServiceCategory } from "@/lib/quotes";
import type { WorkingTime } from "@/lib/working-time";
import { completeQuotation, escalateParts, keepUrgentOnly, remindParts, reopenQuotation } from "@/app/(app)/quotes/actions";
import { SendQuoteControl } from "./SendQuoteControl";

type Op = Record<string, unknown>;

/** A finding of the approved report: the heading of a group of labour lines. Same shape as the server's QuoteFinding. */
export type EditorFinding = { key: string; source_type: "request" | "item" | "tyre"; source_key: string; status: "bad" | "average"; label: string; section: string | null; remark: string | null; parts: string | null; photos: string[]; dangerous: boolean };

/** Every change goes to the server at once, through a queue kept in the browser so nothing typed is lost. A 409 asks the person to confirm first. */
function useQuoteAutosave(quotationId: string, onSaved: () => void, onConfirm: (op: Op, message: string) => void) {
  const key = `erp-quote-queue-${quotationId}`;
  const queue = useRef<Op[]>([]);
  const busy = useRef(false);
  const [state, setState] = useState<"saved" | "saving" | "offline">("saved");
  const [error, setError] = useState<string | null>(null);
  const persist = useCallback(() => {
    try {
      if (queue.current.length) localStorage.setItem(key, JSON.stringify(queue.current));
      else localStorage.removeItem(key);
    } catch {}
  }, [key]);
  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    let changed = false;
    while (queue.current.length) {
      const op = queue.current[0];
      setState("saving");
      try {
        const res = await fetch("/api/quote/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotationId, ...op }) });
        const data = (await res.json()) as { ok?: boolean; error?: string; confirm?: boolean };
        if (res.status === 409 && data.confirm) {
          queue.current.shift();
          persist();
          onConfirm(op, data.error ?? "Confirm?");
          continue;
        }
        if (!res.ok) {
          queue.current.shift();
          persist();
          setError(data.error ?? "Could not save.");
          changed = true;
          continue;
        }
        if (!data.ok) throw new Error(data.error ?? "Could not save.");
        queue.current.shift();
        persist();
        setError(null);
        changed = true;
      } catch {
        setState("offline");
        busy.current = false;
        return;
      }
    }
    setState("saved");
    busy.current = false;
    if (changed) onSaved();
  }, [quotationId, persist, onSaved, onConfirm]);
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
      const pending = JSON.parse(localStorage.getItem(key) ?? "[]") as Op[];
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
  }, [key, flush]);
  return { save, state, error };
}

export type EditorSettings = {
  labourRate: number;
  minMarkup: number;
  markupWarn: number;
  markupConfirm: number;
  discountLimit: number;
  approvalAbove: number;
  technicianCostRate: number | null;
  bankChargePercent: number;
  depositThreshold: number;
  depositPercent: number;
  inspectionFee: number;
  today: string;
  workingTime: WorkingTime;
};

/** What the advisor is waiting for from Parts, for the status bar and the Remind and Escalate buttons. */
export type PartsWait = { openRequests: number; partsTotal: number; partsPriced: number; waitingMinutes: number; partsNames: string; remindAfter: number; escalateAfter: number; remindedAt: string | null; escalatedAt: string | null };

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const TRIPS = [
  { value: "1", label: "One way to the workshop", trips: 1 },
  { value: "1b", label: "One way to the customer", trips: 1 },
  { value: "2", label: "Two ways", trips: 2 },
];
const POSITIONS = ["Front", "Rear", "Front and rear", "Left", "Right"];
const finishedLine = (l: QuoteLine) => (l.line_type === "labour" ? !!l.title.trim() && (l.hours ?? 0) > 0 : l.line_type === "package" ? !!l.title.trim() && (l.unit_price ?? 0) > 0 : !!l.title.trim());
const stripPosition = (t: string) => t.replace(/,\s*(front and rear|front|rear|left|right)$/i, "");

/**
 * The quotation in three blocks on one page: labour and services grouped by inspection finding,
 * the parts filled in by Parts (the advisor sets only the markup and picks which job each part
 * belongs to), and the other charges. One summary. "Quotation complete" comes before Send.
 */
export function QuoteEditor({
  quotation,
  lines: initialLines,
  parts,
  findings = [],
  categories,
  services,
  usage,
  department,
  settings,
  readOnly,
  isOwner,
  showProfit,
  canSend,
  siteUrl,
  messageTemplate,
  phoneDigits,
  fromEstimate,
  labourJobs = {},
  candidates = [],
  labourActions = [],
  labourPositions = [],
  components = [],
  hoursMemory = {},
  recoveryProviders = [],
  wait = null,
  workshopEstimate = null,
  completedAt = null,
  estimatedDays = 0,
  isRevision = false,
}: {
  quotation: QuoteRow;
  lines: QuoteLine[];
  parts: PartItem[];
  findings?: EditorFinding[];
  categories: ServiceCategory[];
  services: Service[];
  usage: Record<string, number>;
  department: string | null;
  settings: EditorSettings;
  readOnly: boolean;
  isOwner: boolean;
  showProfit: boolean;
  canSend: boolean;
  siteUrl: string;
  messageTemplate: string;
  phoneDigits: string;
  fromEstimate: boolean;
  labourJobs?: Record<string, string[]>;
  candidates?: string[];
  labourActions?: string[];
  labourPositions?: string[];
  components?: string[];
  hoursMemory?: Record<string, number>;
  recoveryProviders?: string[];
  wait?: PartsWait | null;
  workshopEstimate?: { hours: number | null; managerHours: number | null; agreed: boolean } | null;
  completedAt?: string | null;
  estimatedDays?: number;
  isRevision?: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<QuoteLine[]>(initialLines);
  const [notQuoted, setNotQuoted] = useState<Record<string, string>>(quotation.not_quoted ?? {});
  const [header, setHeader] = useState({ discount_percent: quotation.discount_percent, customer_note: quotation.customer_note ?? "" });
  const [attempted, setAttempted] = useState(false);
  const [picker, setPicker] = useState<null | { source?: EditorFinding }>(null);
  const [partAsk, setPartAsk] = useState<null | { description: string; quantity: string; source?: EditorFinding }>(null);
  const [builderFor, setBuilderFor] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set(initialLines.filter((l) => blockOf(l) === "labour" && !finishedLine(l)).map((l) => l.id)));
  const [openFindings, setOpenFindings] = useState<Set<string>>(new Set());
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | { op: Op; message: string }>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refresh = useCallback(() => router.refresh(), [router]);
  const onConfirm = useCallback((op: Op, message: string) => setConfirming({ op, message }), [setConfirming]);
  const { save, state, error } = useQuoteAutosave(quotation.id, refresh, onConfirm);
  const disabled = readOnly;
  const isQuotation = quotation.kind === "quotation";

  // Lines changed elsewhere (Parts pricing a part, a refused save) arrive on refresh; local edits of known lines are kept.
  const [seenLines, setSeenLines] = useState(initialLines);
  if (seenLines !== initialLines) {
    setSeenLines(initialLines);
    setLines((cur) => {
      const known = new Map(cur.map((l) => [l.id, l]));
      return initialLines.map((l) => {
        const k = known.get(l.id);
        return k ? { ...l, ...k, unit_cost: l.part_item_id ? l.unit_cost : k.unit_cost, quantity: l.part_item_id ? l.quantity : k.quantity, discount_percent: l.discount_percent, markup_percent: l.markup_percent, markup_confirmed: l.markup_confirmed, hours: l.hours, chosen: l.chosen, parent_line_id: l.parent_line_id, dangerous: l.dangerous, title: l.part_item_id ? l.title : k.title } : l;
      });
    });
    setNotQuoted(quotation.not_quoted ?? {});
  }

  const debounced = (key: string, op: () => Op) => {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => save(op()), 500);
  };
  const patch = (id: string, fields: Partial<QuoteLine>, immediate = false) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)));
    const op = () => ({ patchLine: { id, ...fields } });
    if (immediate) save(op());
    else debounced(`line-${id}-${Object.keys(fields).join(",")}`, op);
  };
  const addLine = (fields: Partial<QuoteLine> & { service_id?: string | null }) => save({ addLine: fields });
  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id && l.parent_line_id !== id));
    save({ removeLine: { id } });
  };
  const setHeaderField = (fields: Partial<typeof header>, immediate = false) => {
    setHeader((h) => ({ ...h, ...fields }));
    const op = () => ({ header: fields });
    if (immediate) save(op());
    else debounced("header-" + Object.keys(fields).join(","), op);
  };
  const choose = (groupId: string, lineId: string) => {
    setLines((prev) => prev.map((l) => (l.option_group === groupId ? { ...l, chosen: l.id === lineId } : l)));
    save({ patchLine: { id: lineId, chosen: true } });
  };
  const markNotQuoted = (key: string, reason: string | null) => {
    setNotQuoted((m) => {
      const next = { ...m };
      if (reason === null) delete next[key];
      else next[key] = reason;
      return next;
    });
    save({ notQuoted: { key, reason } });
    setReasonFor(null);
  };
  const toggleKey = (id: string) => setOpenRows((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>) =>
    start(async () => {
      setActionError(null);
      const res = await fn();
      if (res.error) setActionError(res.error);
      router.refresh();
    });

  const q = { ...quotation, ...header };
  const totals = quoteTotals(lines, q, { technicianCostRate: settings.technicianCostRate ?? 0, depositThreshold: settings.depositThreshold, depositPercent: settings.depositPercent, bankChargePercent: settings.bankChargePercent });
  const labourLines = lines.filter((l) => l.is_active && blockOf(l) === "labour");
  const partLines = lines.filter((l) => l.is_active && blockOf(l) === "parts");
  const otherLines = lines.filter((l) => l.is_active && blockOf(l) === "other");
  const feeLine = otherLines.find((l) => l.fee_kind === "bank_charge") ?? null;
  const findingOf = (l: QuoteLine) => findings.find((f) => f.source_type === l.source_type && f.source_key === l.source_key) ?? null;
  const linesOf = (f: EditorFinding) => labourLines.filter((l) => l.source_type === f.source_type && l.source_key === f.source_key);
  const looseLabour = labourLines.filter((l) => !findingOf(l));
  const unquoted = isQuotation ? findings.filter((f) => linesOf(f).length === 0 && !notQuoted[f.key]) : [];
  const labourDone = labourLines.filter(finishedLine).length;
  const blockers = sendBlockers(q, lines, parts, { minMarkup: settings.minMarkup, openRequests: wait?.openRequests ?? 0, workshopEstimate, unquotedFindings: unquoted.length, confirmPercent: settings.markupConfirm });
  const reasons = ownerApprovalReasons(q, lines, totals, { discountLimit: settings.discountLimit, approvalAbove: settings.approvalAbove });
  const partOf = (l: QuoteLine) => (l.part_item_id ? parts.find((p) => p.id === l.part_item_id) ?? null : null);
  const sent = !!quotation.sent_at || ["sent", "opened", "approved", "urgent_requested", "declined", "expired", "superseded"].includes(quotation.status);
  const completed = !!completedAt;
  const lineName = (l: QuoteLine) => l.title.trim() || findingOf(l)?.label || "Line without a description";
  const parentName = (l: QuoteLine) => {
    const p = l.parent_line_id ? lines.find((x) => x.id === l.parent_line_id && x.is_active) : null;
    return p ? lineName(p) : null;
  };
  const highMarkups = partLines.filter((l) => !isUnchosen(l) && (l.markup_percent ?? 0) >= settings.markupWarn);
  const jobList = useMemo(() => Object.entries(labourJobs).flatMap(([group, items]) => items.map((t) => ({ group, title: t }))), [labourJobs]);
  const allJobs = useMemo(() => [...candidates.map((t) => ({ group: "Used before", title: t })), ...jobList], [candidates, jobList]);
  const canKeepUrgent = isRevision && !sent && !disabled && labourLines.some((l) => l.urgency === "urgent") && labourLines.some((l) => l.urgency !== "urgent");

  const pick = (s: Service) => {
    const src = picker?.source;
    setPicker(null);
    addLine({ service_id: s.id, source_type: src?.source_type ?? null, source_key: src?.source_key ?? null, group_label: src?.label ?? null });
  };
  const applyTitle = (id: string, title: string) => {
    const remembered = hoursMemory[title.toLowerCase()];
    patch(id, remembered ? { title, hours: remembered } : { title }, true);
    setBuilderFor(null);
  };
  const hoursBlur = (l: QuoteLine, raw: string) => {
    const v = raw.replace(",", ".");
    if (v === "") return;
    const h = Math.max(0.1, Math.round(Number(v) * 10) / 10);
    patch(l.id, { hours: h }, true);
    if (l.title.trim() && h > 0) setOpenRows((s) => { const n = new Set(s); n.delete(l.id); return n; });
  };

  /* ----- one labour row: thin like a spreadsheet; collapsed with a tick when finished ----- */
  const labourRow = (l: QuoteLine) => {
    const open = openRows.has(l.id);
    const done = finishedLine(l);
    const total = lineTotal(l);
    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
    if (!open && done) {
      return (
        <div key={l.id} id={`item-line-${l.id}`} className={`flex items-center gap-2 py-1.5 px-2 text-sm ${blocked ? "bg-red-soft" : ""}`}>
          <button type="button" onClick={() => toggleKey(l.id)} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green text-white text-xs font-bold" aria-label="Open this line">✓</button>
          <button type="button" onClick={() => toggleKey(l.id)} className="flex-1 min-w-0 text-left font-semibold truncate">{l.title}</button>
          {l.dangerous ? <Badge tone="red">Dangerous</Badge> : l.urgency === "urgent" ? <Badge tone="outline">Urgent</Badge> : null}
          <span className="w-16 text-right text-muted">{l.line_type === "labour" ? hoursText(l.hours) : `× ${l.quantity}`}</span>
          <span className="w-14 text-right text-muted hidden sm:inline">{l.line_type === "labour" ? num(l.labour_rate) : ""}</span>
          <span className="w-28 text-right font-bold">{aed(total)}</span>
        </div>
      );
    }
    const needsTitle = !l.title.trim() && l.line_type === "labour";
    const detailsOpen = openRows.has(`details-${l.id}`);
    const discOpen = openRows.has(`disc-${l.id}`);
    return (
      <div key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-1.5 py-2 px-2 border-l-4 ${blocked ? "border-red-bar bg-red-soft" : done ? "border-green" : "border-amber-bar"}`}>
        <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_4.5rem_4.5rem_7rem_auto] gap-2 items-center">
          {needsTitle && !disabled ? (
            <JobPicker jobs={allJobs} onPick={(t) => applyTitle(l.id, t)} onBuild={() => setBuilderFor(l.id)} />
          ) : (
            <Input value={l.title} onChange={(e) => patch(l.id, { title: e.target.value })} disabled={disabled} className="font-semibold min-h-10" placeholder="What are we doing?" aria-label="Description" />
          )}
          {l.line_type === "labour" ? (
            <>
              <Input value={num(l.hours)} onChange={(e) => patch(l.id, { hours: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} onBlur={(e) => hoursBlur(l, e.target.value)} inputMode="decimal" disabled={disabled} placeholder="h" aria-label="Hours" className="text-right min-h-10" />
              <Input value={num(l.labour_rate)} onChange={(e) => patch(l.id, { labour_rate: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} aria-label="Rate per hour" className={`text-right min-h-10 hidden sm:block ${(l.labour_rate ?? 0) + 0.005 < settings.labourRate ? "border-red-bar" : ""}`} />
            </>
          ) : (
            <>
              <Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled} aria-label="Quantity" className="text-right min-h-10" />
              <Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} aria-label="Price" className="text-right min-h-10 hidden sm:block" />
            </>
          )}
          <span className="text-right font-bold hidden sm:block">{aed(total)}</span>
          {!disabled ? <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 rounded-control px-2 text-xs font-bold text-red" aria-label="Remove line">×</button> : null}
        </div>
        {builderFor === l.id ? <LabourBuilder actions={labourActions} positions={labourPositions} components={components} onUse={(t) => applyTitle(l.id, t)} onClose={() => setBuilderFor(null)} /> : null}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!disabled && l.title.trim() && l.line_type === "labour" ? <button type="button" onClick={() => patch(l.id, { title: "" }, true)} className="font-semibold underline underline-offset-4 text-muted">Pick another job</button> : null}
          {l.line_type === "labour" && !disabled && l.title.trim() ? (
            <span className="flex gap-1">
              {POSITIONS.map((p) => (
                <button key={p} type="button" onClick={() => patch(l.id, { title: `${stripPosition(l.title)}, ${p.toLowerCase()}` }, true)} className="min-h-7 rounded-control border border-line px-1.5 font-semibold">{p}</button>
              ))}
            </span>
          ) : null}
          {isQuotation && !isHidden(l) ? (
            l.dangerous ? (
              <span className="inline-flex items-center gap-1 text-red font-bold">Dangerous: safety warning shown to the customer{isOwner && !disabled ? <button type="button" onClick={() => patch(l.id, { dangerous: false, urgency: "urgent" }, true)} className="underline underline-offset-4 font-semibold text-muted">owner: switch off</button> : null}</span>
            ) : (
              <button type="button" disabled={disabled} onClick={() => patch(l.id, { urgency: l.urgency === "urgent" ? null : "urgent" }, true)} aria-pressed={l.urgency === "urgent"} className={`min-h-7 rounded-control border px-2 font-bold ${l.urgency === "urgent" ? "border-red-bar bg-red-bar text-white" : "border-line text-muted"}`}>Urgent</button>
            )
          ) : null}
          <button type="button" onClick={() => toggleKey(`details-${l.id}`)} className="font-semibold underline underline-offset-4 text-muted">{l.details ? "Details shown to the customer" : "Add details for the customer"}</button>
          {isOwner && !disabled ? <button type="button" onClick={() => toggleKey(`disc-${l.id}`)} className="font-semibold underline underline-offset-4 text-muted">Owner discount{(l.discount_percent ?? 0) > 0 ? ` ${l.discount_percent}%` : ""}</button> : (l.discount_percent ?? 0) > 0 ? <span className="text-muted">Discount {l.discount_percent}%</span> : null}
          {done && !disabled ? <button type="button" onClick={() => toggleKey(l.id)} className="ml-auto font-semibold underline underline-offset-4 text-green">Done, collapse</button> : null}
          <span className="sm:hidden ml-auto font-bold text-ink">{aed(total)}</span>
        </div>
        {detailsOpen ? <Textarea value={l.details ?? ""} onChange={(e) => patch(l.id, { details: e.target.value })} rows={2} disabled={disabled} placeholder="Shown to the customer under the line (optional)" /> : null}
        {discOpen ? <label className="flex items-center gap-2 text-xs"><span className="font-semibold text-muted">Discount %</span><Input value={num(l.discount_percent)} onChange={(e) => patch(l.id, { discount_percent: Number(e.target.value) || 0 })} inputMode="decimal" className="w-20 text-right min-h-9" /></label> : null}
        {(l.labour_rate ?? 0) + 0.005 < settings.labourRate && l.line_type === "labour" ? <span className="text-xs font-semibold text-red">Rate below the standard AED {settings.labourRate}.</span> : null}
      </div>
    );
  };

  const findingBlock = (f: EditorFinding) => {
    const ls = linesOf(f);
    const skipped = notQuoted[f.key];
    const open = openFindings.has(f.key);
    const state: "quoted" | "unquoted" | "skipped" = ls.length ? "quoted" : skipped ? "skipped" : "unquoted";
    return (
      <div key={f.key} id={`item-finding-${f.key}`} className={`rounded-control border ${state === "unquoted" ? "border-amber-bar" : "border-line"}`}>
        <div className="flex flex-wrap items-center gap-2 bg-chip px-2 py-1.5 text-xs">
          <Badge tone={f.status === "bad" ? "red" : "amber"}>{f.status === "bad" ? "BAD" : "AVG"}</Badge>
          <button type="button" onClick={() => setOpenFindings((s) => { const n = new Set(s); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })} className="flex-1 min-w-0 text-left">
            <span className="font-bold">{f.label}</span>
            {f.remark ? <span className="text-muted"> · {open ? f.remark : f.remark.length > 70 ? f.remark.slice(0, 68) + "…" : f.remark}</span> : null}
            {f.parts ? <span className="text-muted"> · Parts: {f.parts}</span> : null}
            {f.dangerous ? <span className="font-bold text-red"> · DANGEROUS</span> : null}
          </button>
          {state === "unquoted" ? <span className="font-extrabold text-amber">NOT QUOTED</span> : state === "skipped" ? <span className="text-muted">Not quoting: {skipped}{!disabled ? <button type="button" onClick={() => markNotQuoted(f.key, null)} className="ml-1 underline underline-offset-4 font-semibold">undo</button> : null}</span> : <span className="text-muted">{ls.length} line{ls.length === 1 ? "" : "s"}</span>}
        </div>
        {open && f.photos.length ? (
          <div className="flex flex-wrap gap-2 px-2 py-2">
            {f.photos.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Photo" className="h-20 w-20 rounded-control object-cover bg-chip" /></a>
            ))}
          </div>
        ) : null}
        <div className="divide-y divide-line">{ls.map(labourRow)}</div>
        {!disabled && state !== "skipped" ? (
          <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
            <button type="button" onClick={() => addLine({ line_type: "labour", title: "", source_type: f.source_type, source_key: f.source_key, group_label: f.label })} className="min-h-8 rounded-control border border-line-strong bg-white px-2 text-xs font-bold">+ Add labour</button>
            <button type="button" onClick={() => setPicker({ source: f })} className="min-h-8 rounded-control border border-line px-2 text-xs font-semibold">Add service</button>
            <button type="button" onClick={() => setPartAsk({ description: "", quantity: "1", source: f })} className="min-h-8 rounded-control border border-line px-2 text-xs font-semibold">Ask Parts for a part</button>
            {state === "unquoted" ? (reasonFor === f.key ? (
              <span className="flex items-center gap-1">
                <Input placeholder="Why not?" className="w-48 min-h-8" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); markNotQuoted(f.key, (e.target as HTMLInputElement).value); } }} id={`reason-${f.key}`} />
                <button type="button" onClick={() => markNotQuoted(f.key, (document.getElementById(`reason-${f.key}`) as HTMLInputElement | null)?.value ?? "")} className="min-h-8 rounded-control bg-ink px-2 text-xs font-bold text-white">Save</button>
              </span>
            ) : <button type="button" onClick={() => setReasonFor(f.key)} className="min-h-8 rounded-control px-2 text-xs font-semibold text-muted underline underline-offset-4">Not quoting this</button>) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const showHide = (l: QuoteLine, hidden: boolean) => (
    <button type="button" disabled={disabled} onClick={() => patch(l.id, { visible_to_customer: hidden }, true)} className={`min-h-9 rounded-control border px-2 text-xs font-bold ${hidden ? "border-line text-muted" : "border-ink bg-ink text-white"}`}>{hidden ? "Internal cost" : "Shown to customer"}</button>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pb-24">
      <div className="xl:col-span-2 flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {actionError ? <Notice tone="error">{actionError}</Notice> : null}

        {/* Block 1: labour and services, grouped by finding */}
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel right={`${labourDone} of ${labourLines.length} lines done${unquoted.length ? ` · ${unquoted.length} finding${unquoted.length === 1 ? "" : "s"} not quoted` : ""}`}>Labour and services</SectionLabel>
            <span className="flex gap-1 text-xs">
              <button type="button" onClick={() => setOpenRows(new Set())} className="min-h-8 rounded-control border border-line px-2 font-semibold">Collapse all</button>
              <button type="button" onClick={() => setOpenRows(new Set(labourLines.map((l) => l.id)))} className="min-h-8 rounded-control border border-line px-2 font-semibold">Expand all</button>
            </span>
          </div>
          {isQuotation && findings.length ? <div className="flex flex-col gap-2">{findings.map(findingBlock)}</div> : null}
          {looseLabour.length || !findings.length ? (
            <div className="rounded-control border border-line">
              {findings.length ? <div className="bg-chip px-2 py-1.5 text-xs font-bold">Other labour and services</div> : null}
              <div className="divide-y divide-line">{looseLabour.map(labourRow)}</div>
              {looseLabour.length === 0 ? <p className="px-2 py-2 text-sm text-muted">No labour lines yet.</p> : null}
            </div>
          ) : null}
          {!disabled ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button type="button" size="md" onClick={() => setPicker({})}>Add service</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "labour", title: "" })}>+ Labour</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => setPartAsk({ description: "", quantity: "1" })}>Ask Parts for a part</Button>
            </div>
          ) : null}
          {partAsk ? (
            <div className="rounded-control border border-ink p-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Part needed{partAsk.source ? ` for: ${partAsk.source.label}` : ""}</span><Input value={partAsk.description} onChange={(e) => setPartAsk({ ...partAsk, description: e.target.value })} placeholder="Part name or number" /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={partAsk.quantity} onChange={(e) => setPartAsk({ ...partAsk, quantity: e.target.value })} inputMode="decimal" className="w-20" /></label>
              <Button type="button" size="md" onClick={() => { if (partAsk.description.trim()) { save({ requestPart: { description: partAsk.description, quantity: partAsk.quantity, source_type: partAsk.source?.source_type ?? null, source_key: partAsk.source?.source_key ?? null } }); setPartAsk(null); } }}>Send to Parts</Button>
              <Button type="button" tone="ghost" size="md" onClick={() => setPartAsk(null)}>Cancel</Button>
            </div>
          ) : null}
          {workshopEstimate && workshopEstimate.hours !== null ? (
            <p className={`text-xs ${totals.labourHours + 0.05 < (workshopEstimate.managerHours ?? workshopEstimate.hours ?? 0) ? "font-semibold text-amber" : "text-muted"}`}>
              Workshop estimate {workshopEstimate.managerHours ?? workshopEstimate.hours} h{workshopEstimate.agreed ? "" : " (not yet agreed by the manager)"} · quoted {hoursText(totals.labourHours)}{totals.labourHours + 0.05 < (workshopEstimate.managerHours ?? workshopEstimate.hours ?? 0) ? " · lower than the workshop estimate" : ""}
            </p>
          ) : null}
        </Card>

        {/* Block 2: parts */}
        <Card className="flex flex-col gap-3">
          <SectionLabel right={wait?.partsTotal ? `${wait.partsPriced} of ${wait.partsTotal} priced` : undefined}>Parts</SectionLabel>
          {partLines.length && !disabled ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Set markup for all parts (min {settings.minMarkup}%)</span><Input id="markup-all" defaultValue={String(settings.minMarkup)} inputMode="decimal" className="w-28" /></label>
              <Button type="button" tone="secondary" size="md" onClick={() => { const v = Number((document.getElementById("markup-all") as HTMLInputElement | null)?.value); if (!Number.isFinite(v)) return; for (const l of partLines) if (!isUnchosen(l)) patch(l.id, { markup_percent: Math.max(settings.minMarkup, v) }, true); }}>Apply</Button>
            </div>
          ) : null}
          {partLines.length === 0 ? <p className="text-sm text-muted">{wait?.openRequests ? `${wait.openRequests} request${wait.openRequests === 1 ? "" : "s"} with Parts. The parts appear here on their own once priced.` : "No parts on this quotation."}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-muted">
                    <th className="py-1 pr-2">Part</th>
                    <th className="py-1 pr-2">Availability</th>
                    <th className="py-1 pr-2 text-right">Qty</th>
                    <th className="py-1 pr-2 text-right">Cost</th>
                    <th className="py-1 pr-2 text-right">Markup %</th>
                    <th className="py-1 pr-2 text-right">Selling</th>
                    <th className="py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {partLines.map((l) => {
                    const part = partOf(l);
                    const unchosen = isUnchosen(l);
                    const total = lineTotal(l);
                    const floor = floorPrice(l, settings.minMarkup);
                    const belowFloor = !unchosen && total + 0.005 < floor;
                    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
                    const markup = l.markup_percent ?? 0;
                    const high = markup >= settings.markupWarn;
                    const linked = parentName(l);
                    return (
                      <tr key={l.id} id={`item-line-${l.id}`} className={`${unchosen ? "opacity-50" : ""} ${blocked || belowFloor ? "bg-red-soft" : high ? "bg-amber-soft/40" : ""}`}>
                        <td className="py-2 pr-2 align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {l.option_group ? <input type="radio" name={`opt-${l.option_group}`} checked={!unchosen} onChange={() => choose(l.option_group!, l.id)} disabled={disabled} className="h-4 w-4 accent-ink" aria-label="Use this option" /> : null}
                            <span className="font-semibold">{l.title}</span>
                            {partTypeText(l) ? <Badge tone="outline">{partTypeText(l)}</Badge> : null}
                            {part?.cost_aed === null ? <Badge tone="amber">Waiting for the price</Badge> : null}
                            {high ? <Badge tone={markup >= settings.markupConfirm ? "red" : "amber"}>{markup >= settings.markupConfirm ? (l.markup_confirmed ? "Very high markup, confirmed" : "Confirm the markup") : "High markup, check before sending"}</Badge> : null}
                          </div>
                          {isQuotation ? (
                            linked ? <span className="block text-[11px] text-muted">For: {linked}</span> : (
                              <span className="flex flex-wrap items-center gap-1 text-[11px] font-semibold text-amber">
                                Not linked to a job
                                {!disabled ? (
                                  <Select value="" onChange={(e) => { if (e.target.value) patch(l.id, { parent_line_id: e.target.value }, true); }} className="min-h-8 w-48 py-0 text-xs" aria-label="Link to a job">
                                    <option value="">Pick the job…</option>
                                    {labourLines.map((x) => <option key={x.id} value={x.id}>{lineName(x)}</option>)}
                                  </Select>
                                ) : null}
                              </span>
                            )
                          ) : null}
                          {l.option_group ? <span className="block text-[11px] text-muted">{unchosen ? "Option, not used" : "Chosen option"}</span> : null}
                        </td>
                        <td className="py-2 pr-2 align-top text-xs text-muted">{part?.availability ? `${AVAILABILITY_LABELS[part.availability]}${part.delivery_date ? ` ${part.delivery_date}` : ""}` : ""}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.quantity}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.unit_cost === null ? "" : aed(l.unit_cost)}</td>
                        <td className="py-2 pr-2 align-top text-right">
                          <Input value={num(l.markup_percent)} onChange={(e) => patch(l.id, { markup_percent: e.target.value === "" ? null : Number(e.target.value) })} onBlur={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < settings.minMarkup) patch(l.id, { markup_percent: settings.minMarkup }, true); }} inputMode="decimal" disabled={disabled || unchosen} className={`w-20 text-right min-h-9 ${markup < settings.minMarkup ? "border-red-bar" : high ? "border-amber-bar" : ""}`} aria-label="Markup percent" />
                        </td>
                        <td className="py-2 pr-2 align-top text-right">{aed(lineUnitPrice(l))}</td>
                        <td className="py-2 align-top text-right font-bold">
                          {aed(total)}
                          {isOwner && !disabled && !unchosen ? (
                            <details className="text-[11px] font-normal text-left">
                              <summary className="cursor-pointer text-muted">Owner discount{(l.discount_percent ?? 0) > 0 ? ` ${l.discount_percent}%` : ""}</summary>
                              <OwnerPartDiscount percent={l.discount_percent ?? 0} reason={l.discount_reason ?? ""} onChange={(pct, reason) => patch(l.id, { discount_percent: pct, discount_reason: reason })} />
                            </details>
                          ) : (l.discount_percent ?? 0) > 0 ? <span className="block text-[11px] font-normal text-muted">Discount {l.discount_percent}%</span> : null}
                          {belowFloor ? <span className="block text-[11px] font-bold text-red">Below the minimum</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {partLines.length ? (
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs self-end">
              <dt className="text-muted">Parts cost</dt><dd className="text-right">{aed(totals.partsCost)}</dd>
              <dt className="text-muted">Parts selling</dt><dd className="text-right">{aed(totals.partsSell)}</dd>
              <dt className="font-semibold">Parts margin</dt><dd className="text-right font-semibold">{aed(totals.partsMargin)}</dd>
            </dl>
          ) : null}
          {!isQuotation && !disabled ? <div><Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "part", title: "Part", quantity: 1 })}>+ Part (estimate)</Button></div> : null}
        </Card>

        {/* Block 3: other charges */}
        <Card className="flex flex-col gap-3">
          <SectionLabel>Other charges</SectionLabel>
          {otherLines.length === 0 ? <p className="text-sm text-muted">Recovery, the bank charge and any other charge sit here.</p> : null}
          <div className="divide-y divide-line">
            {otherLines.map((l) => {
              const hidden = isHidden(l);
              const total = lineTotal(l);
              const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
              if (l.fee_kind === "bank_charge") {
                return (
                  <div key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm text-muted">
                    <span className="flex-1 min-w-48">{l.title}</span>
                    <Badge tone="neutral">Internal, not shown to customer</Badge>
                    <span className="w-28 text-right font-semibold">{aed(lineCost(l))}</span>
                  </div>
                );
              }
              if (l.line_type === "recovery") {
                const tripValue = l.details === TRIPS[1].label ? "1b" : l.details === TRIPS[2].label ? "2" : "1";
                const kind = l.recovery_provider_kind ?? "ours";
                return (
                  <div key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-1.5 py-2 ${blocked ? "bg-red-soft" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold w-20">Recovery</span>
                      <Select value={tripValue} onChange={(e) => { const t = TRIPS.find((x) => x.value === e.target.value)!; patch(l.id, { details: t.label, title: `Recovery, ${t.label.toLowerCase()}`, recovery_trips: t.trips, quantity: t.trips }, true); }} disabled={disabled || kind === "customer"} className="min-h-9 py-0 w-44 text-xs" aria-label="Trip type">
                        {TRIPS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </Select>
                      <Input value={num(l.quantity)} onChange={(e) => patch(l.id, { recovery_trips: Number(e.target.value) || 1, quantity: Number(e.target.value) || 1 })} inputMode="numeric" disabled={disabled || kind === "customer"} className="w-14 text-right min-h-9" aria-label="Number of trips" />
                      <Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || kind === "customer"} placeholder="Cost/trip" className="w-24 text-right min-h-9" aria-label="Cost per trip" />
                      <Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || hidden} placeholder="Price/trip" className="w-24 text-right min-h-9" aria-label="Price per trip" />
                      <Select value={kind} onChange={(e) => patch(l.id, { recovery_provider_kind: e.target.value as QuoteLine["recovery_provider_kind"] }, true)} disabled={disabled} className="min-h-9 py-0 w-40 text-xs" aria-label="Provider">
                        <option value="ours">Our recovery</option>
                        <option value="external">External recovery</option>
                        <option value="customer">Customer arranged</option>
                      </Select>
                      {kind === "external" ? <Input value={l.recovery_provider ?? ""} onChange={(e) => patch(l.id, { recovery_provider: e.target.value })} list="erp-recovery-providers" disabled={disabled} placeholder="Company or person" className="w-40 min-h-9" /> : null}
                      {kind !== "customer" ? showHide(l, hidden) : <Badge tone="neutral">No cost, no charge</Badge>}
                      <span className="ml-auto w-28 text-right font-bold">{aed(total)}</span>
                      {!disabled ? <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 px-2 text-xs font-bold text-red" aria-label="Remove">×</button> : null}
                    </div>
                    <span className="text-[11px] text-muted">{kind === "customer" ? "Recorded for history." : hidden ? `Internal cost: the customer pays nothing for this line, so the price box is off. Cost to us ${aed(lineCost(l))}.` : `Shown to the customer as "${l.title}". Cost to us ${aed(lineCost(l))}.`}</span>
                  </div>
                );
              }
              return (
                <div key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-1.5 py-2 ${blocked ? "bg-red-soft" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Input value={l.title} onChange={(e) => patch(l.id, { title: e.target.value })} disabled={disabled} placeholder="What is this charge?" className="flex-1 min-w-48 min-h-9 font-semibold" />
                    <Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} placeholder="Cost (optional)" className="w-28 text-right min-h-9" aria-label="Cost" />
                    {hasCostFloor(l) ? <Input value={num(l.markup_percent)} onChange={(e) => patch(l.id, { markup_percent: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} placeholder="Markup %" className="w-20 text-right min-h-9" aria-label="Markup" /> : <Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || hidden} placeholder="Price" className="w-24 text-right min-h-9" aria-label="Price" />}
                    <Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled} className="w-14 text-right min-h-9" aria-label="Quantity" />
                    {showHide(l, hidden)}
                    <span className="ml-auto w-28 text-right font-bold">{aed(total)}</span>
                    {!disabled ? <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 px-2 text-xs font-bold text-red" aria-label="Remove">×</button> : null}
                  </div>
                  <button type="button" onClick={() => toggleKey(`details-${l.id}`)} className="self-start text-[11px] font-semibold text-muted underline underline-offset-4">{l.details ? "Details shown to the customer" : "Add details for the customer"}</button>
                  {openRows.has(`details-${l.id}`) ? <Textarea value={l.details ?? ""} onChange={(e) => patch(l.id, { details: e.target.value })} rows={2} disabled={disabled} /> : null}
                </div>
              );
            })}
          </div>
          {!disabled ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "recovery" })}>+ Recovery</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "other", title: "" })}>+ Other</Button>
              {settings.inspectionFee > 0 && !otherLines.some((l) => /inspection fee/i.test(l.title)) ? <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "other", title: "Inspection fee", unit_price: settings.inspectionFee, quantity: 1, visible_to_customer: true })}>+ Inspection fee ({aed(settings.inspectionFee)})</Button> : null}
            </div>
          ) : null}
          <datalist id="erp-recovery-providers">{recoveryProviders.map((p) => <option key={p} value={p} />)}</datalist>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <SectionLabel>Summary</SectionLabel>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Labour and services</dt><dd className="text-right">{aed(totals.labourSell)}</dd>
            <dt className="text-muted">Parts</dt><dd className="text-right">{aed(totals.partsSell)}</dd>
            <dt className="text-muted">Other charges</dt><dd className="text-right">{aed(totals.otherSell)}</dd>
            {isOwner && !disabled ? (
              <><dt className="text-muted">Discount on labour and services</dt><dd className="text-right"><span className="inline-flex items-center gap-1"><Input value={num(header.discount_percent)} onChange={(e) => setHeaderField({ discount_percent: Number(e.target.value) || 0 })} inputMode="decimal" className="w-16 text-right min-h-9" aria-label="Discount percent" /> %</span></dd></>
            ) : null}
            {totals.discount ? <><dt className="font-bold">Discount {q.discount_percent}%</dt><dd className="text-right font-bold">− {aed(totals.discount)}</dd></> : null}
            {totals.rounding ? <><dt className="text-muted">Rounding</dt><dd className="text-right">{totals.rounding < 0 ? "− " : ""}{aed(Math.abs(totals.rounding))}</dd></> : null}
            <dt className="text-muted">VAT {quotation.vat_percent}%</dt><dd className="text-right">{aed(totals.vat)}</dd>
            <dt className="font-extrabold">Grand total</dt><dd className="text-right text-lg font-extrabold">{aed(totals.total)}</dd>
            {totals.deposit ? <><dt className="text-muted">Deposit required</dt><dd className="text-right font-semibold">{aed(totals.deposit)}</dd></> : null}
          </dl>
          {(header.discount_percent ?? 0) > settings.discountLimit ? <p className="text-xs font-semibold text-amber">Above the {settings.discountLimit}% discount limit: the owner must approve before sending.</p> : null}
          {showProfit ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs border-t border-line pt-2">
              <dt className="text-muted">Total cost (parts, labour at cost, other, bank charge)</dt><dd className="text-right">{aed(totals.partsCost + totals.labourCost + totals.otherCost + totals.bankCharge)}</dd>
              <dt className="text-muted">Bank charge ({settings.bankChargePercent}% hidden line{feeLine ? "" : ", added on the next save"})</dt><dd className="text-right">{aed(totals.bankCharge)}</dd>
              <dt className="font-semibold">Profit before VAT</dt><dd className="text-right font-semibold">{aed(totals.profit)}</dd>
            </dl>
          ) : null}
          {isQuotation ? <p className="text-xs text-muted">Estimated: about {estimatedDays} working day{estimatedDays === 1 ? "" : "s"} after approval. The firm date is set in planning.</p> : null}
          {highMarkups.length ? <p className="text-xs font-semibold text-amber">{highMarkups.length} part{highMarkups.length === 1 ? "" : "s"} with a high markup: check before sending.</p> : null}
        </Card>

        {wait && isQuotation && !sent ? (
          <Card className={`flex flex-col gap-2 ${wait.openRequests || wait.partsPriced < wait.partsTotal ? "border-amber-bar" : ""}`}>
            <SectionLabel>Parts</SectionLabel>
            <p className="text-sm font-semibold">{wait.partsTotal ? `${wait.partsPriced} of ${wait.partsTotal} parts priced` : "No parts requested"}{wait.openRequests ? ` · ${wait.openRequests} request${wait.openRequests === 1 ? "" : "s"} still open` : ""}</p>
            {wait.openRequests || wait.partsPriced < wait.partsTotal ? (
              <>
                <p className="text-xs text-muted">Waiting on {wait.partsNames || "Parts"}, {wait.waitingMinutes} min.</p>
                {!disabled ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" tone="secondary" size="md" disabled={pending || wait.waitingMinutes < wait.remindAfter} onClick={() => run(() => remindParts(quotation.id))}>Remind Parts{wait.waitingMinutes < wait.remindAfter ? ` (after ${wait.remindAfter} min)` : ""}</Button>
                    <Button type="button" tone="secondary" size="md" disabled={pending || wait.waitingMinutes < wait.escalateAfter} onClick={() => run(() => escalateParts(quotation.id))}>Escalate to owner{wait.waitingMinutes < wait.escalateAfter ? ` (after ${wait.escalateAfter} min)` : ""}</Button>
                  </div>
                ) : null}
                {wait.remindedAt ? <p className="text-[11px] text-muted">Reminded {formatDayTime(wait.remindedAt)}{wait.escalatedAt ? ` · escalated ${formatDayTime(wait.escalatedAt)}` : ""}</p> : null}
              </>
            ) : null}
          </Card>
        ) : null}

        <Card className="flex flex-col gap-2">
          <SectionLabel>Note to the customer</SectionLabel>
          <Textarea value={header.customer_note} onChange={(e) => setHeaderField({ customer_note: e.target.value })} rows={2} disabled={disabled} placeholder="Shown on the customer's page (optional)" />
        </Card>

        <Card className="flex flex-col gap-3 border-ink" id="item-parts">
          <SectionLabel>{sent ? (isQuotation ? "Sent" : "Estimate sent") : completed ? (isQuotation ? "Send the quotation" : "Send the estimate") : isQuotation ? "Finish the quotation" : "Finish the estimate"}</SectionLabel>
          {sent ? (
            <p className="text-sm">
              {quotation.status === "sent" ? `Sent ${formatDayTime(quotation.sent_at)}, not yet opened.` : quotation.status === "opened" ? `Opened by the customer ${formatDayTime(quotation.opened_at)}.` : quotation.status === "approved" ? `Approved by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "declined" ? `Declined by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.${quotation.declined_note ? ` "${quotation.declined_note}"` : ""}` : quotation.status === "expired" ? "Expired. Re-send it or revise it." : quotation.status === "superseded" ? "Replaced by a newer version." : ""}
            </p>
          ) : null}
          {!sent ? <p className="text-xs font-semibold">{labourDone} of {labourLines.length} lines done{unquoted.length ? ` · ${unquoted.length} finding${unquoted.length === 1 ? "" : "s"} not quoted` : ""}{wait?.partsTotal ? ` · parts ${wait.partsPriced} of ${wait.partsTotal} priced` : ""}</p> : null}
          {!sent && !completed && blockers.length ? (
            <ul className="flex flex-col gap-1">
              {blockers.map((b, i) => (
                <li key={b.key + i}>
                  <button type="button" onClick={() => document.getElementById(`item-${b.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className={`text-left text-xs font-semibold underline underline-offset-4 ${attempted ? "text-red" : "text-muted"}`}>{b.label}</button>
                </li>
              ))}
            </ul>
          ) : null}
          {!sent && !completed && !disabled ? (
            <Button type="button" size="lg" className={`w-full ${blockers.length ? "opacity-60" : ""}`} disabled={pending} onClick={() => { if (blockers.length) { setAttempted(true); document.getElementById(`item-${blockers[0].key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; } run(() => completeQuotation(quotation.id)); }}>
              {pending ? "Checking…" : isQuotation ? "Quotation complete" : "Estimate complete"}
            </Button>
          ) : null}
          {canKeepUrgent ? (
            <button type="button" disabled={pending} onClick={() => { if (window.confirm("Keep only the lines marked Urgent, and their parts? The rest is removed from this version.")) run(() => keepUrgentOnly(quotation.id)); }} className="self-start text-xs font-semibold underline underline-offset-4">Keep urgent lines only</button>
          ) : null}
          {!sent && completed ? (
            <>
              <p className="text-xs text-muted">Complete {formatDayTime(completedAt)}. Any change reopens it.</p>
              {!blockers.length && reasons.length && !isOwner ? <p className="text-xs font-semibold text-amber">Needs the owner&apos;s approval: {reasons.join("; ")}</p> : null}
              {canSend ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={blockers.length > 0} onBlocked={() => { setAttempted(true); const first = blockers[0]; document.getElementById(`item-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} existingToken={quotation.token} status={quotation.status} total={totals.total} roundedTotal={quotation.rounded_total_aed} /> : null}
              {!disabled ? <button type="button" className="self-start text-xs font-semibold underline underline-offset-4" onClick={() => run(() => reopenQuotation(quotation.id))}>Reopen to change</button> : null}
            </>
          ) : null}
          {canSend && sent && quotation.token && (quotation.status === "sent" || quotation.status === "opened") ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={false} onBlocked={() => {}} existingToken={quotation.token} status={quotation.status} total={totals.total} roundedTotal={quotation.rounded_total_aed} again /> : null}
          {fromEstimate && !sent ? <p className="text-xs text-muted">From an accepted estimate: if nothing changed, confirm it below instead of sending again.</p> : null}
        </Card>
      </div>

      {picker ? <ServicePicker categories={categories} services={services} usage={usage} department={department} onPick={pick} onClose={() => setPicker(null)} /> : null}
      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold text-red">{confirming.message}</span>
            <p className="text-sm text-muted">A markup this high is unusual. It stays flagged on the quotation until it is sent.</p>
            <div className="flex gap-2">
              <Button type="button" size="lg" onClick={() => { const op = confirming.op as { patchLine?: Record<string, unknown> }; if (op.patchLine) save({ patchLine: { ...op.patchLine, markup_confirmed: true } }); setConfirming(null); }}>Yes, correct</Button>
              <Button type="button" tone="secondary" size="lg" onClick={() => { setConfirming(null); router.refresh(); }}>No, go back</Button>
            </div>
          </div>
        </div>
      ) : null}
      {!disabled ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-full bg-ink/85 px-3 py-1 text-[11px] font-bold text-white pointer-events-none">
          {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "No connection · changes kept, will save"}
        </div>
      ) : null}
    </div>
  );
}

/** The ready-made jobs: two letters filter the list; a tap writes the description. Free text is the last resort. */
function JobPicker({ jobs, onPick, onBuild }: { jobs: { group: string; title: string }[]; onPick: (title: string) => void; onBuild: () => void }) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const q = text.trim().toLowerCase();
  const shown = (q.length >= 2 ? jobs.filter((j) => j.title.toLowerCase().includes(q)) : jobs).slice(0, 12);
  return (
    <div className="relative">
      <Input value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); onPick(shown[0] && q.length >= 2 ? shown[0].title : text.trim()); } }} placeholder="What are we doing? Type two letters to filter" className="font-semibold border-amber-bar min-h-10" autoFocus />
      {focus ? (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-card border border-line bg-white shadow-xl">
          {shown.map((j) => (
            <button key={j.group + j.title} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(j.title)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-canvas">
              <span className="font-semibold">{j.title}</span>
              <span className="text-[11px] text-muted">{j.group}</span>
            </button>
          ))}
          {q.length >= 2 ? <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(text.trim())} className="w-full px-3 py-2 text-left text-xs font-semibold text-muted hover:bg-canvas">Use &quot;{text.trim()}&quot; as typed</button> : null}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onBuild} className="w-full px-3 py-2 text-left text-xs font-semibold text-muted hover:bg-canvas border-t border-line">Build it from action, component and position</button>
        </div>
      ) : null}
    </div>
  );
}

/** Action, component and position pick-lists that write the labour description, for anything not on the list. */
function LabourBuilder({ actions, positions, components, onUse, onClose }: { actions: string[]; positions: string[]; components: string[]; onUse: (title: string) => void; onClose: () => void }) {
  const [action, setAction] = useState(actions[0] ?? "");
  const [component, setComponent] = useState("");
  const [position, setPosition] = useState("");
  const [filter, setFilter] = useState("");
  const shown = components.filter((c) => c.toLowerCase().includes(filter.toLowerCase())).slice(0, 24);
  const title = [action, component || filter].filter(Boolean).join(" ").trim() + (position ? `, ${position.toLowerCase()}` : "");
  return (
    <div className="rounded-control border border-ink p-3 flex flex-col gap-2 bg-canvas">
      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <button key={a} type="button" onClick={() => setAction(a)} aria-pressed={action === a} className={`min-h-8 rounded-control border px-2 text-xs font-bold ${action === a ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{a}</button>
        ))}
      </div>
      <Input value={filter} onChange={(e) => { setFilter(e.target.value); setComponent(""); }} placeholder="Component: type to search, for example fuel" />
      <div className="flex flex-wrap gap-1">
        {shown.map((c) => (
          <button key={c} type="button" onClick={() => { setComponent(c); setFilter(c); }} aria-pressed={component === c} className={`min-h-8 rounded-control border px-2 text-xs font-semibold ${component === c ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{c}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {positions.map((p) => (
          <button key={p} type="button" onClick={() => setPosition(position === p ? "" : p)} aria-pressed={position === p} className={`min-h-8 rounded-control border px-2 text-xs font-semibold ${position === p ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{p}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold flex-1">{title || "…"}</span>
        <Button type="button" size="md" disabled={!title.trim()} onClick={() => onUse(title)}>Use this</Button>
        <Button type="button" tone="ghost" size="md" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

/** The owner's discount on a part: the percentage and the reason go to the server together, once both are there. */
function OwnerPartDiscount({ percent, reason, onChange }: { percent: number; reason: string; onChange: (pct: number, reason: string) => void }) {
  const [pct, setPct] = useState(num(percent));
  const [why, setWhy] = useState(reason);
  const send = (p: string, r: string) => {
    const n = Number(p) || 0;
    if (n === 0 || r.trim()) onChange(n, r.trim());
  };
  const waiting = (Number(pct) || 0) > 0 && !why.trim();
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs mt-1">
      <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Discount %</span><Input value={pct} onChange={(e) => { setPct(e.target.value); send(e.target.value, why); }} inputMode="decimal" className="w-20" /></label>
      <label className="flex flex-col gap-1 flex-1 min-w-40"><span className="font-semibold text-muted">Reason (logged)</span><Input value={why} onChange={(e) => { setWhy(e.target.value); send(pct, e.target.value); }} placeholder="required" /></label>
      {waiting ? <span className="text-amber font-semibold pb-3">Write the reason to apply it.</span> : null}
    </div>
  );
}
