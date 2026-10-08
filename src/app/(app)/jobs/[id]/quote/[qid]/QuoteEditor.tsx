"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Notice, SectionLabel, Select, Textarea } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import { AVAILABILITY_LABELS, CONFIRM_LABELS, LINE_TYPES, LINE_TYPE_LABELS, aed, lineTotal, linePrice, ownerApprovalReasons, quoteTotals, sendBlockers, suggestPromisedDate, type LineType, type PartItem, type QuoteLine, type QuoteRow } from "@/lib/quotes";
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
        if (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 423) {
          queue.current.shift();
          persist();
          setError(data.error ?? "Could not save.");
          continue;
        }
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save.");
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
  return { save, state, error };
}

export type EditorSettings = {
  labourRate: number;
  minMarkup: number;
  discountLimit: number;
  approvalAbove: number;
  technicianCostRate: number | null;
  depositThreshold: number;
  depositPercent: number;
  today: string;
  workingTime: WorkingTime;
};

/**
 * The quotation builder: lines the advisor can add, edit, remove and reorder, with parts costs and
 * markup, labour hours by the rate, packages, discounts, VAT, the promised date and the send button.
 * Prices save as they are typed. Parts lines follow what Parts priced and the technician confirmed.
 */
export function QuoteEditor({
  quotation,
  lines: initialLines,
  parts,
  packages,
  settings,
  readOnly,
  showMargin,
  showProfit,
  canSend,
  isOwner,
  siteUrl,
  messageTemplate,
  phoneDigits,
  fromEstimate,
}: {
  quotation: QuoteRow;
  lines: QuoteLine[];
  parts: PartItem[];
  packages: { id: string; name: string; department: string; price_aed: number; description: string | null }[];
  settings: EditorSettings;
  readOnly: boolean;
  showMargin: boolean;
  showProfit: boolean;
  canSend: boolean;
  isOwner: boolean;
  siteUrl: string;
  messageTemplate: string;
  phoneDigits: string;
  fromEstimate: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<QuoteLine[]>(initialLines);
  const [header, setHeader] = useState({ discount_percent: quotation.discount_percent, promised_at: quotation.promised_at ?? "", customer_note: quotation.customer_note ?? "" });
  const [attempted, setAttempted] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refresh = useCallback(() => router.refresh(), [router]);
  const { save, state, error } = useQuoteAutosave(quotation.id, refresh);
  const disabled = readOnly;

  // Lines added elsewhere (Parts listing a part) arrive on refresh; keep local edits of known lines.
  const [seenLines, setSeenLines] = useState(initialLines);
  if (seenLines !== initialLines) {
    setSeenLines(initialLines);
    setLines((cur) => {
      const known = new Map(cur.map((l) => [l.id, l]));
      return initialLines.map((l) => {
        const k = known.get(l.id);
        return k ? { ...l, ...k, unit_cost: l.part_item_id ? l.unit_cost : k.unit_cost, quantity: l.part_item_id ? l.quantity : k.quantity } : l;
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
  const addLine = (fields: Partial<QuoteLine> & { package_id?: string | null }) => {
    const tempId = `tmp-${Math.random().toString(36).slice(2, 8)}`;
    const pkg = fields.package_id ? packages.find((p) => p.id === fields.package_id) : null;
    const type = (fields.line_type ?? (pkg ? "package" : "labour")) as LineType;
    setLines((prev) => [
      ...prev,
      { id: tempId, quotation_id: quotation.id, position: prev.length ? Math.max(...prev.map((l) => l.position)) + 1 : 0, line_type: type, title: pkg?.name ?? fields.title ?? "New line", details: pkg?.description ?? null, group_label: fields.group_label ?? null, source_type: pkg ? "package" : "manual", source_key: null, quantity: 1, unit_cost: null, markup_percent: type === "part" || type === "outside" ? settings.minMarkup : null, unit_price: pkg ? pkg.price_aed : null, hours: null, labour_rate: settings.labourRate, discount_percent: 0, line_total: 0, part_item_id: null, package_id: pkg?.id ?? null, customer_approved: null, is_active: true },
    ]);
    save({ addLine: { line_type: type, title: pkg?.name ?? fields.title ?? "New line", group_label: fields.group_label ?? null, package_id: fields.package_id ?? null } });
  };
  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
    if (!id.startsWith("tmp-")) save({ removeLine: { id } });
  };
  const move = (id: string, dir: -1 | 1) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      const ids = next.map((l) => l.id).filter((x) => !x.startsWith("tmp-"));
      save({ reorder: { ids } });
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
  const totals = quoteTotals(lines, q, { technicianCostRate: settings.technicianCostRate ?? 0, depositThreshold: settings.depositThreshold, depositPercent: settings.depositPercent });
  const blockers = sendBlockers(q, lines, parts, { minMarkup: () => settings.minMarkup });
  const reasons = ownerApprovalReasons(q, lines, totals, { discountLimit: settings.discountLimit, approvalAbove: settings.approvalAbove });
  const suggestion = suggestPromisedDate(lines, parts, settings.today, settings.workingTime);
  const promisedTooEarly = !!header.promised_at && !!suggestion.latestDelivery && header.promised_at < suggestion.latestDelivery;
  const partOf = (l: QuoteLine) => (l.part_item_id ? parts.find((p) => p.id === l.part_item_id) ?? null : null);
  const sent = !!quotation.sent_at || ["sent", "opened", "approved", "partly_approved", "declined", "expired", "superseded"].includes(quotation.status);
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pb-24">
      <div className="xl:col-span-2 flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {lines.length === 0 ? <Notice tone="info">No lines yet. Add labour, parts, a package, outside work or a fee below.</Notice> : null}
        {lines.map((l, i) => {
          const part = partOf(l);
          const price = linePrice(l);
          const total = lineTotal(l);
          const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
          return (
            <Card key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-3 ${blocked ? "border-red-bar" : l.customer_approved === false ? "border-line opacity-70" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-muted w-6">{i + 1}.</span>
                <Badge tone="neutral">{LINE_TYPE_LABELS[l.line_type]}</Badge>
                {l.group_label ? <span className="text-xs text-muted">· {l.group_label}</span> : null}
                {l.customer_approved === true ? <Badge tone="green">Approved by the customer</Badge> : l.customer_approved === false ? <Badge tone="red">Declined by the customer</Badge> : null}
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
                {!part ? (
                  <Select value={l.line_type} onChange={(e) => patch(l.id, { line_type: e.target.value as LineType }, true)} disabled={disabled} className="sm:w-48" aria-label="Line type">
                    {LINE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </Select>
                ) : null}
              </div>
              <Textarea value={l.details ?? ""} onChange={(e) => patch(l.id, { details: e.target.value })} rows={1} disabled={disabled} placeholder="Details shown to the customer (optional)" />
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 items-end">
                {l.line_type === "labour" ? (
                  <>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Hours</span><Input value={num(l.hours)} onChange={(e) => patch(l.id, { hours: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Rate (AED/h)</span><Input value={num(l.labour_rate)} readOnly disabled /></label>
                  </>
                ) : null}
                {l.line_type === "part" || l.line_type === "outside" ? (
                  <>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cost (AED)</span><Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || !!part} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Markup % (min {settings.minMarkup})</span><Input value={num(l.markup_percent)} onChange={(e) => patch(l.id, { markup_percent: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} className={(l.markup_percent ?? 0) < settings.minMarkup ? "border-red-bar" : ""} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled || !!part} /></label>
                  </>
                ) : null}
                {l.line_type === "package" || l.line_type === "fee" ? (
                  <>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Price (AED)</span><Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Quantity</span><Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Number(e.target.value) || 1 })} inputMode="decimal" disabled={disabled} /></label>
                  </>
                ) : null}
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Discount %</span><Input value={num(l.discount_percent)} onChange={(e) => patch(l.id, { discount_percent: Number(e.target.value) || 0 })} inputMode="decimal" disabled={disabled} className={(l.discount_percent ?? 0) > settings.discountLimit ? "border-amber-bar" : ""} /></label>
                <div className="flex flex-col gap-1 text-right">
                  <span className="text-xs font-semibold text-muted">Line total</span>
                  <span className="text-base font-extrabold">{aed(total)}</span>
                  {price !== total ? <span className="text-xs text-muted line-through">{aed(price)}</span> : null}
                </div>
              </div>
              {showMargin && (l.line_type === "part" || l.line_type === "outside") && l.unit_cost !== null ? <p className="text-xs text-muted">Margin {aed(total - (l.unit_cost ?? 0) * (l.quantity || 1))}</p> : null}
            </Card>
          );
        })}

        {!disabled ? (
          <Card className="flex flex-col gap-3">
            <SectionLabel>Add a line</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "labour", title: "Labour" })}>+ Labour</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "part", title: "Part" })}>+ Part</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "outside", title: "Outside work" })}>+ Outside work</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "fee", title: "Fee" })}>+ Fee</Button>
            </div>
            {packages.length ? (
              <label className="flex flex-col gap-1 max-w-md">
                <span className="text-xs font-semibold text-muted">Fixed-price package</span>
                <Select value="" onChange={(e) => e.target.value && addLine({ package_id: e.target.value })}>
                  <option value="">Pick a package…</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {aed(p.price_aed)}</option>
                  ))}
                </Select>
              </label>
            ) : (
              <p className="text-xs text-muted">No fixed-price packages yet. The owner adds them under Settings, Packages.</p>
            )}
            <p className="text-xs text-muted">Parts listed by the Parts team appear here on their own, with their cost, once the technician confirms them.</p>
          </Card>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <SectionLabel>Totals</SectionLabel>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Lines (after line discounts)</dt><dd className="text-right font-semibold">{aed(totals.subtotal)}</dd>
            <dt className="text-muted">Discount on the total</dt>
            <dd className="text-right">
              <span className="inline-flex items-center gap-1"><Input value={num(header.discount_percent)} onChange={(e) => setHeaderField({ discount_percent: Number(e.target.value) || 0 })} inputMode="decimal" disabled={disabled} className="w-20 text-right" aria-label="Discount percent" /> %</span>
            </dd>
            {totals.discount ? <><dt className="text-muted">Discount</dt><dd className="text-right">− {aed(totals.discount)}</dd></> : null}
            <dt className="text-muted">Before VAT</dt><dd className="text-right font-semibold">{aed(totals.net)}</dd>
            <dt className="text-muted">VAT {quotation.vat_percent}%</dt><dd className="text-right">{aed(totals.vat)}</dd>
            <dt className="font-extrabold">Total</dt><dd className="text-right text-lg font-extrabold">{aed(totals.total)}</dd>
            {totals.deposit ? <><dt className="text-muted">Deposit required</dt><dd className="text-right font-semibold">{aed(totals.deposit)}</dd></> : null}
          </dl>
          {(header.discount_percent ?? 0) > settings.discountLimit ? <p className="text-xs font-semibold text-amber">Above the {settings.discountLimit}% discount limit: the owner must approve before sending.</p> : null}
          {showMargin ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs border-t border-line pt-2">
              <dt className="text-muted">Parts cost</dt><dd className="text-right">{aed(totals.partsCost)}</dd>
              <dt className="text-muted">Parts sold</dt><dd className="text-right">{aed(totals.partsSell)}</dd>
              <dt className="font-semibold">Parts margin</dt><dd className="text-right font-semibold">{aed(totals.partsMargin)}</dd>
              <dt className="text-muted">Labour hours</dt><dd className="text-right">{totals.labourHours} h · {aed(totals.labourSell)}</dd>
              {showProfit ? (
                <>
                  <dt className="text-muted">Labour cost (technician rate)</dt><dd className="text-right">{aed(totals.labourCost)}</dd>
                  <dt className="font-semibold">Profit before VAT</dt><dd className="text-right font-semibold">{aed(totals.net - totals.partsCost - totals.labourCost)}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </Card>

        {quotation.kind === "quotation" ? (
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
          <SectionLabel>{quotation.kind === "estimate" ? "Send the estimate" : "Send the quotation"}</SectionLabel>
          {sent ? (
            <p className="text-sm">
              {quotation.status === "sent" ? `Sent ${formatDayTime(quotation.sent_at)}, not yet opened.` : quotation.status === "opened" ? `Opened by the customer ${formatDayTime(quotation.opened_at)}.` : quotation.status === "approved" ? `Approved by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "partly_approved" ? `Partly approved by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "declined" ? `Declined by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "expired" ? "Expired. Re-send it or revise it." : quotation.status === "superseded" ? "Replaced by a newer version." : ""}
            </p>
          ) : null}
          {!sent && blockers.length ? (
            <div className="flex flex-col gap-1">
              <span className={`text-xs font-bold ${attempted ? "text-red" : "text-muted"}`}>{attempted ? `${blockers.length} to fix before sending` : `${blockers.length} still to do`}</span>
              {attempted ? (
                <ul className="flex flex-col gap-1">
                  {blockers.map((b) => (
                    <li key={b.key + b.label}>
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

      {!disabled ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-full bg-ink/85 px-3 py-1 text-[11px] font-bold text-white pointer-events-none">
          {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "No connection · changes kept, will save"}
        </div>
      ) : null}
    </div>
  );
}
