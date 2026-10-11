"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PartPicker } from "@/components/PartPicker";
import { ServicePicker, type PickerKind } from "@/components/ServicePicker";
import type { CatalogueRow } from "@/lib/parts-list";
import type { QuoteReference } from "@/lib/quote-reference";
import { Badge, Button, Card, Input, Notice, SectionLabel, Textarea } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import { AVAILABILITY_LABELS, aed, blockOf, floorPrice, hasCostFloor, hoursText, isHidden, isUnchosen, lineCost, lineTotal, lineUnitPrice, ownerApprovalReasons, partTypeText, quoteTotals, recoveryTitle, sendBlockers, type PartItem, type QuoteLine, type QuoteRow, type Service, type ServiceCategory } from "@/lib/quotes";
import type { WorkingTime } from "@/lib/working-time";
import { completeQuotation, escalateParts, keepUrgentOnly, remindParts, reopenQuotation } from "@/app/(app)/quotes/actions";
import { SendQuoteControl } from "./SendQuoteControl";

type Op = Record<string, unknown>;

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
      queue.current.push({ opId: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...op });
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
  /** Settings: advisors see a small discount column on labour and service lines. */
  advisorDiscount?: boolean;
  depositThreshold: number;
  depositPercent: number;
  inspectionFee: number;
  /** The usual amount for a Consumables line when the advisor adds one (never added by itself). */
  consumablesDefault?: number;
  /** A margin at or above this shows green in the internal breakdown. */
  goodMarginPercent?: number;
  today: string;
  workingTime: WorkingTime;
};

export type RecoveryType = { key: string; label: string; cost: number; price: number };

/** What the advisor is waiting for from Parts, for the status bar and the Remind and Escalate buttons. */
export type PartsWait = { unavailable?: { label: string; note: string | null }[]; openRequests: number; partsTotal: number; partsPriced: number; waitingMinutes: number; partsNames: string; remindAfter: number; escalateAfter: number; remindedAt: string | null; escalatedAt: string | null };

type Suggestion = { id: string; title: string; hint: string; service: Service | null };

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const finishedLine = (l: QuoteLine) => (l.line_type === "labour" ? !!l.title.trim() && (l.hours ?? 0) > 0 : l.line_type === "package" ? !!l.title.trim() && (l.unit_price ?? 0) > 0 : !!l.title.trim());
const chip = (on: boolean, extra = "") => `min-h-9 rounded-control border px-2.5 text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"} ${extra}`;
const boxLabel = "flex flex-col gap-0.5 text-[11px] font-semibold text-muted";
const POSITION_CHOICES: string[][] = [["Front"], ["Rear"], ["Front", "Rear"], ["Left"], ["Right"]];

const STRIP_KEY = "erp-quote-strip";
const STRIP_EVENT = "erp-quote-strip";
/** Whether the report strip is open: remembered on this device, read in a way that never upsets the first render. */
function useStripOpen(): [boolean, () => void] {
  const open = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      window.addEventListener(STRIP_EVENT, cb);
      return () => {
        window.removeEventListener("storage", cb);
        window.removeEventListener(STRIP_EVENT, cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(STRIP_KEY) === "open";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const toggle = () => {
    try {
      localStorage.setItem(STRIP_KEY, open ? "closed" : "open");
    } catch {}
    window.dispatchEvent(new Event(STRIP_EVENT));
  };
  return [open, toggle];
}

/** Moves the cursor to the next amount box (hours or price) down the list; Enter behaves like Tab. */
function focusNextAmount(from: HTMLElement) {
  const all = Array.from(document.querySelectorAll<HTMLElement>("[data-amount]"));
  const next = all[all.indexOf(from) + 1];
  if (next) next.focus();
  else from.blur();
}

/**
 * The quotation on one page: the report folded into a strip, the labour list (labour jobs by hours
 * and services at a fixed price, picked from two lists or typed), the parts priced by Parts with
 * Include or Leave off, the other charges with recovery as one labelled row, one summary with the
 * internal breakdown, and the decision in a bar fixed to the bottom.
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
  candidates = [],
  reference = null,
  catalogue = [],
  canEditList = false,
  hoursMemory = {},
  recoveryProviders = [],
  recoveryTypes = [],
  wait = null,
  workshopEstimate = null,
  completedAt = null,
  estimatedDays = 0,
  isRevision = false,
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
  /** Names typed by hand on earlier quotations, offered under the name box. */
  candidates?: string[];
  /** The approved report, folded: requests, findings, the manager's notes. */
  reference?: QuoteReference | null;
  /** The parts pool behind "+ Add a part". */
  catalogue?: CatalogueRow[];
  canEditList?: boolean;
  hoursMemory?: Record<string, number>;
  recoveryProviders?: string[];
  recoveryTypes?: RecoveryType[];
  wait?: PartsWait | null;
  workshopEstimate?: { hours: number | null; managerHours: number | null; agreed: boolean } | null;
  completedAt?: string | null;
  estimatedDays?: number;
  isRevision?: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<QuoteLine[]>(initialLines);
  const [header, setHeader] = useState({ discount_percent: quotation.discount_percent, customer_note: quotation.customer_note ?? "" });
  const [attempted, setAttempted] = useState(false);
  const [picker, setPicker] = useState<null | { kind: PickerKind; replace?: string; sourceType?: "item" | "tyre" | "request" | null; sourceKey?: string | null; label?: string }>(null);
  const [partPicker, setPartPicker] = useState(false);
  const [skippedPositions, setSkippedPositions] = useState<Set<string>>(() => new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<null | "choose" | "saving">(null);
  /** Where the cursor goes after the next render: a new line's name box, or a filled line's hours or price box. */
  const [focusTarget, setFocusTarget] = useState<null | { id: string; field: "name" | "amount" }>(null);
  const [focusNewest, setFocusNewest] = useState<null | "name" | "amount">(null);
  const [stripOpen, toggleStrip] = useStripOpen();
  const [confirming, setConfirming] = useState<null | { op: Op; message: string }>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refresh = useCallback(() => router.refresh(), [router]);
  const onConfirm = useCallback((op: Op, message: string) => setConfirming({ op, message }), [setConfirming]);
  const { save, state, error } = useQuoteAutosave(quotation.id, refresh, onConfirm);
  const disabled = readOnly;
  const isQuotation = quotation.kind === "quotation";

  // Lines changed elsewhere (Parts pricing a part, a refused save, a new line) arrive on refresh; local edits of known lines are kept.
  const [seenLines, setSeenLines] = useState(initialLines);
  if (seenLines !== initialLines) {
    setSeenLines(initialLines);
    const knownIds = new Set(seenLines.map((l) => l.id));
    const fresh = initialLines.filter((l) => !knownIds.has(l.id) && !l.fee_kind);
    if (fresh.length && focusNewest) {
      setFocusTarget({ id: fresh[0].id, field: focusNewest });
      setFocusNewest(null);
    }
    if (fresh.length && draft) setDraft(null);
    setLines((cur) => {
      const known = new Map(cur.map((l) => [l.id, l]));
      return initialLines.map((l) => {
        const k = known.get(l.id);
        if (!k || l.fee_kind) return l;
        return { ...l, ...k, unit_cost: l.part_item_id ? l.unit_cost : k.unit_cost, quantity: l.part_item_id ? l.quantity : k.quantity, discount_percent: l.discount_percent, markup_percent: l.markup_percent, markup_confirmed: l.markup_confirmed, hours: l.hours, chosen: l.chosen, left_off: l.left_off, parent_line_id: l.parent_line_id, dangerous: l.dangerous, title: l.part_item_id ? l.title : k.title };
      });
    });
  }
  // A refused save while a new line was being added: the placeholder row goes.
  const [seenError, setSeenError] = useState(error);
  if (seenError !== error) {
    setSeenError(error);
    if (error && draft) setDraft(null);
  }
  useEffect(() => {
    if (!focusTarget) return;
    const el = document.getElementById(`${focusTarget.field}-${focusTarget.id}`) as HTMLInputElement | null;
    if (el) {
      el.focus();
      el.select?.();
    }
  }, [focusTarget]);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.("[data-line-menu]")) setMenuFor(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuFor]);

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
    // Parts stand on their own: removing a job never removes a part.
    setLines((prev) => prev.filter((l) => l.id !== id).map((l) => (l.parent_line_id === id ? { ...l, parent_line_id: null } : l)));
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
  const closeKey = (key: string) => setOpenRows((s) => { const n = new Set(s); n.delete(key); return n; });
  /** One input open under a line at a time: opening one closes the others of that line. */
  const openOnly = (lineId: string, key: string) => setOpenRows((s) => { const n = new Set(Array.from(s).filter((k) => !k.endsWith(`-${lineId}`))); n.add(key); return n; });
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
  const namedLabour = labourLines.filter((l) => l.title.trim());
  const labourDone = namedLabour.filter(finishedLine).length;
  const blockers = sendBlockers(q, lines, parts, { minMarkup: settings.minMarkup, openRequests: wait?.openRequests ?? 0, workshopEstimate, confirmPercent: settings.markupConfirm });
  const reasons = ownerApprovalReasons(q, lines, totals, { discountLimit: settings.discountLimit, approvalAbove: settings.approvalAbove });
  const partOf = (l: QuoteLine) => (l.part_item_id ? parts.find((p) => p.id === l.part_item_id) ?? null : null);
  const sent = !!quotation.sent_at || ["sent", "opened", "approved", "urgent_requested", "declined", "expired", "superseded"].includes(quotation.status);
  const completed = !!completedAt;
  const highMarkups = partLines.filter((l) => !isUnchosen(l) && (l.markup_percent ?? 0) >= settings.markupWarn);
  const fitsDept = (s: Service) => s.department === "both" || !department || department === "both" || s.department === department;
  const priceHint = (s: Service) => (s.price_aed !== null ? `${aed(s.price_aed)}${s.price_per && s.price_per !== "job" ? ` per ${s.price_per}` : ""}` : s.default_hours !== null ? hoursText(s.default_hours) : "");
  const labourSuggestions = useMemo<Suggestion[]>(() => [
    ...services.filter((s) => s.price_aed === null && fitsDept(s)).map((s) => ({ id: s.id, title: s.name, hint: priceHint(s), service: s })),
    ...candidates.map((t) => ({ id: `custom:${t}`, title: t, hint: "used before", service: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [services, candidates, department]);
  const serviceSuggestions = useMemo<Suggestion[]>(() => services.filter((s) => s.price_aed !== null && fitsDept(s)).map((s) => ({ id: s.id, title: s.name, hint: priceHint(s), service: s })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, department]);
  // The Suggested tab: services whose suggest_for keys match the report's findings.
  const referenceKeys = useMemo(() => (reference?.findings ?? []).flatMap((f) => f.keys), [reference]);
  const suggestedFor = (keys: string[]) => (keys.length ? services.filter((s) => (s.suggest_for ?? []).some((k) => keys.includes(k))) : []);
  const quotedKeys = new Set(labourLines.map((l) => `${l.source_type}:${l.source_key}`));
  const unquoted = (reference?.findings ?? []).filter((f) => !quotedKeys.has(`${f.sourceType}:${f.sourceKey}`) && (f.status === "bad" || f.dangerous));
  const canKeepUrgent = isRevision && !sent && !disabled && labourLines.some((l) => l.urgency === "urgent") && labourLines.some((l) => l.urgency !== "urgent");
  const editHref = (kind: PickerKind) => (canEditList ? `/settings/services?list=${kind === "service" ? "services" : "labour"}` : null);

  /** A picked service fills the row: the name and the pricing; a labour job keeps the hours for the advisor. */
  const applyService = (lineId: string, s: Service) => {
    const fixed = s.price_aed !== null;
    patch(lineId, { title: s.name, service_id: s.id, line_type: fixed ? "package" : "labour", unit_price: fixed ? s.price_aed : null, price_per: fixed ? (s.price_per ?? "job") : null, quantity: fixed ? Math.max(1, Math.round(Number(s.usual_quantity) || 1)) : 1, ...(!fixed ? { hours: s.default_hours ?? null } : {}) }, true);
    setFocusTarget({ id: lineId, field: "amount" });
  };
  const applyCustom = (lineId: string, title: string) => {
    const remembered = hoursMemory[title.toLowerCase()];
    patch(lineId, remembered ? { title, service_id: null, hours: remembered } : { title, service_id: null }, true);
    setFocusTarget({ id: lineId, field: "amount" });
  };
  const fromPicker = (picked: Service[], custom: string[]) => {
    const ctx = picker;
    setPicker(null);
    if (!ctx) return;
    const source = ctx.sourceType && ctx.sourceKey ? { source_type: ctx.sourceType, source_key: ctx.sourceKey } : {};
    let rest: { s?: Service; c?: string }[] = [...picked.map((s) => ({ s })), ...custom.map((c) => ({ c }))];
    if (ctx.replace && rest.length) {
      const [first, ...others] = rest;
      if (first.s) applyService(ctx.replace, first.s);
      else if (first.c) applyCustom(ctx.replace, first.c);
      rest = others;
    }
    if (rest.length) setFocusNewest("amount");
    for (const r of rest) {
      if (r.s) addLine({ service_id: r.s.id, ...source });
      else if (r.c) addLine({ line_type: ctx.kind === "service" ? "package" : "labour", title: r.c, ...source });
    }
  };
  const chooseKind = (kind: "labour" | "service") => {
    setDraft("saving");
    setFocusNewest("name");
    addLine({ line_type: kind === "labour" ? "labour" : "package", title: "" });
  };
  const switchKind = (l: QuoteLine) => {
    if (l.line_type === "labour") patch(l.id, { line_type: "package", hours: null, unit_price: null, price_per: "job", quantity: 1, service_id: null }, true);
    else patch(l.id, { line_type: "labour", unit_price: null, price_per: null, quantity: 1, service_id: null }, true);
  };
  /** One job on several positions is one row: the quantity follows for per-unit services, the hours for hourly ones with default hours. */
  const setPositions = (l: QuoteLine, positions: string[]) => {
    const svc = l.service_id ? services.find((s) => s.id === l.service_id) ?? null : null;
    const fields: Partial<QuoteLine> = { positions };
    if (l.line_type === "package" && l.price_per && l.price_per !== "job") fields.quantity = Math.max(1, positions.length);
    if (l.line_type === "labour" && svc?.default_hours && positions.length) fields.hours = Math.round(svc.default_hours * positions.length * 10) / 10;
    patch(l.id, fields, true);
    closeKey(`pos-${l.id}`);
  };
  const hoursBlur = (l: QuoteLine, raw: string) => {
    const v = raw.replace(",", ".");
    if (v === "") return;
    const h = Math.max(0.1, Math.round(Number(v) * 10) / 10);
    patch(l.id, { hours: h }, true);
  };

  /* ----- one labour or service row: name box, the amount box, the total, the three-dot menu ----- */
  const labourRow = (l: QuoteLine) => {
    const done = finishedLine(l);
    const total = lineTotal(l);
    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
    const isService = l.line_type === "package";
    const svc = l.service_id ? services.find((s) => s.id === l.service_id) ?? null : null;
    const perUnit = isService && !!l.price_per && l.price_per !== "job";
    const showQty = isService && (perUnit || !l.service_id);
    const positions = l.positions ?? [];
    const askPosition = !disabled && ((!!svc?.position_ask && !positions.length && !skippedPositions.has(l.id)) || openRows.has(`pos-${l.id}`));
    const menu = menuFor === l.id;
    const noteOpen = openRows.has(`note-${l.id}`);
    const rateOpen = openRows.has(`rate-${l.id}`);
    const discOpen = openRows.has(`disc-${l.id}`);
    const rateChanged = l.line_type === "labour" && (l.labour_rate ?? 0) !== settings.labourRate;
    const amountBox = (extra: string) => `w-16 text-right min-h-10 px-1 ${extra}`;
    return (
      <div key={l.id} id={`item-line-${l.id}`} className="flex flex-col">
        <div className="flex items-center gap-2 py-1.5 px-2 text-sm">
          <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-green text-white" : "border border-line-strong text-transparent"}`} aria-label={done ? "done" : "not done"}>✓</span>
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <NameBox
              id={`name-${l.id}`}
              value={l.title}
              kind={isService ? "service" : "labour"}
              items={isService ? serviceSuggestions : labourSuggestions}
              disabled={disabled}
              blocked={blocked && !l.title.trim()}
              onType={(t) => patch(l.id, { title: t, ...(l.service_id ? { service_id: null } : {}) })}
              onPick={(s) => (s.service ? applyService(l.id, s.service) : applyCustom(l.id, s.title))}
              onArrow={() => setPicker({ kind: isService ? "service" : "labour", replace: l.id })}
              onNext={() => setFocusTarget({ id: l.id, field: "amount" })}
            />
            {positions.length || l.dangerous || l.urgency === "urgent" || l.details || perUnit || (l.discount_percent ?? 0) > 0 || rateChanged ? (
              <span className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted">
                {positions.length ? <span>{positions.length === 2 && positions.includes("Front") && positions.includes("Rear") ? "front and rear" : positions.map((p) => p.toLowerCase()).join(", ")}</span> : null}
                {perUnit ? <span>{aed(l.unit_price ?? 0)} per {l.price_per} × {l.quantity || 1}</span> : null}
                {l.dangerous ? <Badge tone="red">Dangerous</Badge> : l.urgency === "urgent" ? <Badge tone="outline">Urgent</Badge> : null}
                {l.details ? <Badge tone="outline">Note: {l.details.length > 36 ? `${l.details.slice(0, 34)}…` : l.details}</Badge> : null}
                {(l.discount_percent ?? 0) > 0 ? <span>Discount {l.discount_percent}%</span> : null}
                {rateChanged ? <span className={(l.labour_rate ?? 0) + 0.005 < settings.labourRate ? "font-semibold text-red" : ""}>Rate {num(l.labour_rate)}</span> : null}
              </span>
            ) : null}
          </div>
          {l.line_type === "labour" ? (
            <span className="inline-flex items-center gap-1">
              <Input id={`amount-${l.id}`} data-amount value={num(l.hours)} onChange={(e) => patch(l.id, { hours: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} onBlur={(e) => hoursBlur(l, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); hoursBlur(l, e.currentTarget.value); focusNextAmount(e.currentTarget); } }} inputMode="decimal" disabled={disabled} aria-label="Hours" placeholder="0" className={amountBox(blocked && !(l.hours && l.hours > 0) ? "border-red-bar" : "")} />
              <span className="text-[11px] font-semibold text-muted">h</span>
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1">
                <Input id={`amount-${l.id}`} data-amount value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNextAmount(e.currentTarget); } }} inputMode="decimal" disabled={disabled} aria-label={perUnit ? `Price per ${l.price_per}` : "Price"} placeholder="0" className={`w-24 text-right min-h-10 px-1 ${blocked && !(l.unit_price && l.unit_price > 0) ? "border-red-bar" : ""}`} />
                <span className="text-[11px] font-semibold text-muted">AED</span>
              </span>
              {showQty ? (
                <span className="inline-flex items-center justify-end gap-1">
                  <button type="button" disabled={disabled || (l.quantity || 1) <= 1} onClick={() => patch(l.id, { quantity: Math.max(1, (l.quantity || 1) - 1) }, true)} className="h-10 w-10 rounded-control border border-line-strong font-bold disabled:opacity-40" aria-label="One less">−</button>
                  <span className="w-7 text-center font-extrabold" aria-label="Quantity">{l.quantity || 1}</span>
                  <button type="button" disabled={disabled} onClick={() => patch(l.id, { quantity: (l.quantity || 1) + 1 }, true)} className="h-10 w-10 rounded-control border border-line-strong font-bold disabled:opacity-40" aria-label="One more">+</button>
                </span>
              ) : null}
            </>
          )}
          <span className="w-24 text-right font-bold">{aed(total)}</span>
          {!disabled ? (
            <span className="relative" data-line-menu>
              <button type="button" onClick={() => setMenuFor(menu ? null : l.id)} aria-label="More for this line" aria-expanded={menu} className={`min-h-9 min-w-9 rounded-control border text-base font-bold ${menu ? "border-ink bg-ink text-white" : "border-line"}`}>
                ⋯
              </button>
              {menu ? (
                <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-card border border-line bg-white py-1 shadow-xl">
                  {!l.title.trim() ? <MenuItem label={isService ? "Switch to Labour" : "Switch to Service"} onClick={() => { setMenuFor(null); switchKind(l); }} /> : null}
                  {isQuotation && !l.dangerous ? <MenuItem label={l.urgency === "urgent" ? "Not urgent" : "Mark as urgent"} onClick={() => { setMenuFor(null); patch(l.id, { urgency: l.urgency === "urgent" ? null : "urgent" }, true); }} /> : null}
                  {l.dangerous && isOwner ? <MenuItem label="Switch the safety warning off" onClick={() => { setMenuFor(null); patch(l.id, { dangerous: false, urgency: "urgent" }, true); }} /> : null}
                  <MenuItem label={l.details ? "Change the note for the customer" : "Add a note for the customer"} onClick={() => { setMenuFor(null); openOnly(l.id, `note-${l.id}`); }} />
                  {svc?.position_ask || positions.length ? <MenuItem label="Change position" onClick={() => { setMenuFor(null); setSkippedPositions((s) => { const n = new Set(s); n.delete(l.id); return n; }); openOnly(l.id, `pos-${l.id}`); }} /> : null}
                  {l.line_type === "labour" ? <MenuItem label={isOwner ? "Change rate" : "Raise rate"} onClick={() => { setMenuFor(null); openOnly(l.id, `rate-${l.id}`); }} /> : null}
                  {isOwner || settings.advisorDiscount ? <MenuItem label={isOwner ? "Owner discount" : "Discount"} onClick={() => { setMenuFor(null); openOnly(l.id, `disc-${l.id}`); }} /> : null}
                  <MenuItem label="Remove" red onClick={() => { setMenuFor(null); removeLine(l.id); }} />
                </div>
              ) : null}
            </span>
          ) : null}
        </div>
        {askPosition ? (
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 text-xs">
            <span className="font-semibold">Front, rear or both?</span>
            {POSITION_CHOICES.map((ps) => (
              <button key={ps.join("+")} type="button" onClick={() => setPositions(l, ps)} className={chip(ps.length === positions.length && ps.every((p) => positions.includes(p)))}>
                {ps.length === 2 ? "Front and rear" : ps[0]}
              </button>
            ))}
            <button type="button" onClick={() => { setSkippedPositions((s) => new Set(s).add(l.id)); closeKey(`pos-${l.id}`); }} className="min-h-8 px-2 text-xs font-semibold text-muted underline underline-offset-4">{positions.length ? "Done" : "Skip"}</button>
          </div>
        ) : null}
        {noteOpen && !disabled ? (
          <div className="flex flex-col gap-1.5 px-2 pb-2">
            <label className={boxLabel}>Note for the customer<Textarea value={l.details ?? ""} onChange={(e) => patch(l.id, { details: e.target.value })} rows={2} placeholder="Shown under the line on the customer's page" textCase="sentence" className="min-h-16" autoFocus /></label>
            <button type="button" onClick={() => closeKey(`note-${l.id}`)} className="self-start min-h-9 rounded-control border border-line-strong bg-white px-3 text-xs font-bold">Done</button>
          </div>
        ) : null}
        {rateOpen && l.line_type === "labour" && !disabled ? (
          <div className="flex flex-wrap items-end gap-2 px-2 pb-2">
            <label className={boxLabel}>Rate per hour (standard AED {settings.labourRate})<Input value={num(l.labour_rate)} onChange={(e) => patch(l.id, { labour_rate: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" aria-label="Rate per hour" className="w-28 text-right min-h-9" autoFocus /></label>
            <button type="button" onClick={() => closeKey(`rate-${l.id}`)} className="min-h-9 rounded-control border border-line-strong bg-white px-3 text-xs font-bold">Done</button>
          </div>
        ) : null}
        {discOpen && !disabled ? (
          <div className="flex flex-wrap items-end gap-2 px-2 pb-2">
            <label className={boxLabel}>Discount %<Input value={num(l.discount_percent)} onChange={(e) => patch(l.id, { discount_percent: Number(e.target.value) || 0 })} inputMode="decimal" className="w-20 min-h-9" aria-label="Discount percent" autoFocus /></label>
            <button type="button" onClick={() => closeKey(`disc-${l.id}`)} className="min-h-9 rounded-control border border-line-strong bg-white px-3 text-xs font-bold">Done</button>
          </div>
        ) : null}
      </div>
    );
  };

  /* ----- recovery as one labelled row: type, trips, cost and price per trip; provider and Show / Hide ----- */
  const recoveryRow = (l: QuoteLine) => {
    const hidden = isHidden(l);
    const total = lineTotal(l);
    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
    const kind = l.recovery_provider_kind ?? "ours";
    const customer = kind === "customer";
    const trips = Math.max(1, Math.round(Number(l.recovery_trips ?? l.quantity) || 1));
    const more = trips >= 3 || openRows.has(`more-${l.id}`);
    const type = recoveryTypes.find((t) => t.key === l.recovery_type) ?? null;
    const title = recoveryTitle(type?.label ?? null, trips);
    const setTrips = (n: number) => patch(l.id, { recovery_trips: n, quantity: n }, true);
    const off = disabled || customer;
    return (
      <div key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-2 rounded-control border border-line px-3 py-2 ${hidden ? "bg-chip" : "bg-white"}`}>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <span className="font-bold self-center">Recovery</span>
          {recoveryTypes.length ? (
            <span className={boxLabel}>Type<span className="flex gap-1">{recoveryTypes.map((t) => <button key={t.key} type="button" disabled={off} onClick={() => patch(l.id, { recovery_type: t.key, unit_cost: Number(t.cost) || 0, unit_price: Number(t.price) || 0 }, true)} className={chip(l.recovery_type === t.key)}>{t.label}</button>)}</span></span>
          ) : null}
          <span className={boxLabel}>Trips<span className="flex items-center gap-1">
            <button type="button" disabled={off} onClick={() => { closeKey(`more-${l.id}`); setTrips(1); }} className={chip(trips === 1 && !openRows.has(`more-${l.id}`))}>One way</button>
            <button type="button" disabled={off} onClick={() => { closeKey(`more-${l.id}`); setTrips(2); }} className={chip(trips === 2 && !openRows.has(`more-${l.id}`))}>Two ways</button>
            <button type="button" disabled={off} onClick={() => { setOpenRows((s) => new Set(s).add(`more-${l.id}`)); if (trips < 3) setTrips(3); }} className={chip(more)}>More</button>
            {more ? <Input value={String(trips)} onChange={(e) => setTrips(Math.max(1, Math.round(Number(e.target.value) || 1)))} inputMode="numeric" disabled={off} aria-label="Number of trips" className="w-14 text-right min-h-9" /> : null}
          </span></span>
          <label className={boxLabel}>Cost per trip<Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={off} aria-label="Cost per trip" className={`w-24 text-right min-h-9 ${blocked && (l.unit_cost === null || l.unit_cost === undefined) ? "border-red-bar" : ""}`} /></label>
          <label className={boxLabel}>{hidden ? "Price per trip (hidden)" : "Price per trip"}<Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={off || hidden} aria-label="Price per trip" className={`w-24 text-right min-h-9 ${hidden ? "opacity-50" : ""} ${blocked && !hidden && !(l.unit_price && l.unit_price > 0) ? "border-red-bar" : ""}`} /></label>
          <span className="ml-auto w-28 text-right font-bold self-center">{aed(total)}</span>
          {!disabled ? <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 px-2 text-xs font-bold text-red self-center" aria-label="Remove">×</button> : null}
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <span className={boxLabel}>Provider<span className="flex flex-wrap items-center gap-1">
            {([["ours", "Our recovery"], ["external", "External"], ["customer", "Customer arranged"]] as const).map(([k, label]) => <button key={k} type="button" disabled={disabled} onClick={() => patch(l.id, { recovery_provider_kind: k }, true)} className={chip(kind === k)}>{label}</button>)}
            {kind === "external" ? <Input value={l.recovery_provider ?? ""} onChange={(e) => patch(l.id, { recovery_provider: e.target.value })} list="erp-recovery-providers" disabled={disabled} placeholder="Company or person" aria-label="Recovery company" className="w-44 min-h-9" /> : null}
          </span></span>
          {!customer ? (
            <span className={boxLabel}>Customer<span className="flex gap-1">
              <button type="button" disabled={disabled} onClick={() => patch(l.id, { visible_to_customer: true }, true)} className={chip(!hidden)}>Show to customer</button>
              <button type="button" disabled={disabled} onClick={() => patch(l.id, { visible_to_customer: false }, true)} className={chip(hidden)}>Hide</button>
            </span></span>
          ) : null}
        </div>
        <span className="text-xs text-muted">{customer ? "Recorded for history. No cost, no charge." : hidden ? `Hidden. Internal cost only, ${aed(lineCost(l))}.` : `Shown to the customer as "${title}", ${aed(total)}. Costs us ${aed(lineCost(l))}.`}</span>
      </div>
    );
  };

  /* ----- any other charge: one labelled row ----- */
  const otherRow = (l: QuoteLine) => {
    const hidden = isHidden(l);
    const total = lineTotal(l);
    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
    const costed = hasCostFloor(l);
    const needPrice = blocked && !hidden && !costed && !(l.unit_price && l.unit_price > 0);
    return (
      <div key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-1.5 rounded-control border border-line px-3 py-2 ${hidden ? "bg-chip" : "bg-white"}`}>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className={`${boxLabel} flex-1 min-w-48`}>Charge<Input value={l.title} onChange={(e) => patch(l.id, { title: e.target.value })} disabled={disabled} placeholder="What is it for?" aria-label="Charge" className={`min-h-9 font-semibold ${blocked && !l.title.trim() ? "border-red-bar" : ""}`} textCase="sentence" /></label>
          <label className={boxLabel}>Cost (optional)<Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} aria-label="Cost" className="w-24 text-right min-h-9" /></label>
          {costed ? (
            <label className={boxLabel}>Markup %<Input value={num(l.markup_percent)} onChange={(e) => patch(l.id, { markup_percent: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} aria-label="Markup" className="w-20 text-right min-h-9" /></label>
          ) : (
            <label className={boxLabel}>{hidden ? "Price (hidden)" : "Price"}<Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled || hidden} placeholder={needPrice ? "needed" : ""} aria-label="Price" className={`w-24 text-right min-h-9 ${hidden ? "opacity-50" : ""} ${needPrice ? "border-red-bar" : ""}`} /></label>
          )}
          <label className={boxLabel}>Qty<Input value={num(l.quantity)} onChange={(e) => patch(l.id, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} inputMode="numeric" disabled={disabled} aria-label="Quantity" className="w-14 text-right min-h-9" /></label>
          <span className={boxLabel}>Customer<span className="flex gap-1">
            <button type="button" disabled={disabled} onClick={() => patch(l.id, { visible_to_customer: true }, true)} className={chip(!hidden)}>Show</button>
            <button type="button" disabled={disabled} onClick={() => patch(l.id, { visible_to_customer: false }, true)} className={chip(hidden)}>Hide</button>
          </span></span>
          <span className="ml-auto w-28 text-right font-bold self-center">{aed(total)}</span>
          {!disabled ? <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 px-2 text-xs font-bold text-red self-center" aria-label="Remove">×</button> : null}
        </div>
        {!disabled ? <button type="button" onClick={() => setOpenRows((s) => { const n = new Set(s); const k = `details-${l.id}`; if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="self-start text-[11px] font-semibold text-muted underline underline-offset-4">{l.details ? "Note shown to the customer" : "Add a note for the customer"}</button> : null}
        {openRows.has(`details-${l.id}`) ? <Textarea value={l.details ?? ""} onChange={(e) => patch(l.id, { details: e.target.value })} rows={2} disabled={disabled} aria-label="Note for the customer" className="min-h-16" /> : null}
        {hidden ? <span className="text-xs text-muted">Hidden. Internal cost only, {aed(lineCost(l))}.</span> : null}
      </div>
    );
  };

  const margin = totals.net > 0 ? (totals.profit / totals.net) * 100 : 0;
  const marginTone = totals.profit < 0 ? "text-red" : margin >= (settings.goodMarginPercent ?? 25) ? "text-green" : "text-amber";
  const totalCost = totals.partsCost + totals.labourCost + totals.otherCost + totals.bankCharge;
  const progressText = `${labourDone} of ${namedLabour.length} line${namedLabour.length === 1 ? "" : "s"} done${wait?.partsTotal ? ` · parts ${wait.partsPriced} of ${wait.partsTotal} priced` : ""}`;
  const scrollToFirstBlocker = () => {
    setAttempted(true);
    const first = blockers[0];
    if (first) document.getElementById(`item-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pb-28">
      <div className="xl:col-span-2 flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {actionError ? <Notice tone="error">{actionError}</Notice> : null}

        {/* The report, folded into a strip: never a blocker, always one tap away */}
        {reference && isQuotation ? (
          <div className="rounded-card border border-line border-l-4 border-l-ink bg-chip">
            <button type="button" onClick={toggleStrip} aria-expanded={stripOpen} className="flex w-full flex-col gap-1 px-4 py-2.5 text-left">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">From the inspection report</span>
                <span className="rounded-full border border-line-strong bg-white px-2 py-0.5 text-[11px] font-semibold">{reference.requests.length} request{reference.requests.length === 1 ? "" : "s"}</span>
                <span className="rounded-full border border-line-strong bg-white px-2 py-0.5 text-[11px] font-semibold">{reference.findings.length} finding{reference.findings.length === 1 ? "" : "s"}</span>
                {reference.managerNote ? <span className="rounded-full border border-line-strong bg-white px-2 py-0.5 text-[11px] font-semibold">manager&apos;s note</span> : null}
                <span className="ml-auto text-base font-bold" aria-hidden>{stripOpen ? "▴" : "▾"}</span>
              </span>
              {unquoted.length && !sent ? <span className="text-xs font-semibold text-amber">Nothing quoted yet for: {unquoted.map((f) => f.label).join(" · ")}</span> : null}
            </button>
            {stripOpen ? (
              <div className="flex flex-col gap-3 border-t border-line bg-white px-4 pb-3 pt-3 text-sm rounded-b-card">
                {reference.requests.length ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">The customer says</span>
                    <ol className="list-decimal pl-5">{reference.requests.map((r, i) => <li key={i}>{r}</li>)}</ol>
                    {reference.requestsNote ? <p className="text-xs text-muted">Technician: {reference.requestsNote}</p> : null}
                  </div>
                ) : null}
                {reference.findings.length ? (
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Findings</span>
                    {reference.findings.map((f) => {
                      const quoted = quotedKeys.has(`${f.sourceType}:${f.sourceKey}`);
                      return (
                        <div key={f.sourceKey} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5">
                          <Badge tone={f.dangerous || f.status === "bad" ? "red" : "amber"}>{f.statusLabel}</Badge>
                          <span className="font-semibold">{f.label}</span>
                          {f.remark ? <span className="text-muted">{f.remark}</span> : null}
                          {quoted ? <span className="ml-auto text-xs font-semibold text-green">✓ Quoted</span> : !disabled ? <button type="button" onClick={() => setPicker({ kind: "both", sourceType: f.sourceType, sourceKey: f.sourceKey, label: f.label })} className="ml-auto min-h-9 rounded-control border border-line-strong bg-white px-2.5 text-xs font-bold">+ Add job</button> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {reference.managerNote ? <p><span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Workshop manager&apos;s note</span><br />{reference.managerNote}</p> : null}
                {reference.internalNote ? <p className="text-muted"><span className="font-semibold">For you, not the customer:</span> {reference.internalNote}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Block 1: labour jobs and services */}
        <Card className="flex flex-col gap-3">
          <SectionLabel right={progressText.split(" · ")[0]}>Labour and services</SectionLabel>
          <div className="rounded-control border border-line">
            <div className="divide-y divide-line">
              {labourLines.map(labourRow)}
              {draft ? (
                <div className="flex items-center gap-2 px-2 py-2 text-sm">
                  <span className="inline-flex h-5 w-5 shrink-0 rounded-full border border-line-strong" aria-hidden />
                  {draft === "choose" ? (
                    <>
                      <span className="text-muted">New line:</span>
                      <button type="button" onClick={() => chooseKind("labour")} className={chip(false, "min-h-10 px-4")}>Labour</button>
                      <button type="button" onClick={() => chooseKind("service")} className={chip(false, "min-h-10 px-4")}>Service</button>
                      <button type="button" onClick={() => setDraft(null)} className="ml-auto min-h-9 px-2 text-xs font-semibold text-muted underline underline-offset-4">Cancel</button>
                    </>
                  ) : (
                    <span className="text-muted">Adding…</span>
                  )}
                </div>
              ) : null}
            </div>
            {labourLines.length === 0 && !draft ? <p className="px-2 py-2 text-sm text-muted">No lines yet. Tap + Add line.</p> : null}
          </div>
          {!disabled ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button type="button" size="md" onClick={() => setDraft("choose")} disabled={draft === "saving"}>+ Add line</Button>
              {isQuotation ? <Button type="button" tone="secondary" size="md" onClick={() => setPartPicker(true)}>+ Add a part</Button> : null}
            </div>
          ) : null}
          {workshopEstimate && workshopEstimate.hours !== null ? (
            <p className={`text-xs ${totals.labourHours + 0.05 < (workshopEstimate.managerHours ?? workshopEstimate.hours ?? 0) ? "font-semibold text-amber" : "text-muted"}`}>
              Workshop estimate {workshopEstimate.managerHours ?? workshopEstimate.hours} h{workshopEstimate.agreed ? "" : " (not yet agreed by the manager)"} · quoted {hoursText(totals.labourHours)}{totals.labourHours + 0.05 < (workshopEstimate.managerHours ?? workshopEstimate.hours ?? 0) ? " · lower than the workshop estimate" : ""}
            </p>
          ) : null}
        </Card>

        {/* Block 2: parts, priced by Parts; the advisor sets the markup and Include or Leave off */}
        <Card className="flex flex-col gap-3">
          <SectionLabel right={wait?.partsTotal ? `${wait.partsPriced} of ${wait.partsTotal} priced` : undefined}>Parts</SectionLabel>
          {partLines.length && !disabled ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className={boxLabel}>Markup for every part (min {settings.minMarkup}%)<Input id="markup-all" defaultValue={String(settings.minMarkup)} inputMode="decimal" className="w-28 min-h-9" /></label>
              <Button type="button" tone="secondary" size="md" onClick={() => { const v = Number((document.getElementById("markup-all") as HTMLInputElement | null)?.value); if (!Number.isFinite(v)) return; for (const l of partLines) if (!isUnchosen(l)) patch(l.id, { markup_percent: Math.max(settings.minMarkup, v) }, true); }}>Apply to all</Button>
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
                    <th className="py-1 pr-2 text-right">Total</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {partLines.map((l) => {
                    const part = partOf(l);
                    const leftOff = !!l.left_off;
                    const optionOff = !!l.option_group && l.chosen === false;
                    const unchosen = leftOff || optionOff;
                    const total = lineTotal(l);
                    const floor = floorPrice(l, settings.minMarkup);
                    const belowFloor = !unchosen && total + 0.005 < floor;
                    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
                    const markup = l.markup_percent ?? 0;
                    const high = markup >= settings.markupWarn;
                    return (
                      <tr key={l.id} id={`item-line-${l.id}`} className={unchosen ? "opacity-50" : ""}>
                        <td className="py-2 pr-2 align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {l.option_group ? <input type="radio" name={`opt-${l.option_group}`} checked={!optionOff} onChange={() => choose(l.option_group!, l.id)} disabled={disabled || leftOff} className="h-4 w-4 accent-ink" aria-label="Use this option" /> : null}
                            <span className="font-semibold">{l.title}</span>
                            {l.positions?.length ? <span className="text-xs text-muted">{l.positions.join(", ")}</span> : null}
                            {partTypeText(l) ? <Badge tone="outline">{partTypeText(l)}</Badge> : null}
                            {leftOff ? <Badge tone="neutral">Left off</Badge> : null}
                            {part?.cost_aed === null && !leftOff ? <Badge tone="amber">Waiting for the price</Badge> : null}
                            {high && !unchosen ? <Badge tone={markup >= settings.markupConfirm ? "red" : "amber"}>{markup >= settings.markupConfirm ? (l.markup_confirmed ? "Very high markup, confirmed" : "Confirm the markup") : "High markup, check before sending"}</Badge> : null}
                          </div>
                          {optionOff ? <span className="block text-[11px] text-muted">Option, not used</span> : null}
                        </td>
                        <td className="py-2 pr-2 align-top text-xs text-muted">{part?.availability ? `${AVAILABILITY_LABELS[part.availability]}${part.delivery_date ? ` ${part.delivery_date}` : ""}` : ""}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.quantity}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.unit_cost === null ? "" : aed(l.unit_cost)}</td>
                        <td className="py-2 pr-2 align-top text-right">
                          <Input value={num(l.markup_percent)} onChange={(e) => patch(l.id, { markup_percent: e.target.value === "" ? null : Number(e.target.value) })} onBlur={(e) => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < settings.minMarkup) patch(l.id, { markup_percent: settings.minMarkup }, true); }} inputMode="decimal" disabled={disabled || unchosen} className={`w-20 text-right min-h-9 ${markup < settings.minMarkup || belowFloor || blocked ? "border-red-bar" : high ? "border-amber-bar" : ""}`} aria-label="Markup percent" />
                        </td>
                        <td className="py-2 pr-2 align-top text-right">{aed(lineUnitPrice(l))}</td>
                        <td className="py-2 pr-2 align-top text-right font-bold">
                          {aed(total)}
                          {isOwner && !disabled && !unchosen ? (
                            <details className="text-[11px] font-normal text-left">
                              <summary className="cursor-pointer text-muted">Owner discount{(l.discount_percent ?? 0) > 0 ? ` ${l.discount_percent}%` : ""}</summary>
                              <OwnerPartDiscount percent={l.discount_percent ?? 0} reason={l.discount_reason ?? ""} onChange={(pct, reason) => patch(l.id, { discount_percent: pct, discount_reason: reason })} />
                            </details>
                          ) : (l.discount_percent ?? 0) > 0 ? <span className="block text-[11px] font-normal text-muted">Discount {l.discount_percent}%</span> : null}
                          {belowFloor ? <span className="block text-[11px] font-bold text-red">Below the minimum</span> : null}
                        </td>
                        <td className="py-2 align-top text-right">
                          {!disabled && isQuotation ? (
                            leftOff ? (
                              <button type="button" onClick={() => patch(l.id, { left_off: false }, true)} className="min-h-9 rounded-control bg-ink px-2.5 text-xs font-bold text-white whitespace-nowrap">Put back</button>
                            ) : (
                              <button type="button" onClick={() => patch(l.id, { left_off: true }, true)} className="min-h-9 rounded-control border border-line px-2.5 text-xs font-semibold text-muted whitespace-nowrap">Leave off</button>
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {partLines.some((l) => l.left_off) ? <p className="text-xs text-muted">A part left off stays on the car&apos;s list, counts for nothing here and is not ordered. Put back with one tap.</p> : null}
          {!isQuotation && !disabled ? <div><Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "part", title: "Part", quantity: 1 })}>+ Part (estimate)</Button></div> : null}
        </Card>

        {/* Block 3: other charges */}
        <Card className="flex flex-col gap-3">
          <SectionLabel>Other charges</SectionLabel>
          {otherLines.length === 0 ? <p className="text-sm text-muted">Recovery and any other charge sit here. The bank charge is automatic.</p> : null}
          <div className="flex flex-col gap-2">
            {otherLines.map((l) => {
              if (l.fee_kind === "bank_charge") {
                return (
                  <div key={l.id} className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted">
                    <span className="flex-1 min-w-48">{l.title} · internal, never shown to the customer</span>
                    <span className="w-28 text-right font-semibold">{aed(totals.bankCharge)}</span>
                  </div>
                );
              }
              if (l.line_type === "recovery") return recoveryRow(l);
              return otherRow(l);
            })}
          </div>
          {!disabled ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {!otherLines.some((l) => l.line_type === "recovery") ? <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "recovery" })}>+ Recovery</Button> : null}
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "other", title: "" })}>+ Other charge</Button>
              {!otherLines.some((l) => /consumables/i.test(l.title)) ? <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "other", title: "Consumables", unit_price: settings.consumablesDefault || null })}>+ Consumables</Button> : null}
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
            {totals.rounding ? <><dt className="text-muted">{totals.rounding < 0 ? "Discount (rounding)" : "Rounding"}</dt><dd className="text-right">{totals.rounding < 0 ? "− " : ""}{aed(Math.abs(totals.rounding))}</dd></> : null}
            <dt className="text-muted">VAT {quotation.vat_percent}%</dt><dd className="text-right">{aed(totals.vat)}</dd>
            <dt className="font-extrabold">Grand total</dt><dd className="text-right text-lg font-extrabold">{aed(totals.total)}</dd>
            {totals.deposit ? <><dt className="text-muted">Deposit required</dt><dd className="text-right font-semibold">{aed(totals.deposit)}</dd></> : null}
          </dl>
          {(header.discount_percent ?? 0) > settings.discountLimit ? <p className="text-xs font-semibold text-amber">Above the {settings.discountLimit}% discount limit: the owner must approve before sending.</p> : null}
          {showProfit ? (
            <div className="flex flex-col gap-1 rounded-control bg-chip p-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Internal (not shown to the customer)</span>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
                <dt className="text-muted">Parts cost</dt><dd className="text-right">{aed(totals.partsCost)}</dd>
                <dt className="text-muted">Labour at cost ({hoursText(totals.labourHours)} × AED {settings.technicianCostRate ?? 0})</dt><dd className="text-right">{aed(totals.labourCost)}</dd>
                <dt className="text-muted">Recovery cost</dt><dd className="text-right">{aed(totals.recoveryCost)}</dd>
                <dt className="text-muted">Other internal costs</dt><dd className="text-right">{aed(totals.otherCost - totals.recoveryCost)}</dd>
                <dt className="text-muted">Bank charge ({settings.bankChargePercent}% of the total with VAT, estimated)</dt><dd className="text-right">{aed(totals.bankCharge)}</dd>
                <dt className="font-semibold border-t border-line pt-1">Total cost</dt><dd className="text-right font-semibold border-t border-line pt-1">{aed(totalCost)}</dd>
                <dt className="font-bold">Profit before VAT</dt><dd className={`text-right font-bold ${marginTone}`}>{aed(totals.profit)} · {margin.toFixed(1)}%</dd>
                <dt className="text-muted">Labour margin</dt><dd className="text-right">{aed(totals.labourMargin)}</dd>
                <dt className="text-muted">Parts margin</dt><dd className="text-right">{aed(totals.partsMargin)}</dd>
              </dl>
            </div>
          ) : null}
          {isQuotation ? <p className="text-xs text-muted">Estimated: about {estimatedDays} working day{estimatedDays === 1 ? "" : "s"} after approval. The firm date is set in planning.</p> : null}
          {highMarkups.length ? <p className="text-xs font-semibold text-amber">{highMarkups.length} part{highMarkups.length === 1 ? "" : "s"} with a high markup: check before sending.</p> : null}
        </Card>

        {wait && isQuotation && !sent ? (
          <Card className={`flex flex-col gap-2 ${wait.openRequests || wait.partsPriced < wait.partsTotal || wait.unavailable?.length ? "border-amber-bar" : ""}`}>
            <SectionLabel>Parts</SectionLabel>
            {wait.unavailable?.length ? (
              <div className="rounded-control bg-amber-soft px-3 py-2 text-xs">
                <span className="font-extrabold text-amber">Not available from Parts:</span>
                <ul className="mt-1 flex flex-col gap-0.5">{wait.unavailable.map((u, i) => <li key={i}><span className="font-semibold">{u.label}</span>{u.note ? <span className="text-muted"> · {u.note}</span> : null}</li>)}</ul>
                <span className="text-muted">Offer the customer another way, or leave it off.</span>
              </div>
            ) : null}
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
          <Textarea value={header.customer_note} onChange={(e) => setHeaderField({ customer_note: e.target.value })} rows={2} disabled={disabled} placeholder="Shown on the customer's page (optional)" aria-label="Note to the customer" />
        </Card>

        <Card className="flex flex-col gap-2" id="item-parts">
          <SectionLabel>{sent ? (isQuotation ? "Sent" : "Estimate sent") : "Before sending"}</SectionLabel>
          {sent ? (
            <p className="text-sm">
              {quotation.status === "sent" ? `Sent ${formatDayTime(quotation.sent_at)}, not yet opened.` : quotation.status === "opened" ? `Opened by the customer ${formatDayTime(quotation.opened_at)}.` : quotation.status === "approved" ? `Approved by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.` : quotation.status === "declined" ? `Declined by ${quotation.approver_name} ${formatDayTime(quotation.responded_at)}.${quotation.declined_note ? ` "${quotation.declined_note}"` : ""}` : quotation.status === "expired" ? "Expired. Re-send it or revise it." : quotation.status === "superseded" ? "Replaced by a newer version." : ""}
            </p>
          ) : null}
          {!sent && !completed && blockers.length ? (
            <ul className="flex flex-col gap-1">
              {blockers.map((b, i) => (
                <li key={b.key + i}>
                  <button type="button" onClick={() => { setAttempted(true); document.getElementById(`item-${b.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className={`text-left text-xs font-semibold underline underline-offset-4 ${attempted ? "text-red" : "text-muted"}`}>{b.label}</button>
                </li>
              ))}
            </ul>
          ) : null}
          {!sent && !completed && !blockers.length ? <p className="text-xs text-green font-semibold">✓ Nothing blocks it. Finish it in the bar below.</p> : null}
          {canKeepUrgent ? (
            <button type="button" disabled={pending} onClick={() => { if (window.confirm("Keep only the lines marked Urgent, and their parts? The rest is removed from this version.")) run(() => keepUrgentOnly(quotation.id)); }} className="self-start text-xs font-semibold underline underline-offset-4">Keep urgent lines only</button>
          ) : null}
          {!sent && completed ? (
            <>
              <p className="text-xs text-muted">Complete {formatDayTime(completedAt)}. Any change reopens it.</p>
              {!blockers.length && reasons.length && !isOwner ? <p className="text-xs font-semibold text-amber">Needs the owner&apos;s approval: {reasons.join("; ")}</p> : null}
              {!disabled ? <button type="button" className="self-start text-xs font-semibold underline underline-offset-4" onClick={() => run(() => reopenQuotation(quotation.id))}>Reopen to change</button> : null}
            </>
          ) : null}
          {fromEstimate && !sent ? <p className="text-xs text-muted">From an accepted estimate: if nothing changed, confirm it below instead of sending again.</p> : null}
        </Card>
      </div>

      {picker ? (
        <ServicePicker
          kind={picker.kind}
          title={picker.replace ? undefined : picker.label ? `Add a job for: ${picker.label}` : undefined}
          categories={categories}
          services={services}
          usage={usage}
          department={department}
          suggested={suggestedFor(picker.sourceKey ? (reference?.findings.find((f) => f.sourceKey === picker.sourceKey)?.keys ?? []) : referenceKeys)}
          onDone={fromPicker}
          editHref={editHref(picker.kind)}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {partPicker ? (
        <PartPicker
          title="Add a part"
          catalogue={catalogue}
          selected={[]}
          itemKey={null}
          source="custom"
          onDone={(entries) => {
            for (const e of entries) save({ requestPart: { description: e.name, quantity: e.qty, positions: e.positions, catalogue_id: e.catalogue_id, source_type: null, source_key: null } });
            setPartPicker(false);
          }}
          onClose={() => setPartPicker(false)}
        />
      ) : null}
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

      {/* The decision, in a slim bar fixed to the bottom: finish, then send; afterwards the state and Send again */}
      {!disabled || (sent && canSend) ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white px-4 py-2.5">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
            {!disabled ? <span className={`text-[11px] font-bold ${state === "offline" ? "text-amber" : "text-muted"}`}>{state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "No connection · changes kept, will save"}</span> : null}
            {!sent ? <span className="text-xs font-semibold">{progressText}</span> : <span className="text-xs font-semibold">{quotation.status === "sent" ? "Sent, not yet opened" : quotation.status === "opened" ? "Opened by the customer" : quotation.status === "approved" ? "Approved" : quotation.status === "declined" ? "Declined" : quotation.status === "expired" ? "Expired" : quotation.status === "urgent_requested" ? "Urgent work asked for" : "Sent"}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {!sent && !completed && !disabled ? (
                <Button type="button" size="md" className={blockers.length ? "opacity-60" : ""} disabled={pending} onClick={() => { if (blockers.length) { scrollToFirstBlocker(); return; } run(() => completeQuotation(quotation.id)); }}>
                  {pending ? "Checking…" : isQuotation ? "Quotation complete" : "Estimate complete"}
                </Button>
              ) : null}
              {!sent && completed && canSend ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={blockers.length > 0} onBlocked={scrollToFirstBlocker} existingToken={quotation.token} status={quotation.status} total={totals.total} roundedTotal={quotation.rounded_total_aed} compact /> : null}
              {canSend && sent && quotation.token && (quotation.status === "sent" || quotation.status === "opened") ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={false} onBlocked={() => {}} existingToken={quotation.token} status={quotation.status} total={totals.total} roundedTotal={quotation.rounded_total_aed} again /> : null}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The name box of a line: type freely with matching items from that kind's list suggested underneath,
 * or tap the small arrow at the end to open that kind's picker. Enter takes the top match or moves on.
 */
function NameBox({ id, value, kind, items, disabled, blocked, onType, onPick, onArrow, onNext }: { id: string; value: string; kind: "labour" | "service"; items: Suggestion[]; disabled: boolean; blocked: boolean; onType: (text: string) => void; onPick: (s: Suggestion) => void; onArrow: () => void; onNext: () => void }) {
  const [focus, setFocus] = useState(false);
  const q = value.trim().toLowerCase();
  const shown = focus && q.length >= 2 ? items.filter((j) => j.title.toLowerCase().includes(q) && j.title.toLowerCase() !== q).slice(0, 8) : [];
  return (
    <div className="relative min-w-0">
      <div className={`flex items-center rounded-control border bg-white focus-within:border-ink ${blocked ? "border-red-bar" : "border-line-strong"}`}>
        <input
          id={id}
          value={value}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (shown[0] && shown[0].title.toLowerCase().startsWith(q)) onPick(shown[0]);
            else onNext();
          }}
          disabled={disabled}
          placeholder={kind === "labour" ? "Labour job: type, or tap the arrow" : "Service: type, or tap the arrow"}
          aria-label={kind === "labour" ? "Labour job" : "Service"}
          spellCheck
          lang="en"
          autoComplete="off"
          className="min-h-10 min-w-0 flex-1 bg-transparent px-2.5 text-sm font-semibold outline-none disabled:text-muted"
        />
        {!disabled ? <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onArrow} aria-label={kind === "labour" ? "Open the labour jobs list" : "Open the services list"} className="min-h-10 min-w-10 border-l border-line text-sm font-bold hover:bg-canvas">▾</button> : null}
      </div>
      {shown.length ? (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-card border border-line bg-white shadow-xl">
          {shown.map((j) => (
            <button key={j.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(j)} className="flex w-full min-h-10 items-center justify-between gap-2 px-3 text-left text-sm hover:bg-canvas">
              <span className="font-semibold truncate">{j.title}</span>
              <span className="shrink-0 text-[11px] text-muted">{j.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One line of the three-dot menu. */
function MenuItem({ label, onClick, red = false }: { label: string; onClick: () => void; red?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`block w-full min-h-10 px-3 text-left text-sm hover:bg-canvas ${red ? "font-bold text-red" : "font-semibold"}`}>
      {label}
    </button>
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
