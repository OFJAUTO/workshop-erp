"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ServicePicker } from "@/components/ServicePicker";
import { Badge, Button, Card, Input, Notice, SectionLabel, Select, Textarea } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import { AVAILABILITY_LABELS, LINE_TYPES, LINE_TYPE_LABELS, URGENCY_LABELS, aed, floorPrice, hasCostFloor, hoursText, isHidden, isUnchosen, lineCost, lineTotal, linePrice, lineUnitPrice, ownerApprovalReasons, partTypeText, quoteTotals, sendBlockers, suggestPromisedDate, takesTotalDiscount, type LineType, type PartItem, type PartRequest, type QuoteLine, type QuoteRow, type Service, type ServiceCategory, type Urgency } from "@/lib/quotes";
import type { WorkingTime } from "@/lib/working-time";
import { completeQuotation, escalateParts, remindParts, reopenQuotation } from "@/app/(app)/quotes/actions";
import { SendQuoteControl } from "./SendQuoteControl";

type Op = Record<string, unknown>;

/** Every change goes to the server at once, through a queue kept in the browser so nothing typed is lost. */
function useQuoteAutosave(quotationId: string, onSaved: () => void) {
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
        const data = (await res.json()) as { ok?: boolean; error?: string; id?: string };
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
  }, [quotationId, persist, onSaved]);
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
  return { save, state, error, clearError: () => setError(null) };
}

export type EditorSettings = {
  labourRate: number;
  minMarkup: number;
  discountLimit: number;
  approvalAbove: number;
  technicianCostRate: number | null;
  bankChargePercent: number;
  depositThreshold: number;
  depositPercent: number;
  today: string;
  workingTime: WorkingTime;
};

/** What the advisor is waiting for from Parts, for the status bar and the Remind and Escalate buttons. */
export type PartsWait = { openRequests: number; partsTotal: number; partsPriced: number; waitingMinutes: number; partsNames: string; remindAfter: number; escalateAfter: number; remindedAt: string | null; escalatedAt: string | null };

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const TRIPS = [
  { value: "1", label: "One way to the workshop" },
  { value: "1b", label: "One way to the customer" },
  { value: "2", label: "Two ways" },
];

/**
 * The quotation builder in two blocks: labour and services on top (the advisor's work), the parts
 * below in one compact row each, already filled in by Parts; the advisor only sets the markup and
 * picks between options. Everything saves as it is typed. "Quotation complete" comes before Send.
 */
export function QuoteEditor({
  quotation,
  lines: initialLines,
  parts,
  requests = [],
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
  labourActions = [],
  labourPositions = [],
  components = [],
  hoursMemory = {},
  wait = null,
  workshopEstimate = null,
  completedAt = null,
}: {
  quotation: QuoteRow;
  lines: QuoteLine[];
  parts: PartItem[];
  requests?: PartRequest[];
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
  labourActions?: string[];
  labourPositions?: string[];
  components?: string[];
  hoursMemory?: Record<string, number>;
  wait?: PartsWait | null;
  workshopEstimate?: { hours: number | null; managerHours: number | null; agreed: boolean } | null;
  completedAt?: string | null;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<QuoteLine[]>(initialLines);
  const [header, setHeader] = useState({ discount_percent: quotation.discount_percent, promised_at: quotation.promised_at ?? "", customer_note: quotation.customer_note ?? "" });
  const [attempted, setAttempted] = useState(false);
  const [picker, setPicker] = useState(false);
  const [partAsk, setPartAsk] = useState<null | { description: string; quantity: string }>(null);
  const [dummy, setDummy] = useState<null | { title: string; quantity: string; unit_cost: string; unit_price: string }>(null);
  const [builderFor, setBuilderFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refresh = useCallback(() => router.refresh(), [router]);
  const { save, state, error } = useQuoteAutosave(quotation.id, refresh);
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
        return k ? { ...l, ...k, unit_cost: l.part_item_id ? l.unit_cost : k.unit_cost, quantity: l.part_item_id ? l.quantity : k.quantity, discount_percent: l.discount_percent, markup_percent: l.markup_percent, hours: l.hours, chosen: l.chosen, title: l.part_item_id ? l.title : k.title } : l;
      });
    });
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
  const addLine = (fields: Partial<QuoteLine> & { service_id?: string | null; dummyPart?: boolean }) => save({ addLine: fields });
  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
    save({ removeLine: { id } });
  };
  const move = (id: string, dir: -1 | 1) => {
    setLines((prev) => {
      const work = prev.filter((l) => l.line_type !== "part" && !l.fee_kind);
      const i = work.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= work.length) return prev;
      const next = [...work];
      [next[i], next[j]] = [next[j], next[i]];
      const ordered = [...next, ...prev.filter((l) => l.line_type === "part" || l.fee_kind)];
      save({ reorder: { ids: ordered.map((l) => l.id) } });
      return ordered.map((l, k) => ({ ...l, position: k }));
    });
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

  const q = { ...quotation, ...header, promised_at: header.promised_at || null };
  const totals = quoteTotals(lines, q, { technicianCostRate: settings.technicianCostRate ?? 0, depositThreshold: settings.depositThreshold, depositPercent: settings.depositPercent, bankChargePercent: settings.bankChargePercent });
  const blockers = sendBlockers(q, lines, parts, { minMarkup: settings.minMarkup, openRequests: wait?.openRequests ?? 0, workshopEstimate });
  const reasons = ownerApprovalReasons(q, lines, totals, { discountLimit: settings.discountLimit, approvalAbove: settings.approvalAbove });
  const suggestion = suggestPromisedDate(lines, parts, settings.today, settings.workingTime);
  const promisedTooEarly = !!header.promised_at && !!suggestion.latestDelivery && header.promised_at < suggestion.latestDelivery;
  const partOf = (l: QuoteLine) => (l.part_item_id ? parts.find((p) => p.id === l.part_item_id) ?? null : null);
  const sent = !!quotation.sent_at || ["sent", "opened", "approved", "urgent_requested", "declined", "expired", "superseded"].includes(quotation.status);
  const advisorPartUsed = lines.some((l) => l.advisor_added);
  const workLines = lines.filter((l) => l.line_type !== "part" && !l.fee_kind);
  const partLines = lines.filter((l) => l.line_type === "part");
  const feeLine = lines.find((l) => l.fee_kind === "bank_charge") ?? null;
  const completed = !!completedAt;

  /** A part takes Urgent or Recommended from the work line of the request it came from. */
  const inherited = (l: QuoteLine): { urgency: Urgency; from: string | null } => {
    const p = partOf(l);
    const req = p?.part_request_id ? requests.find((r) => r.id === p.part_request_id) : null;
    const workLine = req ? workLines.find((w) => w.source_type === req.source_type && w.source_key === req.source_key.split("#")[0]) ?? workLines.find((w) => w.group_label === req.label || w.title === req.label) ?? null : null;
    if (workLine) return { urgency: workLine.urgency ?? "urgent", from: workLine.title };
    return { urgency: l.urgency ?? "urgent", from: null };
  };
  const labourHoursDone = workLines.filter((l) => l.line_type === "labour").filter((l) => (l.hours ?? 0) > 0).length;
  const labourCount = workLines.filter((l) => l.line_type === "labour").length;
  const progress = [wait?.partsTotal ? `Parts ${wait.partsPriced} of ${wait.partsTotal} priced` : "", labourCount ? `Labour ${labourHoursDone} of ${labourCount} line${labourCount === 1 ? "" : "s"} done` : ""].filter(Boolean).join(" · ");

  const pick = (s: Service) => {
    setPicker(false);
    addLine({ service_id: s.id });
  };
  const applyTitle = (id: string, title: string) => {
    const remembered = hoursMemory[title.toLowerCase()];
    patch(id, remembered ? { title, hours: remembered } : { title }, true);
    setBuilderFor(null);
  };
  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>) =>
    start(async () => {
      setActionError(null);
      const res = await fn();
      if (res.error) setActionError(res.error);
      router.refresh();
    });
  const dangerous = lines.some((l) => l.dangerous && l.is_active);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pb-24">
      <div className="xl:col-span-2 flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {actionError ? <Notice tone="error">{actionError}</Notice> : null}
        {dangerous ? <Notice tone="error">A dangerous finding is on this quotation: its line is Urgent and the customer sees a safety warning.</Notice> : null}

        {/* Block 1: labour and services */}
        <Card className="flex flex-col gap-3">
          <SectionLabel right={labourCount ? `${labourHoursDone} of ${labourCount} with hours` : undefined}>Labour and services</SectionLabel>
          {workLines.length === 0 ? <p className="text-sm text-muted">No work lines yet. Add a service or labour below.</p> : null}
          {workLines.map((l, i) => {
            const price = linePrice(l);
            const total = lineTotal(l);
            const costed = hasCostFloor(l);
            const hidden = isHidden(l);
            const floor = costed ? floorPrice(l, settings.minMarkup) : 0;
            const belowFloor = costed && !hidden && total + 0.005 < floor;
            const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
            return (
              <div key={l.id} id={`item-line-${l.id}`} className={`rounded-control border p-3 flex flex-col gap-2 ${blocked || belowFloor ? "border-red-bar" : hidden ? "border-dashed" : l.dangerous ? "border-red-bar" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-muted w-6">{i + 1}.</span>
                  <Badge tone="neutral">{LINE_TYPE_LABELS[l.line_type]}</Badge>
                  {l.group_label ? <span className="text-xs text-muted">· {l.group_label}</span> : null}
                  {l.dangerous ? <Badge tone="red">Dangerous</Badge> : null}
                  {hidden ? <Badge tone="ink">Internal cost, not shown to customer</Badge> : null}
                  {l.customer_approved === true ? <Badge tone="green">Approved</Badge> : l.customer_approved === false ? <Badge tone="red">Declined</Badge> : null}
                  {!disabled ? (
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label="Move up" onClick={() => move(l.id, -1)} className="min-h-9 min-w-9 rounded-control border border-line text-sm font-bold">↑</button>
                      <button type="button" aria-label="Move down" onClick={() => move(l.id, 1)} className="min-h-9 min-w-9 rounded-control border border-line text-sm font-bold">↓</button>
                      <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 rounded-control border border-line px-3 text-xs font-bold text-red">Remove</button>
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
                  <Input value={l.title} onChange={(e) => patch(l.id, { title: e.target.value })} disabled={disabled} className="font-semibold" aria-label="Line name" />
                  {!disabled && l.line_type === "labour" ? <Button type="button" tone="secondary" size="md" onClick={() => setBuilderFor(builderFor === l.id ? null : l.id)}>Build description</Button> : null}
                  {!l.service_id ? (
                    <Select value={l.line_type} onChange={(e) => patch(l.id, { line_type: e.target.value as LineType }, true)} disabled={disabled} className="sm:w-48" aria-label="Line type">
                      {LINE_TYPES.filter((t) => t.value !== "part").map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </Select>
                  ) : null}
                </div>
                {builderFor === l.id ? <LabourBuilder actions={labourActions} positions={labourPositions} components={components} onUse={(t) => applyTitle(l.id, t)} onClose={() => setBuilderFor(null)} /> : null}
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-muted">{l.details ? `Details shown to the customer: ${l.details.slice(0, 60)}${l.details.length > 60 ? "…" : ""}` : "Details shown to the customer (optional)"}</summary>
                  <Textarea value={l.details ?? ""} onChange={(e) => patch(l.id, { details: e.target.value })} rows={2} disabled={disabled} className="mt-2" placeholder={l.line_type === "other" ? "Describe the work (required, shown to the customer)" : "Details shown to the customer (optional)"} />
                </details>
                {isQuotation && !hidden ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-muted">For the customer:</span>
                    {(["urgent", "recommended"] as Urgency[]).map((u) => (
                      <button key={u} type="button" disabled={disabled || l.dangerous} onClick={() => patch(l.id, { urgency: u }, true)} aria-pressed={l.urgency === u} className={`min-h-10 rounded-control border-2 px-3 text-xs font-extrabold ${l.urgency === u ? (u === "urgent" ? "border-red-bar bg-red-bar text-white" : "border-ink bg-ink text-white") : "border-line-strong bg-white"}`}>
                        {URGENCY_LABELS[u]}
                      </button>
                    ))}
                    {!l.urgency ? <span className="text-xs text-muted">one tap, required</span> : null}
                    {l.dangerous ? <span className="text-xs text-red font-semibold">Dangerous: always urgent</span> : null}
                  </div>
                ) : null}
                {l.line_type === "recovery" || l.line_type === "other" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={disabled} onClick={() => patch(l.id, { visible_to_customer: true }, true)} aria-pressed={l.visible_to_customer} className={`min-h-10 rounded-control border px-3 text-xs font-bold ${l.visible_to_customer ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Show to customer</button>
                    <button type="button" disabled={disabled} onClick={() => patch(l.id, { visible_to_customer: false }, true)} aria-pressed={!l.visible_to_customer} className={`min-h-10 rounded-control border px-3 text-xs font-bold ${!l.visible_to_customer ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Hide from customer</button>
                    {hidden ? <span className="text-xs text-muted">The customer pays nothing for this line; its cost still counts against the job&apos;s profit.</span> : null}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 items-end">
                  {l.line_type === "labour" ? (
                    <>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Hours (0.1 steps)</span><Input value={num(l.hours)} onChange={(e) => patch(l.id, { hours: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} onBlur={(e) => { const v = e.target.value.replace(",", "."); if (v !== "") patch(l.id, { hours: Math.max(0.1, Math.round(Number(v) * 10) / 10) }, true); }} inputMode="decimal" disabled={disabled} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Rate (AED/h) · standard {settings.labourRate}</span><Input value={num(l.labour_rate)} onChange={(e) => patch(l.id, { labour_rate: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} className={(l.labour_rate ?? 0) + 0.005 < settings.labourRate ? "border-red-bar" : ""} /></label>
                    </>
                  ) : null}
                  {l.line_type === "other" ? (
                    <>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost (AED, staff only)</span><Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} placeholder="optional" /></label>
                      {costed ? (
                        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Markup % (min {settings.minMarkup})</span><Input value={num(l.markup_percent)} onChange={(e) => patch(l.id, { markup_percent: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} className={(l.markup_percent ?? 0) < settings.minMarkup ? "border-red-bar" : ""} /></label>
                      ) : (
                        <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Price (AED)</span><Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || hidden} /></label>
                      )}
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled} /></label>
                    </>
                  ) : null}
                  {l.line_type === "recovery" ? (
                    <>
                      <label className="flex flex-col gap-1 col-span-2"><span className="text-xs font-semibold text-muted">Trips</span>
                        <div className="flex flex-wrap gap-1">
                          {TRIPS.map((t) => (
                            <button key={t.value} type="button" disabled={disabled} onClick={() => patch(l.id, { quantity: t.value === "2" ? 2 : 1, recovery_trips: t.value === "2" ? 2 : 1, details: t.label }, true)} aria-pressed={l.details === t.label} className={`min-h-10 rounded-control border px-2 text-xs font-bold ${l.details === t.label ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{t.label}</button>
                          ))}
                          <Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1, recovery_trips: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled} className="w-16" aria-label="Number of trips" />
                        </div>
                      </label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost to us per trip (AED)</span><Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Price to the customer per trip (AED)</span><Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || hidden} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Provider</span><Input value={l.recovery_provider ?? ""} onChange={(e) => patch(l.id, { recovery_provider: e.target.value })} disabled={disabled} placeholder="Our truck or company" /></label>
                    </>
                  ) : null}
                  {l.line_type === "package" || l.line_type === "fee" ? (
                    <>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Price (AED)</span><Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} /></label>
                      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled} /></label>
                    </>
                  ) : null}
                  {!costed && !hidden && l.line_type !== "recovery" && (isOwner || (l.discount_percent ?? 0) > 0) ? (
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Discount %</span><Input value={num(l.discount_percent)} onChange={(e) => patch(l.id, { discount_percent: Number(e.target.value) || 0 })} inputMode="decimal" disabled={disabled || !isOwner} className={(l.discount_percent ?? 0) > settings.discountLimit ? "border-amber-bar" : ""} /></label>
                  ) : null}
                  <div className="flex flex-col gap-1 text-right">
                    <span className="text-xs font-semibold text-muted">{hidden ? "Customer pays" : "Line total"}</span>
                    <span className="text-base font-extrabold">{aed(total)}</span>
                    {price !== total ? <span className="text-xs text-muted line-through">{aed(price)}</span> : null}
                  </div>
                </div>
                {belowFloor ? <p className="text-xs font-bold text-red">Blocked: net {aed(total)} is below cost plus the minimum markup of {settings.minMarkup}% ({aed(floor)}).</p> : null}
                {(costed || l.line_type === "recovery") && !hidden ? <p className="text-xs text-muted">Cost {aed(lineCost(l))} · margin {aed(total - lineCost(l))}</p> : null}
              </div>
            );
          })}
          {!disabled ? (
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="md" onClick={() => setPicker(true)}>Add service</Button>
                <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "labour", title: "Labour" })}>+ Labour</Button>
                {isOwner || !isQuotation ? (
                  <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "part", title: "Part" })}>+ Part</Button>
                ) : (
                  <>
                    <Button type="button" tone="secondary" size="md" onClick={() => setPartAsk({ description: "", quantity: "1" })}>+ Part (Parts price it)</Button>
                    {!advisorPartUsed ? <Button type="button" tone="secondary" size="md" onClick={() => setDummy({ title: "", quantity: "1", unit_cost: "", unit_price: "" })}>+ Small part (one per quotation)</Button> : null}
                  </>
                )}
                <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "other", title: "Other" })}>+ Other</Button>
                <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "recovery", title: "Recovery", quantity: 1 })}>+ Recovery</Button>
                {isOwner ? <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "fee", title: "Fee" })}>+ Fee</Button> : null}
              </div>
              {partAsk ? (
                <div className="rounded-control border border-line p-3 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Part description</span><Input value={partAsk.description} onChange={(e) => setPartAsk({ ...partAsk, description: e.target.value })} /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={partAsk.quantity} onChange={(e) => setPartAsk({ ...partAsk, quantity: e.target.value })} inputMode="decimal" className="w-24" /></label>
                  <Button type="button" size="md" onClick={() => { if (partAsk.description.trim()) { save({ requestPart: { description: partAsk.description, quantity: partAsk.quantity } }); setPartAsk(null); } }}>Send to Parts</Button>
                  <Button type="button" tone="ghost" size="md" onClick={() => setPartAsk(null)}>Cancel</Button>
                  <p className="w-full text-xs text-muted">Parts price it; the line appears in the Parts block below on its own.</p>
                </div>
              ) : null}
              {dummy ? (
                <div className="rounded-control border border-line p-3 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Description</span><Input value={dummy.title} onChange={(e) => setDummy({ ...dummy, title: e.target.value })} placeholder="For example: seal" /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Qty</span><Input value={dummy.quantity} onChange={(e) => setDummy({ ...dummy, quantity: e.target.value })} inputMode="decimal" className="w-20" /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost (AED, min 1)</span><Input value={dummy.unit_cost} onChange={(e) => setDummy({ ...dummy, unit_cost: e.target.value })} inputMode="decimal" className="w-28" /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Selling price each (min cost +{settings.minMarkup}%)</span><Input value={dummy.unit_price} onChange={(e) => setDummy({ ...dummy, unit_price: e.target.value })} inputMode="decimal" className="w-32" /></label>
                  <Button type="button" size="md" onClick={() => { if (dummy.title.trim()) { addLine({ line_type: "part", title: dummy.title, quantity: Number(dummy.quantity) || 1, unit_cost: Number(dummy.unit_cost), unit_price: Number(dummy.unit_price), dummyPart: true }); setDummy(null); } }}>Add small part</Button>
                  <Button type="button" tone="ghost" size="md" onClick={() => setDummy(null)}>Cancel</Button>
                </div>
              ) : null}
              {lines.some((l) => l.line_type === "labour") ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Hourly rate for every labour line (standard AED {settings.labourRate}{isOwner ? "" : ", higher only"})</span><Input id="rate-all" defaultValue={String(settings.labourRate)} inputMode="decimal" className="w-32" disabled={disabled} /></label>
                  <Button type="button" tone="secondary" size="md" disabled={disabled} onClick={() => { const v = Number((document.getElementById("rate-all") as HTMLInputElement | null)?.value); if (!Number.isFinite(v) || v <= 0) return; for (const l of lines) if (l.line_type === "labour") patch(l.id, { labour_rate: v }, true); }}>Apply to all labour lines</Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        {/* Block 2: parts, one row each */}
        <Card className="flex flex-col gap-3">
          <SectionLabel right={wait?.partsTotal ? `${wait.partsPriced} of ${wait.partsTotal} priced` : undefined}>Parts</SectionLabel>
          {partLines.length === 0 ? <p className="text-sm text-muted">{wait?.openRequests ? `${wait.openRequests} request${wait.openRequests === 1 ? "" : "s"} with Parts. The parts appear here on their own once priced.` : "No parts on this quotation."}</p> : null}
          {partLines.length ? (
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
                    const inh = isQuotation ? inherited(l) : null;
                    const total = lineTotal(l);
                    const floor = floorPrice(l, settings.minMarkup);
                    const belowFloor = !unchosen && total + 0.005 < floor;
                    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
                    return (
                      <tr key={l.id} id={`item-line-${l.id}`} className={`${unchosen ? "opacity-50" : ""} ${blocked || belowFloor ? "bg-red-soft" : ""}`}>
                        <td className="py-2 pr-2 align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {l.option_group ? <input type="radio" name={`opt-${l.option_group}`} checked={!unchosen} onChange={() => choose(l.option_group!, l.id)} disabled={disabled} className="h-4 w-4 accent-ink" aria-label="Use this option" /> : null}
                            <span className="font-semibold">{l.title}</span>
                            {partTypeText(l) ? <Badge tone="outline">{partTypeText(l)}</Badge> : null}
                            {l.advisor_added ? <Badge tone="outline">Added by advisor</Badge> : null}
                            {part?.cost_aed === null ? <Badge tone="amber">Waiting for the price</Badge> : null}
                            {l.customer_approved === true ? <Badge tone="green">Approved</Badge> : l.customer_approved === false ? <Badge tone="red">Declined</Badge> : null}
                          </div>
                          {inh ? <span className="block text-[11px] text-muted">{URGENCY_LABELS[inh.urgency]}{inh.from ? ` · for: ${inh.from}` : " · no work line matched"}</span> : null}
                          {l.option_group ? <span className="block text-[11px] text-muted">{unchosen ? "Option, not used" : "Chosen option"}</span> : null}
                        </td>
                        <td className="py-2 pr-2 align-top text-xs text-muted">{part?.availability ? `${AVAILABILITY_LABELS[part.availability]}${part.delivery_date ? ` ${part.delivery_date}` : ""}` : ""}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.quantity}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.unit_cost === null ? "" : aed(l.unit_cost)}</td>
                        <td className="py-2 pr-2 align-top text-right">
                          <Input value={num(l.markup_percent)} onChange={(e) => patch(l.id, { markup_percent: e.target.value === "" ? null : Number(e.target.value) })} onBlur={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < settings.minMarkup) patch(l.id, { markup_percent: settings.minMarkup }, true); }} inputMode="decimal" disabled={disabled || unchosen} className={`w-20 text-right ${(l.markup_percent ?? 0) < settings.minMarkup ? "border-red-bar" : ""}`} aria-label="Markup percent" />
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
          ) : null}
          {partLines.length ? (
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
              {!disabled ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Set markup for all parts (min {settings.minMarkup}%)</span><Input id="markup-all" defaultValue={String(settings.minMarkup)} inputMode="decimal" className="w-28" /></label>
                  <Button type="button" tone="secondary" size="md" onClick={() => { const v = Number((document.getElementById("markup-all") as HTMLInputElement | null)?.value); if (!Number.isFinite(v)) return; for (const l of partLines) if (!isUnchosen(l)) patch(l.id, { markup_percent: Math.max(settings.minMarkup, v) }, true); }}>Apply</Button>
                </div>
              ) : null}
              <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs">
                <dt className="text-muted">Parts cost</dt><dd className="text-right">{aed(totals.partsCost)}</dd>
                <dt className="text-muted">Parts selling</dt><dd className="text-right">{aed(totals.partsSell)}</dd>
                <dt className="font-semibold">Parts margin</dt><dd className="text-right font-semibold">{aed(totals.partsMargin)}</dd>
              </dl>
            </div>
          ) : null}
          <p className="text-xs text-muted">Parts fill in the name, type, cost, quantity and availability. The markup starts at {settings.minMarkup}% and can only go up. Each part is Urgent or Recommended with the work it belongs to.</p>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <SectionLabel>Totals</SectionLabel>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Lines (after line discounts)</dt><dd className="text-right font-semibold">{aed(totals.subtotal)}</dd>
            <dt className="text-muted">Discount on labour and services</dt>
            <dd className="text-right">
              <span className="inline-flex items-center gap-1"><Input value={num(header.discount_percent)} onChange={(e) => setHeaderField({ discount_percent: Number(e.target.value) || 0 })} inputMode="decimal" disabled={disabled} className="w-20 text-right" aria-label="Discount percent" /> %</span>
            </dd>
            {totals.discount ? <><dt className="text-muted">Discount, from {aed(totals.discountBase)} of labour and services</dt><dd className="text-right">− {aed(totals.discount)}</dd></> : null}
            <dt className="text-muted">Before VAT</dt><dd className="text-right font-semibold">{aed(totals.net)}</dd>
            <dt className="text-muted">VAT {quotation.vat_percent}%</dt><dd className="text-right">{aed(totals.vat)}</dd>
            <dt className="font-extrabold">Total</dt><dd className="text-right text-lg font-extrabold">{aed(totals.total)}</dd>
            {totals.deposit ? <><dt className="text-muted">Deposit required</dt><dd className="text-right font-semibold">{aed(totals.deposit)}</dd></> : null}
          </dl>
          <p className="text-xs text-muted">Parts, Other lines with a cost and Recovery never take the total discount; {lines.filter((l) => l.is_active && takesTotalDiscount(l) && !l.fee_kind).length === 1 ? "1 line does" : `${lines.filter((l) => l.is_active && takesTotalDiscount(l) && !l.fee_kind).length} lines do`}.</p>
          {(header.discount_percent ?? 0) > settings.discountLimit ? <p className="text-xs font-semibold text-amber">Above the {settings.discountLimit}% discount limit: the owner must approve before sending.</p> : null}
          {showProfit ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs border-t border-line pt-2">
              <dt className="text-muted">Labour hours</dt><dd className="text-right">{hoursText(totals.labourHours)} · {aed(totals.labourSell)}</dd>
              <dt className="text-muted">Labour cost (technician rate)</dt><dd className="text-right">{aed(totals.labourCost)}</dd>
              {totals.hiddenCost ? <><dt className="text-muted">Recovery and hidden costs</dt><dd className="text-right">{aed(totals.hiddenCost)}</dd></> : null}
              <dt className="text-muted">Bank charge ({settings.bankChargePercent}% of the total, hidden line{feeLine ? "" : ", added on the next save"})</dt><dd className="text-right">{aed(totals.bankCharge)}</dd>
              <dt className="font-semibold">Profit before VAT</dt><dd className="text-right font-semibold">{aed(totals.profit)}</dd>
            </dl>
          ) : null}
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

        {isQuotation ? (
          <Card className={`flex flex-col gap-2 ${attempted && !header.promised_at ? "border-red-bar" : ""}`} id="item-promised">
            <SectionLabel>Promised date</SectionLabel>
            <p className="text-xs text-muted">Suggested: the latest part delivery{suggestion.latestDelivery ? ` (${suggestion.latestDelivery})` : " (none to order)"} plus {suggestion.labourDays} working day{suggestion.labourDays === 1 ? "" : "s"} of labour.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={header.promised_at} onChange={(e) => setHeaderField({ promised_at: e.target.value }, true)} disabled={disabled} className="max-w-48" />
              {!disabled ? <Button type="button" tone="secondary" size="md" onClick={() => setHeaderField({ promised_at: suggestion.date }, true)}>Use {suggestion.date}</Button> : null}
            </div>
            {promisedTooEarly ? <p className="text-xs font-semibold text-red">Earlier than the latest part delivery date ({suggestion.latestDelivery}).</p> : null}
            {workshopEstimate && workshopEstimate.hours !== null ? <p className="text-xs text-muted">Workshop estimate: {workshopEstimate.managerHours ?? workshopEstimate.hours} h{workshopEstimate.agreed ? " (agreed by the manager)" : " (not yet agreed by the manager)"}{totals.labourHours + 0.05 < (workshopEstimate.managerHours ?? workshopEstimate.hours ?? 0) ? <span className="font-semibold text-amber"> · quoted hours ({hoursText(totals.labourHours)}) are lower</span> : null}</p> : null}
          </Card>
        ) : null}

        <Card className="flex flex-col gap-2">
          <SectionLabel>Note to the customer</SectionLabel>
          <Textarea value={header.customer_note} onChange={(e) => setHeaderField({ customer_note: e.target.value })} rows={3} disabled={disabled} placeholder="Shown on the customer's page (optional)" />
        </Card>

        <Card className="flex flex-col gap-3 border-ink" id="item-parts">
          <SectionLabel>{sent ? (isQuotation ? "Sent" : "Estimate sent") : completed ? (isQuotation ? "Send the quotation" : "Send the estimate") : isQuotation ? "Finish the quotation" : "Finish the estimate"}</SectionLabel>
          {sent ? (
            <p className="text-sm">
              {quotation.status === "sent" ? `Sent ${formatDayTime(quotation.sent_at)}, not yet opened.` : quotation.status === "opened" ? `Opened by the customer ${formatDayTime(quotation.opened_at)}.` : quotation.status === "approved" ? `Approved by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "urgent_requested" ? `${quotation.approver_name} asked for the urgent work only ${formatDayTime(quotation.responded_at)}.${quotation.customer_request_note ? ` Note: ${quotation.customer_request_note}` : ""}` : quotation.status === "declined" ? `Declined by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "expired" ? "Expired. Re-send it or revise it." : quotation.status === "superseded" ? "Replaced by a newer version." : ""}
            </p>
          ) : null}
          {!sent && progress ? <p className="text-xs font-semibold">{progress}</p> : null}
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
          {!sent && completed ? (
            <>
              <p className="text-xs text-muted">Complete {formatDayTime(completedAt)}. Any change reopens it.</p>
              {!blockers.length && reasons.length && !isOwner ? <p className="text-xs font-semibold text-amber">Needs the owner&apos;s approval: {reasons.join("; ")}</p> : null}
              {canSend ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={blockers.length > 0} onBlocked={() => { setAttempted(true); const first = blockers[0]; document.getElementById(`item-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} existingToken={quotation.token} status={quotation.status} /> : null}
              {!disabled ? <button type="button" className="self-start text-xs font-semibold underline underline-offset-4" onClick={() => run(() => reopenQuotation(quotation.id))}>Reopen to change</button> : null}
            </>
          ) : null}
          {canSend && sent && quotation.token && (quotation.status === "sent" || quotation.status === "opened") ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={false} onBlocked={() => {}} existingToken={quotation.token} status={quotation.status} again /> : null}
          {fromEstimate && !sent ? <p className="text-xs text-muted">From an accepted estimate: if nothing changed, confirm it below instead of sending again.</p> : null}
        </Card>
      </div>

      {picker ? <ServicePicker categories={categories} services={services} usage={usage} department={department} onPick={pick} onClose={() => setPicker(false)} /> : null}
      {!disabled ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-full bg-ink/85 px-3 py-1 text-[11px] font-bold text-white pointer-events-none">
          {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "No connection · changes kept, will save"}
        </div>
      ) : null}
    </div>
  );
}

/** Action, component and position pick-lists that write the labour description, so advisors stop free-typing. */
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
          <button key={a} type="button" onClick={() => setAction(a)} aria-pressed={action === a} className={`min-h-9 rounded-control border px-2 text-xs font-bold ${action === a ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{a}</button>
        ))}
      </div>
      <Input value={filter} onChange={(e) => { setFilter(e.target.value); setComponent(""); }} placeholder="Component: type to search the checklist, or type your own" />
      <div className="flex flex-wrap gap-1">
        {shown.map((c) => (
          <button key={c} type="button" onClick={() => { setComponent(c); setFilter(c); }} aria-pressed={component === c} className={`min-h-9 rounded-control border px-2 text-xs font-semibold ${component === c ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{c}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {positions.map((p) => (
          <button key={p} type="button" onClick={() => setPosition(position === p ? "" : p)} aria-pressed={position === p} className={`min-h-9 rounded-control border px-2 text-xs font-semibold ${position === p ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{p}</button>
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
