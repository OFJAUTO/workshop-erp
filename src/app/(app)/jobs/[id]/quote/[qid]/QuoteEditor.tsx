"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ServicePicker } from "@/components/ServicePicker";
import { Badge, Button, Card, Input, Notice, SectionLabel, Select, Textarea } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import { AVAILABILITY_LABELS, CONFIRM_LABELS, LINE_TYPES, LINE_TYPE_LABELS, URGENCY_LABELS, aed, floorPrice, hasCostFloor, hoursText, isHidden, lineCost, lineTotal, linePrice, ownerApprovalReasons, quoteTotals, sendBlockers, suggestPromisedDate, takesTotalDiscount, type LineType, type PartItem, type QuoteLine, type QuoteRow, type Service, type ServiceCategory, type Urgency } from "@/lib/quotes";
import type { WorkingTime } from "@/lib/working-time";
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
          // The server answered and refused: drop the change, say why, and show the server's value again.
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

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/**
 * The quotation builder. Lines the advisor adds, edits, removes and reorders; parts with their cost
 * from the Parts desk and a markup that never lets the net price fall below cost plus the minimum;
 * labour hours by the rate; services from the owner's list; Other and Recovery lines that can be
 * hidden from the customer; urgent or recommended on every line; discounts; VAT; the promised date;
 * and Send. Everything saves as it is typed.
 */
export function QuoteEditor({
  quotation,
  lines: initialLines,
  parts,
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
}: {
  quotation: QuoteRow;
  lines: QuoteLine[];
  parts: PartItem[];
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
}) {
  const router = useRouter();
  const [lines, setLines] = useState<QuoteLine[]>(initialLines);
  const [header, setHeader] = useState({ discount_percent: quotation.discount_percent, promised_at: quotation.promised_at ?? "", customer_note: quotation.customer_note ?? "", payment_by_card: quotation.payment_by_card });
  const [attempted, setAttempted] = useState(false);
  const [picker, setPicker] = useState(false);
  const [partAsk, setPartAsk] = useState<null | { description: string; quantity: string }>(null);
  const [dummy, setDummy] = useState<null | { title: string; quantity: string; unit_cost: string; unit_price: string }>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refresh = useCallback(() => router.refresh(), [router]);
  const { save, state, error } = useQuoteAutosave(quotation.id, refresh);
  const disabled = readOnly;
  const isQuotation = quotation.kind === "quotation";

  // Lines changed elsewhere (Parts listing a part, a refused save) arrive on refresh; local edits of known lines are kept.
  const [seenLines, setSeenLines] = useState(initialLines);
  if (seenLines !== initialLines) {
    setSeenLines(initialLines);
    setLines((cur) => {
      const known = new Map(cur.map((l) => [l.id, l]));
      return initialLines.map((l) => {
        const k = known.get(l.id);
        return k ? { ...l, ...k, unit_cost: l.part_item_id ? l.unit_cost : k.unit_cost, quantity: l.part_item_id ? l.quantity : k.quantity, discount_percent: l.discount_percent, markup_percent: l.markup_percent, hours: l.hours } : l;
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
  const addLine = (fields: Partial<QuoteLine> & { service_id?: string | null; dummyPart?: boolean }) => {
    save({ addLine: fields });
  };
  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
    save({ removeLine: { id } });
  };
  const move = (id: string, dir: -1 | 1) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      save({ reorder: { ids: next.map((l) => l.id) } });
      return next.map((l, k) => ({ ...l, position: k }));
    });
  };
  const setHeaderField = (fields: Partial<typeof header>, immediate = false) => {
    setHeader((h) => ({ ...h, ...fields }));
    const op = () => ({ header: fields });
    if (immediate) save(op());
    else debounced("header-" + Object.keys(fields).join(","), op);
  };

  const q = { ...quotation, ...header, promised_at: header.promised_at || null };
  const totals = quoteTotals(lines, q, { technicianCostRate: settings.technicianCostRate ?? 0, depositThreshold: settings.depositThreshold, depositPercent: settings.depositPercent, bankChargePercent: settings.bankChargePercent });
  const blockers = sendBlockers(q, lines, parts, { minMarkup: settings.minMarkup });
  const reasons = ownerApprovalReasons(q, lines, totals, { discountLimit: settings.discountLimit, approvalAbove: settings.approvalAbove });
  const suggestion = suggestPromisedDate(lines, parts, settings.today, settings.workingTime);
  const promisedTooEarly = !!header.promised_at && !!suggestion.latestDelivery && header.promised_at < suggestion.latestDelivery;
  const partOf = (l: QuoteLine) => (l.part_item_id ? parts.find((p) => p.id === l.part_item_id) ?? null : null);
  const sent = !!quotation.sent_at || ["sent", "opened", "approved", "urgent_requested", "declined", "expired", "superseded"].includes(quotation.status);
  const advisorPartUsed = lines.some((l) => l.advisor_added);
  const pick = (s: Service) => {
    setPicker(false);
    addLine({ service_id: s.id });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pb-24">
      <div className="xl:col-span-2 flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {lines.length === 0 ? <Notice tone="info">No lines yet. Add a service, labour, a part, Other or Recovery below.</Notice> : null}
        {lines.map((l, i) => {
          const part = partOf(l);
          const price = linePrice(l);
          const total = lineTotal(l);
          const costed = hasCostFloor(l);
          const hidden = isHidden(l);
          const floor = costed ? floorPrice(l, settings.minMarkup) : 0;
          const belowFloor = costed && !hidden && total + 0.005 < floor;
          const belowCost = costed && !hidden && total + 0.005 < lineCost(l);
          const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
          const margin = costed || l.line_type === "recovery" ? total - lineCost(l) : null;
          return (
            <Card key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-3 ${blocked || belowFloor ? "border-red-bar" : hidden ? "border-dashed" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-muted w-6">{i + 1}.</span>
                <Badge tone="neutral">{LINE_TYPE_LABELS[l.line_type]}</Badge>
                {l.group_label ? <span className="text-xs text-muted">· {l.group_label}</span> : null}
                {l.advisor_added ? <Badge tone="outline">Added by advisor</Badge> : null}
                {hidden ? <Badge tone="ink">Internal cost, not shown to customer</Badge> : null}
                {l.customer_approved === true ? <Badge tone="green">Approved</Badge> : l.customer_approved === false ? <Badge tone="red">Declined</Badge> : null}
                {part ? (
                  <>
                    <Badge tone={part.confirm_status === "confirmed" ? "green" : part.confirm_status === "rejected" ? "red" : "amber"}>{CONFIRM_LABELS[part.confirm_status]}</Badge>
                    {part.cost_aed === null ? <Badge tone="amber">Waiting for the parts price</Badge> : <Badge tone="neutral">{part.availability ? AVAILABILITY_LABELS[part.availability] : "Availability not set"}{part.availability === "to_order" && part.delivery_date ? ` · ${part.delivery_date}` : ""}</Badge>}
                  </>
                ) : null}
                {!disabled ? (
                  <span className="ml-auto flex gap-1">
                    <button type="button" aria-label="Move up" onClick={() => move(l.id, -1)} className="min-h-9 min-w-9 rounded-control border border-line text-sm font-bold">↑</button>
                    <button type="button" aria-label="Move down" onClick={() => move(l.id, 1)} className="min-h-9 min-w-9 rounded-control border border-line text-sm font-bold">↓</button>
                    <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 rounded-control border border-line px-3 text-xs font-bold text-red">Remove</button>
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                <Input value={l.title} onChange={(e) => patch(l.id, { title: e.target.value })} disabled={disabled} className="font-semibold" aria-label="Line name" />
                {!part && !l.service_id ? (
                  <Select value={l.line_type} onChange={(e) => patch(l.id, { line_type: e.target.value as LineType }, true)} disabled={disabled || l.line_type === "part"} className="sm:w-52" aria-label="Line type">
                    {LINE_TYPES.filter((t) => t.value !== "part" || l.line_type === "part").map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </Select>
                ) : null}
              </div>
              <Textarea value={l.details ?? ""} onChange={(e) => patch(l.id, { details: e.target.value })} rows={1} disabled={disabled} placeholder={l.line_type === "other" ? "Describe the work (required, shown to the customer)" : "Details shown to the customer (optional)"} />
              {isQuotation && !hidden ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted">For the customer:</span>
                  {(["urgent", "recommended"] as Urgency[]).map((u) => (
                    <button key={u} type="button" disabled={disabled} onClick={() => patch(l.id, { urgency: u }, true)} aria-pressed={l.urgency === u} className={`min-h-10 rounded-control border-2 px-3 text-xs font-extrabold ${l.urgency === u ? (u === "urgent" ? "border-red-bar bg-red-bar text-white" : "border-ink bg-ink text-white") : "border-line-strong bg-white"}`}>
                      {URGENCY_LABELS[u]}
                    </button>
                  ))}
                  {!l.urgency ? <span className="text-xs text-muted">one tap, required</span> : null}
                </div>
              ) : null}
              {(l.line_type === "recovery" || l.line_type === "other") ? (
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
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Rate (AED/h)</span><Input value={num(l.labour_rate)} readOnly disabled /></label>
                  </>
                ) : null}
                {l.line_type === "part" ? (
                  <>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost (AED)</span><Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || !!part || (!isOwner && !l.advisor_added)} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Markup % (min {settings.minMarkup})</span><Input value={num(l.markup_percent)} onChange={(e) => patch(l.id, { markup_percent: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} className={(l.markup_percent ?? 0) < settings.minMarkup ? "border-red-bar" : ""} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled || !!part} /></label>
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
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost to us (AED)</span><Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Price to the customer (AED)</span><Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || hidden} /></label>
                  </>
                ) : null}
                {l.line_type === "package" || l.line_type === "fee" ? (
                  <>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Price (AED)</span><Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled} /></label>
                  </>
                ) : null}
                {!costed && !hidden && l.line_type !== "recovery" ? (
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Discount %</span><Input value={num(l.discount_percent)} onChange={(e) => patch(l.id, { discount_percent: Number(e.target.value) || 0 })} inputMode="decimal" disabled={disabled} className={(l.discount_percent ?? 0) > settings.discountLimit ? "border-amber-bar" : ""} /></label>
                ) : null}
                {costed && !hidden && !isOwner && (l.discount_percent ?? 0) > 0 ? (
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Requested discount %</span><Input value={num(l.discount_percent)} readOnly disabled inputMode="decimal" /></label>
                ) : null}
                <div className="flex flex-col gap-1 text-right">
                  <span className="text-xs font-semibold text-muted">{hidden ? "Customer pays" : "Line total"}</span>
                  <span className="text-base font-extrabold">{aed(total)}</span>
                  {price !== total ? <span className="text-xs text-muted line-through">{aed(price)}</span> : null}
                </div>
              </div>
              {costed && !hidden && !disabled && !isOwner && (l.discount_percent ?? 0) === 0 ? (
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-muted">Ask the owner for a part discount</summary>
                  <AskPartDiscount onAsk={(pct, reason) => patch(l.id, { discount_percent: pct, discount_reason: reason }, true)} />
                </details>
              ) : null}
              {costed && !hidden && isOwner && !disabled ? (
                <OwnerPartDiscount percent={l.discount_percent ?? 0} reason={l.discount_reason ?? ""} onChange={(pct, reason) => patch(l.id, { discount_percent: pct, discount_reason: reason })} />
              ) : null}
              {costed && !hidden && (l.discount_percent ?? 0) > 0 && !(isOwner && !disabled) ? <p className="text-xs text-muted">Part discount {l.discount_percent}%{l.discount_reason ? `: ${l.discount_reason}` : ""} · {isOwner ? "logged" : "needs the owner's approval before sending"}</p> : null}
              {belowFloor ? <p className="text-xs font-bold text-red">Blocked: net {aed(total)} is below cost plus the minimum markup of {settings.minMarkup}% ({aed(floor)}).</p> : null}
              {belowCost ? <p className="text-xs font-bold text-red">Below cost: {aed(total)} against a cost of {aed(lineCost(l))}.</p> : null}
              {margin !== null ? <p className="text-xs text-muted">{hidden ? `Cost to us ${aed(lineCost(l))}` : `Cost ${aed(lineCost(l))} · margin ${aed(margin)}`}</p> : null}
            </Card>
          );
        })}

        {!disabled ? (
          <Card className="flex flex-col gap-3">
            <SectionLabel>Add a line</SectionLabel>
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
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "recovery", title: "Recovery" })}>+ Recovery</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "fee", title: "Fee" })}>+ Fee</Button>
            </div>
            {partAsk ? (
              <div className="rounded-control border border-line p-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Part description</span><Input value={partAsk.description} onChange={(e) => setPartAsk({ ...partAsk, description: e.target.value })} /></label>
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={partAsk.quantity} onChange={(e) => setPartAsk({ ...partAsk, quantity: e.target.value })} inputMode="decimal" className="w-24" /></label>
                <Button type="button" size="md" onClick={() => { if (partAsk.description.trim()) { save({ requestPart: { description: partAsk.description, quantity: partAsk.quantity } }); setPartAsk(null); } }}>Send to Parts</Button>
                <Button type="button" tone="ghost" size="md" onClick={() => setPartAsk(null)}>Cancel</Button>
                <p className="w-full text-xs text-muted">Parts price it and the technician confirms it; the line appears here on its own.</p>
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
                <p className="w-full text-xs text-muted">For small last-minute items. Marked &quot;Added by advisor&quot; and logged; it goes to the Parts To order list once approved.</p>
              </div>
            ) : null}
            <p className="text-xs text-muted">Parts listed by the Parts desk appear here on their own, with their cost, once the technician confirms them. Unusual work can be typed as a free line.</p>
          </Card>
        ) : null}
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
          <p className="text-xs text-muted">Parts, Other lines with a cost and Recovery never take the total discount; {lines.filter((l) => l.is_active && takesTotalDiscount(l)).length === 1 ? "1 line does" : `${lines.filter((l) => l.is_active && takesTotalDiscount(l)).length} lines do`}.</p>
          {(header.discount_percent ?? 0) > settings.discountLimit ? <p className="text-xs font-semibold text-amber">Above the {settings.discountLimit}% discount limit: the owner must approve before sending.</p> : null}
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs border-t border-line pt-2">
            <dt className="text-muted">Parts cost</dt><dd className="text-right">{aed(totals.partsCost)}</dd>
            <dt className="text-muted">Parts sold</dt><dd className="text-right">{aed(totals.partsSell)}</dd>
            <dt className="font-semibold">Parts margin</dt><dd className="text-right font-semibold">{aed(totals.partsMargin)}</dd>
            <dt className="text-muted">Labour hours</dt><dd className="text-right">{hoursText(totals.labourHours)} · {aed(totals.labourSell)}</dd>
            {totals.hiddenCost ? <><dt className="text-muted">Recovery and hidden costs</dt><dd className="text-right">{aed(totals.hiddenCost)}</dd></> : null}
            {showProfit ? (
              <>
                <dt className="text-muted">Labour cost (technician rate)</dt><dd className="text-right">{aed(totals.labourCost)}</dd>
                {totals.bankCharge ? <><dt className="text-muted">Bank charge ({settings.bankChargePercent}% of the total)</dt><dd className="text-right">{aed(totals.bankCharge)}</dd></> : null}
                <dt className="font-semibold">Profit before VAT</dt><dd className="text-right font-semibold">{aed(totals.profit)}</dd>
              </>
            ) : null}
          </dl>
          {showProfit ? (
            <label className="flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" checked={header.payment_by_card} onChange={(e) => setHeaderField({ payment_by_card: e.target.checked }, true)} disabled={disabled} className="h-4 w-4 accent-ink" />
              Customer will pay by card or payment link (bank charge counted in the profit)
            </label>
          ) : null}
        </Card>

        {isQuotation ? (
          <Card className={`flex flex-col gap-2 ${attempted && !header.promised_at ? "border-red-bar" : ""}`} id="item-promised">
            <SectionLabel>Promised date</SectionLabel>
            <p className="text-xs text-muted">The last step before sending. Suggested: the latest part delivery{suggestion.latestDelivery ? ` (${suggestion.latestDelivery})` : " (none to order)"} plus {suggestion.labourDays} working day{suggestion.labourDays === 1 ? "" : "s"} of labour.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={header.promised_at} onChange={(e) => setHeaderField({ promised_at: e.target.value }, true)} disabled={disabled} className="max-w-48" />
              {!disabled ? (
                <Button type="button" tone="secondary" size="md" onClick={() => setHeaderField({ promised_at: suggestion.date }, true)}>
                  Use {suggestion.date}
                </Button>
              ) : null}
            </div>
            {promisedTooEarly ? <p className="text-xs font-semibold text-red">Earlier than the latest part delivery date ({suggestion.latestDelivery}).</p> : null}
          </Card>
        ) : null}

        <Card className="flex flex-col gap-2">
          <SectionLabel>Note to the customer</SectionLabel>
          <Textarea value={header.customer_note} onChange={(e) => setHeaderField({ customer_note: e.target.value })} rows={3} disabled={disabled} placeholder="Shown on the customer's page (optional)" />
        </Card>

        <Card className="flex flex-col gap-3 border-ink">
          <SectionLabel>{isQuotation ? "Send the quotation" : "Send the estimate"}</SectionLabel>
          {sent ? (
            <p className="text-sm">
              {quotation.status === "sent" ? `Sent ${formatDayTime(quotation.sent_at)}, not yet opened.` : quotation.status === "opened" ? `Opened by the customer ${formatDayTime(quotation.opened_at)}.` : quotation.status === "approved" ? `Approved by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "urgent_requested" ? `${quotation.approver_name} asked for the urgent work only ${formatDayTime(quotation.responded_at)}.${quotation.customer_request_note ? ` Note: ${quotation.customer_request_note}` : ""}` : quotation.status === "declined" ? `Declined by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "expired" ? "Expired. Re-send it or revise it." : quotation.status === "superseded" ? "Replaced by a newer version." : ""}
            </p>
          ) : null}
          {!sent && blockers.length ? (
            <div className="flex flex-col gap-1">
              <span className={`text-xs font-bold ${attempted ? "text-red" : "text-muted"}`}>{attempted ? `${blockers.length} to fix before sending` : `${blockers.length} still to do`}</span>
              {attempted ? (
                <ul className="flex flex-col gap-1">
                  {blockers.map((b, i) => (
                    <li key={b.key + i}>
                      <button type="button" onClick={() => document.getElementById(`item-${b.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="text-left text-xs font-semibold text-red underline underline-offset-4">{b.label}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {!sent && !blockers.length && reasons.length && !isOwner ? <p className="text-xs font-semibold text-amber">Needs the owner&apos;s approval: {reasons.join("; ")}</p> : null}
          {canSend && !sent ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={blockers.length > 0} onBlocked={() => { setAttempted(true); const first = blockers[0]; document.getElementById(`item-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} existingToken={quotation.token} status={quotation.status} /> : null}
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

function AskPartDiscount({ onAsk }: { onAsk: (pct: number, reason: string) => void }) {
  const [pct, setPct] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Discount %</span><Input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className="w-24" /></label>
      <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Reason (logged)</span><Input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <Button type="button" tone="secondary" size="md" onClick={() => { if (Number(pct) > 0 && reason.trim()) onAsk(Number(pct), reason.trim()); }}>Ask the owner</Button>
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
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Part discount % (owner)</span><Input value={pct} onChange={(e) => { setPct(e.target.value); send(e.target.value, why); }} inputMode="decimal" className="w-24" /></label>
      <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="font-semibold text-muted">Reason (logged)</span><Input value={why} onChange={(e) => { setWhy(e.target.value); send(pct, e.target.value); }} placeholder="required for any part discount" /></label>
      {waiting ? <span className="text-amber font-semibold pb-3">Write the reason to apply it.</span> : (Number(pct) || 0) > 0 ? <span className="text-muted pb-3">Logged against this quotation.</span> : null}
    </div>
  );
}
