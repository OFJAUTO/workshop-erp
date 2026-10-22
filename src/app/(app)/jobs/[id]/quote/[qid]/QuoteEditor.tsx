"use client";

import type { QuoteLock } from "@/lib/quote-lock";
import { LockedQuote } from "./LockedQuote";
import { lineIsTint } from "@/lib/tint";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PartPicker } from "@/components/PartPicker";
import { ServicePicker, type PickerKind } from "@/components/ServicePicker";
import { goesWithOffers, positionsWords, type CatalogueRow, type PartsListEntry } from "@/lib/parts-list";
import { ReasonChips } from "@/components/ReasonChips";
import { FloatingMenu } from "@/components/FloatingMenu";
import { packageCostEstimate } from "@/lib/package-cost";
import { CUT_METHODS, lineIsPpf } from "@/lib/ppf-cut";
import { ESTIMATED_COMPLETION, packageDetailsText, packageSnapshot, toSnapshot, type BodyshopPackage } from "@/lib/packages";
import { WARRANTY_CHOICES, isBatteryPart } from "@/lib/battery";
import type { QuoteReference } from "@/lib/quote-reference";
import { Badge, Button, Card, Input, Notice, SectionLabel, Textarea } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import { refreshWhenIdle } from "@/lib/refresh-idle";
import { customerAvailabilityWords, daysFromDate } from "@/lib/parts-rows";
import { INTERNAL_ONLY_LABEL, effectiveMarkupPercent, markupBoth, markupFromSell, minimumMarkupAed, marginToneOf, aed, blockOf, complimentaryWord, discountLabelOf, estimateLineSuspect, floorPrice, isComplimentary, isFixedService, labourDiscountOf, pinnedRank, hasCostFloor, hoursText, isHidden, isUnchosen, lineCost, lineTotal, lineUnitPrice, ownerApprovalReasons, partTypeText, quoteTotals, recoveryTitle, round2, sendBlockers, type LineType, type PartItem, type QuoteLine, type QuoteRow, type Service, type ServiceCategory , hasPackageLine } from "@/lib/quotes";
import type { WorkingTime } from "@/lib/working-time";
import { addMissingParts,completeQuotation, escalateParts, keepUrgentOnly, remindParts, reopenQuotation, saveCustomService, setCustomerPartName, setPartWarranty } from "@/app/(app)/quotes/actions";
import { SendQuoteControl } from "./SendQuoteControl";
import { CommissionLine } from "./CommissionLine";

type Op = Record<string, unknown>;

/** Every change goes to the server at once, through a queue kept in the browser so nothing typed is lost. A 409 asks the person to confirm first. */
function useQuoteAutosave(quotationId: string, onSaved: () => void, onConfirm: (op: Op, message: string) => void) {
  const key = `erp-quote-queue-${quotationId}`;
  const queue = useRef<Op[]>([]);
  const busy = useRef(false);
  const [state, setState] = useState<"saved" | "saving" | "offline">("saved");
  const [error, setError] = useState<string | null>(null);
  /** Ops the server refused: kept with their message, retried per line with one tap, never dropped. */
  const [failed, setFailed] = useState<(Op & { failMessage?: string })[]>([]);
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
          setFailed((fl) => [...fl, { ...op, failMessage: data.error ?? "Could not save." }]);
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
  const retryFailed = useCallback(
    (op: Op) => {
      setFailed((fl) => fl.filter((x) => x !== op));
      const { failMessage: _m, ...clean } = op as Op & { failMessage?: string };
      void _m;
      queue.current.push(clean);
      persist();
      void flush();
    },
    [flush, persist],
  );
  return { save, state, error, failed, retryFailed };
}

export type EditorSettings = {
  labourRate: number;
  minMarkup: number;
  markupWarn: number;
  markupConfirm: number;
  discountLimit: number;
  approvalAbove: number;
  technicianCostRate: number | null;
  /** The bodyshop labour rate (AED/h): installer-hour estimates cost this in the internal box. */
  bodyshopRate?: number;
  /** The suppliers' own charges on this car (courier, freight) from the Parts page: an internal cost. */
  supplierCharges?: { total: number; words: string };
  /** What installers really took on this model before (closed jobs): the hint beside the estimate. */
  installerHistory?: { jobs: number; avgHours: number } | null;
  bankChargePercent: number;
  /** The card and payment-link rates: the expected payment method picks one of them, live on the screen. */
  bankRateCard?: number;
  bankRateLink?: number;
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
  /** One-tap reasons from Settings, by place (the owner's discount on a part). */
  reasons?: Record<string, string[]>;
  /** People we pay commission to (Settings), for the one-tap choices in the internal box. */
  commissionPeople?: string[];
  /** The quote profit colours (Settings): yellow below, red below. */
  marginYellow?: number;
  marginRed?: number;
  /** The hours the technicians clocked on this job once the work is done; labour at cost switches to them. */
  clockedHours?: number | null;
  /** Bodyshop packages have no fixed price: the last price typed for each, shown as a small hint. */
  lastPrices?: Record<string, number>;
  /** Average REAL cost per package key from past closed jobs (owner data; advisors see only the colour). */
  packageCost?: Record<string, number>;
  /** The usual battery warranty (Settings), shown as the ticked choice until the advisor picks another. */
  batteryWarrantyMonths?: number;
  /** Section 7: the package cost estimate numbers (film, tint, ceramic, consumables, hours, rate). */
  costing?: import("@/lib/quote-data").PackageCosting;
  /** Section 10: the optional bespoke hand-cut surcharge (Settings, 0 = none). */
  handcutSurcharge?: number;
};

export type RecoveryType = { key: string; label: string; cost: number; price: number };

/** What the advisor is waiting for from Parts, for the status bar and the Remind and Escalate buttons. */
export type PartsWait = { unavailable?: { label: string; note: string | null }[]; openRequests: number; partsTotal: number; partsPriced: number; waitingMinutes: number; partsNames: string; remindAfter: number; escalateAfter: number; remindedAt: string | null; escalatedAt: string | null };

type Suggestion = { id: string; title: string; hint: string; service: Service | null };

const HANDCUT_SURCHARGE_TITLE = "Bespoke hand-cut surcharge";
const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const finishedLine = (l: QuoteLine) => (isComplimentary(l) ? !!l.title.trim() : l.line_type === "labour" ? !!l.title.trim() && (l.hours ?? 0) > 0 : l.line_type === "package" ? !!l.title.trim() && (l.unit_price ?? 0) > 0 : !!l.title.trim());
const chip = (on: boolean, extra = "") => `min-h-9 rounded-control border px-2.5 text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"} ${extra}`;
const boxLabel = "flex flex-col gap-0.5 text-[11px] font-semibold text-muted";
/** One job on several positions: front, rear, both; a pair or all four for paired jobs (control arms, discs); or one side. */
const POSITION_CHOICES: string[][] = [["Front"], ["Rear"], ["Front", "Rear"], ["Front left", "Front right"], ["Rear left", "Rear right"], ["Front left", "Front right", "Rear left", "Rear right"], ["Left"], ["Right"]];
const positionChoiceLabel = (ps: string[]) => {
  const w = positionsWords(ps);
  return w === "front pair" ? "Front pair" : w === "rear pair" ? "Rear pair" : w === "all four" ? "All four" : w === "front and rear" ? "Front and rear" : ps[0];
};

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
  packages,
  settings,
  readOnly,
  isOwner,
  showProfit,
  canSend,
  siteUrl,
  shortLink = null,
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
  onRevise = null,
  onAskRevise = null,
  revision = null,
  reviseReasons = [],
  ownerBox = null,
  tintBox = null,
  autoSend = false,
  autoOpenPackages = false,
  completedAt = null,
  estimatedDays = 0,
  isRevision = false,
  lockedBy = null,
  lock = null,
}: {
  quotation: QuoteRow;
  lines: QuoteLine[];
  parts: PartItem[];
  categories: ServiceCategory[];
  services: Service[];
  usage: Record<string, number>;
  department: string | null;
  /** Bodyshop packages from Settings, for "+ Add a package". */
  packages?: BodyshopPackage[];
  settings: EditorSettings;
  readOnly: boolean;
  /** Approved by the customer (or replaced, or invoiced): every figure as text, the one action in the bar. */
  lock?: QuoteLock | null;
  isOwner: boolean;
  showProfit: boolean;
  canSend: boolean;
  siteUrl: string;
  /** The short address for the quotation link (erp.ofjauto.com/m/xxxx). */
  shortLink?: string | null;
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
  /** "Revise quotation" in the bottom bar once the quotation was sent. */
  onRevise?: ((formData: FormData) => Promise<void>) | null;
  /** The customer approved: the advisor asks the owner for one revision (greyed Revise). */
  onAskRevise?: ((formData: FormData) => Promise<void>) | null;
  /** The revision request and the owner's answer, for the words in the bar. */
  revision?: { requestedAt: string | null; requestedBy: string | null; reason: string | null; allowedAt: string | null; declinedAt: string | null; declinedNote: string | null } | null;
  /** One-tap reasons for the revision request (Settings). */
  reviseReasons?: string[];
  /** The owner's approval box (above the limit) or the revision request, shown under "Before sending". */
  ownerBox?: ReactNode;
  /** Section 11: the tint specification box, shown under the labour and services while a line is tint work. */
  tintBox?: ReactNode;
  /** Arriving from "send the revised quotation": complete and open the send window by itself. */
  autoSend?: boolean;
  /** Section 6: a bodyshop estimate lands with the package picker already open. */
  autoOpenPackages?: boolean;
  completedAt?: string | null;
  estimatedDays?: number;
  isRevision?: boolean;
  /** Someone else holds the editing lock: read only until they leave. */
  lockedBy?: string | null;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<QuoteLine[]>(initialLines);
  /** Lines with a change typed but not yet confirmed by a refresh: the screen's values win over the server's for them. */
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [lockLive, setLockLive] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [header, setHeader] = useState({ discount_percent: quotation.discount_percent, customer_note: quotation.customer_note ?? "", expected_payment_method: quotation.expected_payment_method ?? "not_sure", discount_kind: quotation.discount_kind ?? null, discount_value: quotation.discount_value ?? null, discount_scope: quotation.discount_scope ?? "labour", commission_to: quotation.commission_to ?? null, materials_cost_aed: Number(quotation.materials_cost_aed) || 0, commission_kind: quotation.commission_kind ?? null, commission_value: quotation.commission_value ?? null, commission_status: (quotation.commission_status as "pending" | "approved" | "declined" | null) ?? (quotation.commission_to ? "approved" : null), deposit_mode: quotation.deposit_mode ?? "none", deposit_value: quotation.deposit_value ?? null, film_rolls_est: quotation.film_rolls_est ?? null });
  const [discountOpen, setDiscountOpen] = useState(false);
  /** "Markup for every part … Apply to all": as a percentage of the cost, or a fixed AED per part. */
  const [allMode, setAllMode] = useState<"percent" | "aed">("percent");
  const [removeAsk, setRemoveAsk] = useState<{ id: string; parts: number } | null>(null);
  const [markupAsk, setMarkupAsk] = useState<string | null>(null);
  const [lowAsk, setLowAsk] = useState<string | null>(null);
  /** A price typed as 0: ask whether the line is Complimentary / Included (the PPF package pattern). */
  const [compAsk, setCompAsk] = useState<string | null>(null);
  const [depositAsk, setDepositAsk] = useState<string | null>(null);
  // The battery warranty picked on a battery line (12, 24, 36 months), kept here until the page refreshes.
  const [warranty, setWarrantyMap] = useState<Record<string, number>>({});
  const pickWarranty = (partId: string, months: number) => {
    setWarrantyMap((p) => ({ ...p, [partId]: months }));
    run(() => setPartWarranty(partId, months));
  };
  // "Rename for the customer" on a part line: the supplier name and the part number never change.
  const [renamePart, setRenamePart] = useState<{ lineId: string; partId: string; value: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const saveCustomerName = () => {
    if (!renamePart) return;
    const { lineId, partId, value } = renamePart;
    setRenameError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("name", value);
      const r = await setCustomerPartName(partId, fd);
      if (r.error) {
        setRenameError(r.error);
        return;
      }
      setLines((prev) => prev.map((x) => (x.id === lineId ? { ...x, title: r.title ?? x.title } : x)));
      setDirty((d) => new Set(d).add(lineId));
      setRenamePart(null);
      refresh();
    });
  };
  const [reviseAsk, setReviseAsk] = useState(false);
  // The answers already given on the way to "complete" (markup, parts, deposit): carried into the next check.
  const skips = useRef<{ skipMarkup?: boolean; skipParts?: boolean; skipDeposit?: boolean; lowProfitOk?: boolean }>({});
  const [partsAsk, setPartsAsk] = useState<{ message: string; missing: string[] } | null>(null);
  // "Minimum 5%": shown for a moment under a markup that was typed below the minimum and put back.
  const [minFlags, setMinFlags] = useState<Set<string>>(() => new Set());
  const flagMin = (id: string) => { setMinFlags((s) => new Set(s).add(id)); setTimeout(() => setMinFlags((s) => { const x = new Set(s); x.delete(id); return x; }), 4000); };
  const [attempted, setAttempted] = useState(false);
  const [picker, setPicker] = useState<null | { kind: PickerKind; replace?: string; sourceType?: "item" | "tyre" | "request" | null; sourceKey?: string | null; label?: string }>(null);
  const [partPicker, setPartPicker] = useState(false);
  const [skippedPositions, setSkippedPositions] = useState<Set<string>>(() => new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // "Merge with another labour line": the picked line's hours join the target, the line itself goes.
  const [mergeFor, setMergeFor] = useState<string | null>(null);
  // "+ Add a package": the bodyshop package chooser, with the only-if ticks (sunroof and friends).
  const [packageAsk, setPackageAsk] = useState(autoOpenPackages && (packages?.length ?? 0) > 0);
  const [draft, setDraft] = useState<null | "choose" | "saving">(null);
  /** Where the cursor goes after the next render: a new line's name box, or a filled line's hours or price box. */
  const [focusTarget, setFocusTarget] = useState<null | { id: string; field: "name" | "amount" }>(null);
  const [focusNewest, setFocusNewest] = useState<null | "name" | "amount">(null);
  const [stripOpen, toggleStrip] = useStripOpen();
  const [confirming, setConfirming] = useState<null | { op: Op; message: string }>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Never under someone's fingers: the refresh waits until the typing stops.
  const refresh = useCallback(() => {
    setDirty(new Set());
    refreshWhenIdle(() => router.refresh());
  }, [router]);
  const onConfirm = useCallback((op: Op, message: string) => setConfirming({ op, message }), [setConfirming]);
  const { save, state, error, failed, retryFailed } = useQuoteAutosave(quotation.id, refresh, onConfirm);
  /** New lines drawn on screen before the server answers: kept through refreshes until the server row arrives. */
  const pendingNew = useRef<Set<string>>(new Set());
  /** Section 11: the line order on screen while a reorder save is in flight (the merge keeps it until the server echoes it). */
  const localOrder = useRef<string[] | null>(null);
  const failedOf = (lineId: string) => failed.filter((o) => ((o.patchLine as { id?: string } | undefined)?.id === lineId) || ((o.addLine as { id?: string } | undefined)?.id === lineId) || ((o.removeLine as { id?: string } | undefined)?.id === lineId));
  const failChip = (lineId: string) => {
    const ops = failedOf(lineId);
    if (!ops.length) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 px-2 py-0.5 text-[11px] font-semibold text-red" data-line-not-saved={lineId}>
        <span>Not saved{(ops[0] as { failMessage?: string }).failMessage ? ` – ${(ops[0] as { failMessage?: string }).failMessage}` : ""}</span>
        <button type="button" onClick={() => ops.forEach((o) => retryFailed(o))} className="min-h-7 rounded-control border border-red-bar px-2 font-bold" data-line-retry={lineId}>Retry</button>
      </div>
    );
  };
  const lockedName = lockedBy ?? lockLive;
  const disabled = readOnly || !!lockedName;
  const depositOn = !!header.deposit_mode && header.deposit_mode !== "none";
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
      const serverIds = new Set(initialLines.map((l) => l.id));
      const out = initialLines.map((l) => {
        const k = known.get(l.id);
        if (!k || l.fee_kind) return l;
        if (pendingNew.current.has(l.id)) return dirty.has(l.id) ? { ...l, ...k } : l;
        if (dirty.has(l.id)) return { ...l, ...k };
        return { ...l, ...k, unit_cost: l.part_item_id ? l.unit_cost : k.unit_cost, quantity: l.part_item_id ? l.quantity : k.quantity, discount_percent: l.discount_percent, markup_percent: l.markup_percent, markup_confirmed: l.markup_confirmed, hours: l.hours, chosen: l.chosen, left_off: l.left_off, parent_line_id: l.parent_line_id, dangerous: l.dangerous, title: l.part_item_id ? l.title : k.title };
      });
      for (const l of cur) if (!serverIds.has(l.id) && pendingNew.current.has(l.id)) out.push(l);
      for (const id of Array.from(pendingNew.current)) if (serverIds.has(id)) pendingNew.current.delete(id);
      // Section 11: while a reorder is on its way to the server, the local order stands; once the server
      // echoes the same order the note is dropped and the server leads again.
      if (localOrder.current) {
        const rank = new Map(localOrder.current.map((id, i) => [id, i]));
        out.sort((a, b) => (rank.get(a.id) ?? 9e3) - (rank.get(b.id) ?? 9e3));
        const serverSays = initialLines.filter((l) => rank.has(l.id)).map((l) => l.id).join(",");
        const localSays = localOrder.current.filter((id) => serverIds.has(id)).join(",");
        if (serverSays === localSays) localOrder.current = null;
      }
      return out;
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
  // The editing lock: taken every half minute while this screen is open, released on leaving.
  useEffect(() => {
    if (readOnly || lockedBy) return;
    const call = (lock: "take" | "release") => fetch("/api/quote/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotationId: quotation.id, lock }), keepalive: true });
    const beat = () => {
      call("take").then(async (res) => {
        if (res.status === 423) {
          const data = (await res.json().catch(() => ({}))) as { lockedBy?: string };
          setLockLive(data.lockedBy ?? "Someone");
        } else if (res.ok) setLockLive(null);
      }).catch(() => null);
    };
    beat();
    const t = setInterval(beat, 30000);
    const release = () => { void call("release"); };
    window.addEventListener("pagehide", release);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [quotation.id, readOnly, lockedBy]);
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
    setDirty((s) => (s.has(id) ? s : new Set(s).add(id)));
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)));
    const op = () => ({ patchLine: { id, ...fields } });
    if (immediate) save(op());
    else debounced(`line-${id}-${Object.keys(fields).join(",")}`, op);
  };
  const addLine = (fields: Partial<QuoteLine> & { service_id?: string | null }) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
    if (!id) {
      save({ addLine: fields });
      return;
    }
    // The line appears the moment the button is tapped; the save carries the same id, so the server's
    // row (service price and hours filled in) slides underneath it on the next refresh.
    const svc = fields.service_id ? services.find((x) => x.id === fields.service_id) ?? null : null;
    const type = (fields.line_type as LineType | undefined) ?? (svc ? ((svc.line_kind ? svc.line_kind === "service" : svc.price_aed !== null) || svc.bodyshop_kind ? "package" : "labour") : "labour");
    const maxPos = Math.max(0, ...lines.filter((l) => l.line_type !== "fee").map((l) => Number(l.position) || 0));
    const optimistic: QuoteLine = {
      id, quotation_id: quotation.id, position: maxPos + 1, line_type: type,
      title: (fields.title ?? svc?.name ?? "").toString(), details: fields.details ?? svc?.description ?? null,
      package_key: fields.package_key ?? null, package_items: fields.package_items ?? null,
      group_label: fields.group_label ?? null, source_type: fields.source_type ?? "manual", source_key: fields.source_key ?? null,
      quantity: fields.quantity ?? (type === "package" ? Math.max(1, Math.round(Number(svc?.usual_quantity) || 1)) : 1),
      unit_cost: fields.unit_cost ?? null, markup_percent: fields.markup_percent ?? null,
      unit_price: fields.unit_price ?? (svc && svc.price_aed !== null ? Number(svc.price_aed) : null),
      hours: fields.hours ?? (svc && svc.default_hours !== null ? Number(svc.default_hours) : null),
      labour_rate: fields.labour_rate ?? settings.labourRate ?? null,
      discount_percent: 0, discount_reason: null, line_total: 0, part_item_id: null, package_id: null,
      service_id: fields.service_id ?? null, price_per: fields.price_per ?? (type === "package" ? (svc?.price_per ?? "job") : null),
      visible_to_customer: fields.visible_to_customer ?? true, urgency: fields.urgency ?? null,
      advisor_added: false, customer_approved: null, is_active: true, part_type: null, brand: null,
      option_group: null, chosen: true, fee_kind: null,
      recovery_trips: fields.recovery_trips ?? (type === "recovery" ? 1 : null), recovery_provider: null,
      dangerous: fields.dangerous ?? false, parent_line_id: fields.parent_line_id ?? null,
      recovery_provider_kind: type === "recovery" ? "ours" : null, markup_confirmed: false,
      positions: fields.positions ?? null, left_off: false, outside_work: fields.outside_work ?? false,
      recovery_type: fields.recovery_type ?? null, recovery_paid_by: type === "recovery" ? "customer" : null,
      recovery_mention_free: false, hours_estimate: null, revised_from_line_id: null,
      film_colour: null, film_code: null, tint_percent: null,
    };
    pendingNew.current.add(id);
    setLines((prev) => [...prev, optimistic]);
    setFocusTarget({ id, field: optimistic.title ? "amount" : "name" });
    save({ addLine: { id, ...fields } });
  };
  /** Removing a job with parts under it asks once ("Also remove its parts?", default Yes); on its own, the parts stay on the quotation. */
  /** Section 10: choosing the cut; Hand-cut adds the optional surcharge line (Settings), the others take it off. */
  const chooseCut = (l: QuoteLine, key: "hand" | "machine" | "mixed") => {
    patch(l.id, { cut_method: key, ...(key === "mixed" ? {} : { cut_note: null }) }, true);
    const surcharge = settings.handcutSurcharge ?? 0;
    const existing = lines.find((x) => x.is_active && x.title === HANDCUT_SURCHARGE_TITLE);
    if (key === "hand" && surcharge > 0 && !existing) addLine({ line_type: "package", title: HANDCUT_SURCHARGE_TITLE, unit_price: surcharge, quantity: 1, price_per: "job" } as Partial<QuoteLine>);
    if (key !== "hand" && existing) removeLine(existing.id);
  };
  const removeLine = (id: string) => {
    const kids = lines.filter((l) => l.is_active && l.parent_line_id === id && blockOf(l) === "parts" && !l.left_off);
    if (kids.length) { setRemoveAsk({ id, parts: kids.length }); return; }
    doRemove(id, false);
  };
  const doRemove = (id: string, withParts: boolean) => {
    setLines((prev) => prev.filter((l) => l.id !== id && !(withParts && l.parent_line_id === id)).map((l) => (l.parent_line_id === id ? { ...l, parent_line_id: null } : l)));
    save({ removeLine: { id, withParts } });
    setRemoveAsk(null);
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
  // The estimated bank charge follows how the customer is expected to pay: card or "not sure" at the card rate, the payment link at its rate, cash, cheque and bank transfer at nothing.
  const expectedMethod = header.expected_payment_method;
  const liveRate = expectedMethod === "link" ? (settings.bankRateLink ?? settings.bankChargePercent) : expectedMethod === "cash" || expectedMethod === "cheque" || expectedMethod === "transfer" ? 0 : (settings.bankRateCard ?? settings.bankChargePercent);
  const totals = quoteTotals(lines, q, { technicianCostRate: settings.technicianCostRate ?? 0, depositThreshold: settings.depositThreshold, depositPercent: settings.depositPercent, bankChargePercent: liveRate, clockedHours: settings.clockedHours ?? null, bodyshopRate: settings.bodyshopRate ?? 0, supplierCharges: settings.supplierCharges?.total ?? 0 });
  const countedForDiscount = lines.filter((l) => l.is_active && !isUnchosen(l) && !l.left_off);
  const discountBases = {
    labour: labourDiscountOf(countedForDiscount, { discount_percent: 0, vat_percent: 5, discount_kind: "percent", discount_value: 0, discount_scope: "labour" }).base,
    labour_services: labourDiscountOf(countedForDiscount, { discount_percent: 0, vat_percent: 5, discount_kind: "percent", discount_value: 0, discount_scope: "labour_services" }).base,
  };
  const labourLines = lines.filter((l) => l.is_active && blockOf(l) === "labour");
  const partLines = lines.filter((l) => l.is_active && blockOf(l) === "parts");
  const otherLines = lines.filter((l) => l.is_active && blockOf(l) === "other");

  /* ----- Section 11: the jobs can be put in the customer's order - drag the ⋮⋮ handle, the ↑ ↓, or the menu.
     The list renumbers itself and every customer document follows the same order (lines load by position). ----- */
  const labourIdsRef = useRef<string[]>([]);
  const restIdsRef = useRef<string[]>([]);
  // Written after every render so the drag listeners (which outlive a render) always see the fresh order.
  useEffect(() => {
    labourIdsRef.current = labourLines.map((x) => x.id);
    restIdsRef.current = lines.filter((x) => x.is_active && !x.fee_kind && blockOf(x) !== "labour").map((x) => x.id);
  });
  const setVisualOrder = (ids: string[]) => {
    localOrder.current = ids;
    const rank = new Map(ids.map((id, i) => [id, i]));
    setLines((prev) => [...prev].sort((a, b) => (rank.get(a.id) ?? 9e3) - (rank.get(b.id) ?? 9e3)));
  };
  const moveLine = (l: QuoteLine, to: "up" | "down" | "top") => {
    const jobs = [...labourIdsRef.current];
    const i = jobs.indexOf(l.id);
    const j = to === "top" ? 0 : to === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= jobs.length || j === i) return;
    jobs.splice(i, 1);
    jobs.splice(j, 0, l.id);
    const ids = [...jobs, ...restIdsRef.current];
    setVisualOrder(ids);
    save({ reorder: { ids } });
  };
  /** The ⋮⋮ handle: hold and move over another row; the row follows the finger or mouse, one save at the end. */
  const startDrag = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (disabled) return;
    e.preventDefault();
    let moved = false;
    const move = (ev: PointerEvent) => {
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest?.('[id^="item-line-"]') as HTMLElement | null;
      const overId = el ? el.id.slice("item-line-".length) : null;
      if (!overId || overId === id) return;
      const jobs = [...labourIdsRef.current];
      const from = jobs.indexOf(id);
      const to = jobs.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      jobs.splice(from, 1);
      jobs.splice(to, 0, id);
      moved = true;
      setVisualOrder([...jobs, ...restIdsRef.current]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (moved && localOrder.current) save({ reorder: { ids: localOrder.current } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const namedLabour = labourLines.filter((l) => l.title.trim());
  const labourDone = namedLabour.filter(finishedLine).length;
  const blockers = sendBlockers(q, lines, parts, { minMarkup: settings.minMarkup, openRequests: wait?.openRequests ?? 0, workshopEstimate, confirmPercent: settings.markupConfirm });
  const reasons = ownerApprovalReasons(q, lines, totals, { discountLimit: settings.discountLimit, approvalAbove: settings.approvalAbove });
  const partOf = (l: QuoteLine) => (l.part_item_id ? parts.find((p) => p.id === l.part_item_id) ?? null : null);
  const sent = !!quotation.sent_at || ["sent", "opened", "approved", "urgent_requested", "declined", "expired", "superseded"].includes(quotation.status);
  const completed = !!completedAt;
  /** Quotation complete, with the one-time markup reminder when every part is still at the minimum markup. */
  const completeNow = (skipMarkup: boolean, skipParts = false, skipDeposit = false, lowProfitOk = false) => run(async () => {
    if (skipMarkup) skips.current.skipMarkup = true;
    if (lowProfitOk) skips.current.lowProfitOk = true;
    if (skipParts) skips.current.skipParts = true;
    if (skipDeposit) skips.current.skipDeposit = true;
    const r = await completeQuotation(quotation.id, { ...skips.current });
    if (r.ask === "low_profit") { setLowAsk(r.message ?? "This profit is very low. Are you sure you want to send?"); return { ok: true }; }
    if (r.ask === "markup") { setMarkupAsk(r.message ?? "Parts markup is still at the minimum. Set it now?"); return { ok: true }; }
    if (r.ask === "parts") { setPartsAsk({ message: r.message ?? "Priced parts are missing from the quote", missing: r.missing ?? [] }); return { ok: true }; }
    if (r.ask === "deposit") { setDepositAsk(r.message ?? "No deposit on this quote. Send without a deposit?"); return { ok: true }; }
    if (r.ok) skips.current = {};
    return r;
  });
  /** "Add them": the missing priced parts join the quotation, then the completion runs again. */
  const addMissingNow = () => run(async () => {
    setPartsAsk(null);
    const a = await addMissingParts(quotation.id);
    if (a.error) return a;
    const r = await completeQuotation(quotation.id, { ...skips.current });
    if (r.ask === "low_profit") { setLowAsk(r.message ?? "This profit is very low. Are you sure you want to send?"); return { ok: true }; }
    if (r.ask === "markup") { setMarkupAsk(r.message ?? "Parts markup is still at the minimum. Set it now?"); return { ok: true }; }
    if (r.ask === "parts") { setPartsAsk({ message: r.message ?? "Priced parts are missing from the quote", missing: r.missing ?? [] }); return { ok: true }; }
    if (r.ask === "deposit") { setDepositAsk(r.message ?? "No deposit on this quote. Send without a deposit?"); return { ok: true }; }
    if (r.ok) skips.current = {};
    return r;
  });
  // Arriving from "send the revised quotation": complete it (when not yet) so the send window can open.
  useEffect(() => {
    if (autoSend && !sent && !completed && !disabled) completeNow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Parts that go with a quoted part (a wear sensor with brake pads): offered to the advisor, never added by themselves.
  const partOffers = isQuotation && !disabled
    ? goesWithOffers(
        partLines.filter((l) => !isUnchosen(l)).map((l): PartsListEntry => ({ id: l.id, catalogue_id: null, name: (partOf(l)?.description ?? l.title).replace(/\s*\([^)]*\)\s*$/, ""), qty: l.quantity || 1, positions: l.positions ?? [], item_key: null, source: "custom", note: null, unit: "pc" })),
        catalogue,
      )
    : [];
  const fitsDept = (s: Service) => s.department === "both" || !department || department === "both" || s.department === department;
  const priceHint = (s: Service) => (s.price_aed !== null ? `${aed(s.price_aed)}${s.price_per && s.price_per !== "job" ? ` per ${s.price_per}` : ""}` : s.default_hours !== null ? hoursText(s.default_hours) : "");
  const labourSuggestions = useMemo<Suggestion[]>(() => [
    ...services.filter((s) => !isFixedService(s) && fitsDept(s)).sort((a, b) => pinnedRank(a.name) - pinnedRank(b.name)).map((s) => ({ id: s.id, title: s.name, hint: priceHint(s), service: s })),
    ...candidates.map((t) => ({ id: `custom:${t}`, title: t, hint: "used before", service: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [services, candidates, department]);
  const serviceSuggestions = useMemo<Suggestion[]>(() => services.filter((s) => isFixedService(s) && fitsDept(s)).sort((a, b) => pinnedRank(a.name) - pinnedRank(b.name)).map((s) => ({ id: s.id, title: s.name, hint: priceHint(s), service: s })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, department]);
  // The Suggested tab: services whose suggest_for keys match the report's findings.
  const referenceKeys = useMemo(() => (reference?.findings ?? []).flatMap((f) => f.keys), [reference]);
  const suggestedFor = (keys: string[]) => (keys.length ? services.filter((s) => (s.suggest_for ?? []).some((k) => keys.includes(k))) : []);
  const quotedKeys = new Set(labourLines.map((l) => `${l.source_type}:${l.source_key}`));
  const unquoted = (reference?.findings ?? []).filter((f) => !quotedKeys.has(`${f.sourceType}:${f.sourceKey}`) && (f.status === "bad" || f.dangerous));
  // Bad road test items with no job yet are named with the findings.
  const roadUnquoted = (reference?.roadTest.flagged ?? []).filter((f) => f.status === "bad" && !quotedKeys.has(`item:road:${f.key}`));
  const unquotedLabels = [...unquoted.map((f) => f.label), ...roadUnquoted.map((f) => `${f.label} (road test)`)];
  const canKeepUrgent = isRevision && !sent && !disabled && labourLines.some((l) => l.urgency === "urgent") && labourLines.some((l) => l.urgency !== "urgent");
  const editHref = (kind: PickerKind) => (canEditList ? `/settings/services?list=${kind === "service" ? "services" : "labour"}` : null);

  /** A picked service fills the row: the name and the pricing; a labour job keeps the hours for the advisor. */
  const applyService = (lineId: string, s: Service) => {
    const fixed = isFixedService(s);
    // A bodyshop package: a service line with no price until the advisor types it (the last price shows as a hint).
    if (!fixed && s.bodyshop_kind) {
      patch(lineId, { title: s.name, service_id: s.id, line_type: "package", unit_price: null, price_per: "job", quantity: 1 }, true);
      setFocusTarget({ id: lineId, field: "amount" });
      return;
    }
    patch(lineId, { title: s.name, service_id: s.id, line_type: fixed ? "package" : "labour", outside_work: fixed && !!s.outside_work, unit_price: fixed ? s.price_aed : null, price_per: fixed ? (s.price_per ?? "job") : null, quantity: fixed ? Math.max(1, Math.round(Number(s.usual_quantity) || 1)) : 1, ...(!fixed ? { hours: s.default_hours ?? null } : {}) }, true);
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
    for (const r of rest) {
      if (r.s) addLine({ service_id: r.s.id, ...source });
      else if (r.c) addLine({ line_type: ctx.kind === "service" ? "package" : "labour", title: r.c, ...source });
    }
  };
  const chooseKind = (kind: "labour" | "service") => {
    setDraft(null);
    addLine({ line_type: kind === "labour" ? "labour" : "package", title: "" });
  };
  /** Labour (hours × rate) ↔ Fixed price (qty × price), on any line: the customer's figure is carried across, and a fixed line counts no hours anywhere. */
  const switchKind = (l: QuoteLine) => {
    const rate = l.labour_rate ?? settings.labourRate ?? 0;
    if (l.line_type === "labour") {
      const total = round2((l.hours ?? 0) * rate * (1 - (l.discount_percent ?? 0) / 100)) || null;
      patch(l.id, { line_type: "package", hours: null, hours_estimate: null, unit_price: total, price_per: "job", quantity: 1, service_id: null }, true);
    } else {
      // Never below the standard rate for the car (the server would refuse the whole change).
      const backRate = Math.max(rate, settings.labourRate ?? 0) || null;
      const total = lineTotal(l);
      const hours = backRate && total > 0 ? round2(total / backRate) : null;
      patch(l.id, { line_type: "labour", unit_price: null, price_per: null, quantity: 1, hours, labour_rate: backRate, service_id: null }, true);
    }
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
    // Two decimals: "10.25" is kept as typed.
    const h = Math.max(0.1, Math.round(Number(v) * 100) / 100);
    if (h !== l.hours) patch(l.id, { hours: h }, true);
  };
  /** The AED/h box: the finished rate is saved on leaving the box (the server keeps it at or above the standard rate for advisors). */
  const rateBlur = (l: QuoteLine, raw: string) => {
    const v = raw.replace(",", ".");
    if (v === "") return;
    const r = Math.max(0, round2(Number(v)));
    if (r !== l.labour_rate) patch(l.id, { labour_rate: r }, true);
  };

  /* ----- one labour or service row: name box, the amount box, the total, the three-dot menu ----- */
  const labourRow = (l: QuoteLine, index: number) => {
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
    // An Est. h over 50 is not hours (the rate was typed there once): amber on the line, the quoted hours stand in.
    const estSuspect = showProfit && estimateLineSuspect(l);
    // Section 13: an internal cost only (film, consumables): never on a customer document, its cost still counted.
    const internal = l.visible_to_customer === false;
    const amountBox = (extra: string) => `w-16 text-right min-h-10 px-1 ${extra}`;
    return (
      <div key={l.id} id={`item-line-${l.id}`} className="flex flex-col">
        {failChip(l.id)}
        <div className="flex flex-wrap items-center gap-2 py-1.5 px-2 text-sm">
          {!disabled && labourLines.length > 1 ? (
            <span
              onPointerDown={(e) => startDrag(e, l.id)}
              className="inline-flex h-10 w-5 shrink-0 cursor-grab touch-none select-none items-center justify-center text-[13px] font-extrabold leading-none tracking-[-0.18em] text-muted"
              aria-label="Drag to reorder"
              title="Drag to reorder"
              data-drag-handle={l.id}
            >
              ⋮⋮
            </span>
          ) : null}
          <span className="w-5 shrink-0 text-right text-[11px] font-bold text-muted" aria-hidden>{index + 1}</span>
          <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-green text-white" : "border border-line-strong text-transparent"}`} aria-label={done ? "done" : "not done"}>✓</span>
          <div className="flex-1 min-w-[12rem] flex flex-col gap-0.5">
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
            {svc?.bodyshop_kind === "coloured_ppf" || svc?.bodyshop_kind === "tint" || (isService && svc?.bodyshop_kind && !l.unit_price && settings.lastPrices?.[svc.id]) ? (
              <span className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted" data-bodyshop-detail>
                {svc?.bodyshop_kind === "coloured_ppf" ? (<><Input value={l.film_colour ?? ""} onChange={(e) => patch(l.id, { film_colour: e.target.value })} placeholder="Film colour" disabled={disabled} className="min-h-8 w-32 text-xs" textCase="title" aria-label="Film colour" data-film-colour /><Input value={l.film_code ?? ""} onChange={(e) => patch(l.id, { film_code: e.target.value })} placeholder="Code" disabled={disabled} className="min-h-8 w-24 text-xs" textCase="upper" aria-label="Film code" data-film-code /></>) : null}
                {svc?.bodyshop_kind === "tint" ? <button type="button" onClick={() => document.querySelector("[data-tint-box]")?.scrollIntoView({ behavior: "smooth", block: "center" })} className="min-h-8 font-semibold underline underline-offset-4" data-tint-goto>Darkness per window: Tint specification below</button> : null}
                {isService && svc?.bodyshop_kind && !l.unit_price && settings.lastPrices?.[svc.id] ? <span data-last-price>Last time {aed(settings.lastPrices[svc.id])}</span> : null}
              </span>
            ) : null}
            {l.package_items ? <span className="whitespace-pre-line px-1 text-[11px] leading-relaxed text-muted" data-package-items>{packageDetailsText(l.package_items)}</span> : null}
            {lineIsPpf(l, svc?.bodyshop_kind ?? null) ? (
              // Section 10: the PPF cutting method, approved with the quotation and printed under the PPF item.
              <span className="flex flex-wrap items-center gap-1.5 px-1 pt-0.5" data-cut-method={l.cut_method ?? "hand"}>
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">PPF cut</span>
                {CUT_METHODS.map((c) => {
                  const on = (l.cut_method ?? "hand") === c.key;
                  return (
                    <button key={c.key} type="button" disabled={disabled} aria-pressed={on} onClick={() => chooseCut(l, c.key)} className={chip(on, "min-h-8")} data-cut-chip={c.key}>
                      {c.chip}{c.recommended ? " · Recommended" : ""}
                    </button>
                  );
                })}
                {(l.cut_method ?? "hand") === "mixed" ? <Input value={l.cut_note ?? ""} onChange={(e) => patch(l.id, { cut_note: e.target.value })} placeholder="Which panels are pre-cut?" disabled={disabled} className="min-h-8 text-xs" style={{ width: "14rem" }} aria-label="Mixed cut note" data-cut-note-box /> : null}
                {(settings.handcutSurcharge ?? 0) > 0 && (l.cut_method ?? "hand") === "hand" && !lines.some((x) => x.is_active && x.title === HANDCUT_SURCHARGE_TITLE) ? <span className="text-[11px] text-amber">Hand-cut surcharge AED {settings.handcutSurcharge} not on the quotation yet: tap Hand-cut to add it.</span> : null}
              </span>
            ) : null}
            {positions.length || l.dangerous || l.urgency === "urgent" || l.details || perUnit || (l.discount_percent ?? 0) > 0 || estSuspect || internal ? (
              <span className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted">
                {internal ? <span data-internal-badge><Badge tone="neutral">Internal cost only · not on the customer&apos;s documents</Badge></span> : null}
                {positions.length ? <span>{positions.length === 2 && positions.includes("Front") && positions.includes("Rear") ? "front and rear" : positions.map((p) => p.toLowerCase()).join(", ")}</span> : null}
                {perUnit ? <span>{aed(l.unit_price ?? 0)} per {l.price_per} × {l.quantity || 1}</span> : null}
                {l.dangerous ? <Badge tone="red">Dangerous</Badge> : l.urgency === "urgent" ? <Badge tone="outline">Urgent</Badge> : null}
                {l.details ? <Badge tone="outline">Note: {l.details.length > 36 ? `${l.details.slice(0, 34)}…` : l.details}</Badge> : null}
                {(l.discount_percent ?? 0) > 0 ? <span>Discount {l.discount_percent}%</span> : null}
                {estSuspect ? <span className="font-semibold text-amber" data-estimate-warning>Check Est. h: {num(l.hours_estimate)} is not hours (the rate is {num(l.labour_rate)} AED/h). Labour at cost uses the quoted {hoursText(l.hours)} until it is fixed.</span> : null}
              </span>
            ) : null}
          </div>
          <span className="w-full inline-flex flex-wrap items-center justify-end gap-2 pl-12">
          {l.line_type === "labour" ? (
            /* Three separate things, each labelled: the hours quoted to the customer, our internal estimate (Est. h, profit
               viewers only), and the hourly rate in AED/h. The estimate label never sits on the rate box. */
            <span className="inline-flex shrink-0 flex-wrap items-center gap-2" data-labour-boxes>
              <label className="inline-flex items-center gap-1 whitespace-nowrap" title="The hours quoted to the customer">
                <span className="text-[10px] font-semibold text-muted">Hours</span>
                {/* The shared input style is full width, so each of the three boxes carries its own width. */}
                <Input id={`amount-${l.id}`} data-amount value={num(l.hours)} onChange={(e) => patch(l.id, { hours: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} onBlur={(e) => hoursBlur(l, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); hoursBlur(l, e.currentTarget.value); focusNextAmount(e.currentTarget); } }} inputMode="decimal" disabled={disabled} aria-label="Hours" placeholder="0" style={{ width: "4.5rem" }} className={amountBox(blocked && !(l.hours && l.hours > 0) && !isComplimentary(l) ? "border-red-bar" : "")} />
                <span className="text-[11px] font-semibold text-muted">h</span>
              </label>
              {showProfit ? (
                <label className="inline-flex items-center gap-1 whitespace-nowrap" title="Our internal estimate of the hours, never shown to the customer: labour at cost is worked out from it (then from the hours clocked)">
                  <span className={`text-[10px] font-semibold ${estSuspect ? "text-amber" : "text-muted"}`}>Est. h</span>
                  <Input value={num(l.hours_estimate ?? l.hours)} onChange={(e) => patch(l.id, { hours_estimate: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} onBlur={(e) => { const v = e.target.value.replace(",", "."); if (v === "") return; const h = Math.max(0.1, Math.round(Number(v) * 100) / 100); if (h !== (l.hours_estimate ?? l.hours)) patch(l.id, { hours_estimate: h }, true); }} inputMode="decimal" disabled={disabled} aria-label="Estimated hours (internal)" style={{ width: "4.5rem", ...(estSuspect ? { borderColor: "var(--color-amber-bar)", backgroundColor: "var(--color-amber-soft)" } : {}) }} className={`text-right min-h-10 px-1 text-xs ${estSuspect ? "text-amber font-bold" : "text-muted"}`} data-estimate data-estimate-suspect={estSuspect ? "1" : undefined} />
                </label>
              ) : null}
              <label className="inline-flex items-center gap-1 whitespace-nowrap" title={`The hourly rate charged to the customer (standard AED ${settings.labourRate})`}>
                <Input value={num(l.labour_rate)} onChange={(e) => patch(l.id, { labour_rate: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} onBlur={(e) => rateBlur(l, e.target.value)} inputMode="decimal" disabled={disabled} aria-label="Rate per hour" placeholder={String(settings.labourRate)} style={{ width: "5rem" }} className={`text-right min-h-10 px-1 text-xs ${(l.labour_rate ?? 0) + 0.005 < settings.labourRate ? "border-red-bar text-red" : ""}`} data-rate />
                <span className="text-[10px] font-semibold text-muted">AED/h</span>
              </label>
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1">
                <Input id={`amount-${l.id}`} data-amount value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} onBlur={(e) => { const raw = e.target.value.trim(); if (raw !== "" && Number(raw.replace(",", ".")) === 0 && !isComplimentary(l) && l.fee_kind !== "bank_charge") setCompAsk(l.id); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNextAmount(e.currentTarget); } }} inputMode="decimal" disabled={disabled} aria-label={perUnit ? `Price per ${l.price_per}` : "Price"} placeholder="0" className={`w-24 text-right min-h-10 px-1 ${blocked && !(l.unit_price && l.unit_price > 0) && !isComplimentary(l) ? "border-red-bar" : ""}`} />
                <span className="text-[11px] font-semibold text-muted">AED</span>
              </span>
              {isService && !l.package_key && (showProfit || l.outside_work) ? (
                <label className="inline-flex items-center gap-1" title={l.outside_work ? "What this outside work costs us: never shown to the customer, counted against profit" : "Our own cost on this service (film, materials, consumables): never shown to the customer, counted against profit"} data-our-cost>
                  <span className="text-[10px] font-semibold text-muted">our cost</span>
                  <Input value={num(l.unit_cost)} placeholder="0" onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} inputMode="decimal" disabled={disabled} aria-label="Our cost" className="w-16 text-right min-h-10 px-1 text-xs" data-our-cost />
                </label>
              ) : null}
              {isService && showProfit && (svc?.bodyshop_kind || svc?.department === "bodyshop" || (l.installer_hours ?? 0) > 0) ? (
                <label className="inline-flex items-center gap-1" title="Estimated installer hours (internal): from the service's default, counted at the bodyshop rate until real clockings replace it" data-installer-hours>
                  <span className="text-[10px] font-semibold text-muted">Inst. h</span>
                  <Input value={num(l.installer_hours)} placeholder="0" onChange={(e) => patch(l.id, { installer_hours: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} inputMode="decimal" disabled={disabled} aria-label="Installer hours (internal)" className="w-14 text-right min-h-10 px-1 text-xs text-muted" />
                </label>
              ) : null}
              {showQty ? (
                <span className="inline-flex items-center justify-end gap-1">
                  <button type="button" disabled={disabled || (l.quantity || 1) <= 1} onClick={() => patch(l.id, { quantity: Math.max(1, (l.quantity || 1) - 1) }, true)} className="h-10 w-10 rounded-control border border-line-strong font-bold disabled:opacity-40" aria-label="One less">−</button>
                  <span className="w-7 text-center font-extrabold" aria-label="Quantity">{l.quantity || 1}</span>
                  <button type="button" disabled={disabled} onClick={() => patch(l.id, { quantity: (l.quantity || 1) + 1 }, true)} className="h-10 w-10 rounded-control border border-line-strong font-bold disabled:opacity-40" aria-label="One more">+</button>
                </span>
              ) : null}
            </>
          )}
          {internal ? <span className="w-24 text-right text-[12px] font-extrabold uppercase tracking-wide text-muted" data-internal-line={l.id}>Internal</span> : isComplimentary(l) ? <span className="w-24 text-right text-[12px] font-extrabold uppercase tracking-wide text-green" data-complimentary={l.price_display}>{complimentaryWord(l)}</span> : <span className="w-24 text-right font-bold">{aed(total)}</span>}
          {!disabled && labourLines.length > 1 ? (
            <span className="inline-flex flex-col" aria-label="Move this line">
              <button type="button" disabled={index === 0} onClick={() => moveLine(l, "up")} aria-label="Move up" data-move-up={l.id} className="h-5 w-7 rounded-t-control border border-line text-[10px] font-bold leading-none text-muted disabled:opacity-30">▲</button>
              <button type="button" disabled={index === labourLines.length - 1} onClick={() => moveLine(l, "down")} aria-label="Move down" data-move-down={l.id} className="h-5 w-7 rounded-b-control border border-t-0 border-line text-[10px] font-bold leading-none text-muted disabled:opacity-30">▼</button>
            </span>
          ) : null}
          {!disabled ? (
            <span className="relative" data-line-menu>
              <button type="button" onClick={(e) => { if (menu) { setMenuFor(null); return; } setMenuAnchor(e.currentTarget); setMenuFor(l.id); }} aria-label="More for this line" aria-expanded={menu} className={`min-h-9 min-w-9 rounded-control border text-base font-bold ${menu ? "border-ink bg-ink text-white" : "border-line"}`}>
                ⋯
              </button>
              {menu ? (
                <FloatingMenu anchor={menuAnchor} onClose={() => setMenuFor(null)} width={240} label="More for this line" data-line-menu="">
                  {index > 0 ? <MenuItem label="Move up" onClick={() => { setMenuFor(null); moveLine(l, "up"); }} /> : null}
                  {index < labourLines.length - 1 ? <MenuItem label="Move down" onClick={() => { setMenuFor(null); moveLine(l, "down"); }} /> : null}
                  {index > 0 ? <MenuItem label="Move to top" onClick={() => { setMenuFor(null); moveLine(l, "top"); }} /> : null}
                  <MenuItem label={isService ? "Make it Labour (hours × rate)" : "Make it Fixed price (qty × price)"} onClick={() => { setMenuFor(null); switchKind(l); }} />
                  {isQuotation && !l.dangerous ? <MenuItem label={l.urgency === "urgent" ? "Not urgent" : "Mark as urgent"} onClick={() => { setMenuFor(null); patch(l.id, { urgency: l.urgency === "urgent" ? null : "urgent" }, true); }} /> : null}
                  {l.dangerous && isOwner ? <MenuItem label="Switch the safety warning off" onClick={() => { setMenuFor(null); patch(l.id, { dangerous: false, urgency: "urgent" }, true); }} /> : null}
                  <MenuItem label={l.details ? "Change the note for the customer" : "Add a note for the customer"} onClick={() => { setMenuFor(null); openOnly(l.id, `note-${l.id}`); }} />
                  {svc?.position_ask || positions.length ? <MenuItem label="Change position" onClick={() => { setMenuFor(null); setSkippedPositions((s) => { const n = new Set(s); n.delete(l.id); return n; }); openOnly(l.id, `pos-${l.id}`); }} /> : null}
                  {l.line_type === "labour" ? <MenuItem label={isOwner ? "Change rate" : "Raise rate"} onClick={() => { setMenuFor(null); openOnly(l.id, `rate-${l.id}`); }} /> : null}
                  {l.line_type === "labour" && lines.some((o) => o.id !== l.id && o.line_type === "labour" && !o.left_off) ? <MenuItem label="Merge into another labour line…" onClick={() => { setMenuFor(null); setMergeFor(l.id); }} /> : null}
                  {isOwner || settings.advisorDiscount ? <MenuItem label={isOwner ? "Owner discount" : "Discount"} onClick={() => { setMenuFor(null); openOnly(l.id, `disc-${l.id}`); }} /> : null}
                  {l.line_type !== "part" && l.fee_kind !== "bank_charge" ? (
                    isComplimentary(l) ? (
                      <MenuItem label="Charge normally (not complimentary)" onClick={() => { setMenuFor(null); patch(l.id, { price_display: "normal" }, true); }} />
                    ) : (
                      <>
                        <MenuItem label="Complimentary (free for the customer)" onClick={() => { setMenuFor(null); patch(l.id, l.line_type === "labour" || l.line_type === "recovery" ? { price_display: "complimentary" } : { price_display: "complimentary", unit_price: 0 }, true); }} />
                        <MenuItem label="Included in package" onClick={() => { setMenuFor(null); patch(l.id, l.line_type === "labour" || l.line_type === "recovery" ? { price_display: "included" } : { price_display: "included", unit_price: 0 }, true); }} />
                      </>
                    )
                  ) : null}
                  {!l.dangerous ? <MenuItem label={internal ? "Show to the customer" : INTERNAL_ONLY_LABEL} onClick={() => { setMenuFor(null); patch(l.id, { visible_to_customer: internal }, true); }} /> : null}
                  <MenuItem label="Remove" red onClick={() => { setMenuFor(null); removeLine(l.id); }} />
                </FloatingMenu>
              ) : null}
            </span>
          ) : null}
          </span>
        </div>
        {askPosition ? (
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 text-xs">
            <span className="font-semibold">Which side?</span>
            {POSITION_CHOICES.map((ps) => (
              <button key={ps.join("+")} type="button" onClick={() => setPositions(l, ps)} className={chip(ps.length === positions.length && ps.every((p) => positions.includes(p)))}>
                {positionChoiceLabel(ps)}
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

  /* ----- recovery: who pays first; then type, trips, cost per trip and provider; the price only when the customer pays ----- */
  const recoveryRow = (l: QuoteLine, index = 0) => {
    const total = lineTotal(l);
    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
    const paidBy: "us" | "customer" = l.recovery_paid_by ?? (l.visible_to_customer === false ? "us" : "customer");
    const free = paidBy === "us" && !!l.recovery_mention_free;
    const kind = l.recovery_provider_kind === "customer" ? "ours" : (l.recovery_provider_kind ?? "ours");
    const trips = Math.max(1, Math.round(Number(l.recovery_trips ?? l.quantity) || 1));
    const more = trips >= 3 || openRows.has(`more-${l.id}`);
    const type = recoveryTypes.find((t) => t.key === l.recovery_type) ?? null;
    const title = recoveryTitle(type?.label ?? null, trips, free);
    const setTrips = (n: number) => patch(l.id, { recovery_trips: n, quantity: n }, true);
    const setPaidBy = (who: "us" | "customer") => patch(l.id, { recovery_paid_by: who, recovery_mention_free: who === "us" ? !!l.recovery_mention_free : false, visible_to_customer: who === "customer" || (who === "us" && !!l.recovery_mention_free), unit_price: who === "us" ? 0 : Number(type?.price) || l.unit_price || 0, price_display: who === "us" && !!l.recovery_mention_free ? "complimentary" : "normal", ...(who === "us" && !!l.recovery_mention_free ? { title: "Complimentary pick-up & drop-off" } : {}) }, true);
    const setFree = (on: boolean) => patch(l.id, { recovery_mention_free: on, visible_to_customer: on, unit_price: 0, price_display: on ? "complimentary" : "normal", ...(on ? { title: "Complimentary pick-up & drop-off" } : {}) }, true);
    return (
      <div key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-2 rounded-control border border-line px-3 py-2 ${paidBy === "us" ? "bg-chip" : "bg-white"}`}>
        {failChip(l.id)}
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <span className="w-5 shrink-0 self-center text-right text-[11px] font-bold text-muted" aria-hidden>{index + 1}</span>
          <span className="font-bold self-center">Recovery</span>
          <span className={boxLabel}>Who pays?<span className="flex gap-1">
            <button type="button" disabled={disabled} onClick={() => setPaidBy("us")} className={chip(paidBy === "us")}>Us</button>
            <button type="button" disabled={disabled} onClick={() => setPaidBy("customer")} className={chip(paidBy === "customer")}>Customer</button>
          </span></span>
          {recoveryTypes.length ? (
            <span className={boxLabel}>Type<span className="flex gap-1">{recoveryTypes.map((t) => <button key={t.key} type="button" disabled={disabled} onClick={() => patch(l.id, { recovery_type: t.key, unit_cost: Number(t.cost) || 0, unit_price: paidBy === "us" ? 0 : Number(t.price) || 0 }, true)} className={chip(l.recovery_type === t.key)}>{t.label}</button>)}</span></span>
          ) : null}
          <span className={boxLabel}>Trips<span className="flex items-center gap-1">
            <button type="button" disabled={disabled} onClick={() => { closeKey(`more-${l.id}`); setTrips(1); }} className={chip(trips === 1 && !openRows.has(`more-${l.id}`))}>One way</button>
            <button type="button" disabled={disabled} onClick={() => { closeKey(`more-${l.id}`); setTrips(2); }} className={chip(trips === 2 && !openRows.has(`more-${l.id}`))}>Two ways</button>
            <button type="button" disabled={disabled} onClick={() => { setOpenRows((s) => new Set(s).add(`more-${l.id}`)); if (trips < 3) setTrips(3); }} className={chip(more)}>More</button>
            {more ? <Input value={String(trips)} onChange={(e) => setTrips(Math.max(1, Math.round(Number(e.target.value) || 1)))} inputMode="numeric" disabled={disabled} aria-label="Number of trips" className="w-14 text-right min-h-9" /> : null}
          </span></span>
          <label className={boxLabel}>Cost per trip<Input value={num(l.unit_cost)} onChange={(e) => patch(l.id, { unit_cost: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} aria-label="Cost per trip" className={`w-24 text-right min-h-9 ${blocked && (l.unit_cost === null || l.unit_cost === undefined) ? "border-red-bar" : ""}`} /></label>
          {paidBy === "customer" ? (
            <label className={boxLabel}>Price per trip<Input value={num(l.unit_price)} onChange={(e) => patch(l.id, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} inputMode="decimal" disabled={disabled} aria-label="Price per trip" className={`w-24 text-right min-h-9 ${blocked && !(l.unit_price && l.unit_price > 0) ? "border-red-bar" : ""}`} /></label>
          ) : null}
          <span className="ml-auto w-28 text-right font-bold self-center">{paidBy === "us" ? aed(0) : aed(total)}</span>
          {!disabled ? <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 px-2 text-xs font-bold text-red self-center" aria-label="Remove">×</button> : null}
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <span className={boxLabel}>Provider<span className="flex flex-wrap items-center gap-1">
            {([["ours", "Our recovery"], ["external", "External"]] as const).map(([k, label]) => <button key={k} type="button" disabled={disabled} onClick={() => patch(l.id, { recovery_provider_kind: k }, true)} className={chip(kind === k)}>{label}</button>)}
            {kind === "external" ? <Input value={l.recovery_provider ?? ""} onChange={(e) => patch(l.id, { recovery_provider: e.target.value })} list="erp-recovery-providers" disabled={disabled} placeholder="Company or person" aria-label="Recovery company" className="w-44 min-h-9" /> : null}
          </span></span>
          {paidBy === "us" ? (
            <label className="flex items-center gap-2 self-center text-xs font-semibold cursor-pointer">
              <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} disabled={disabled} className="h-5 w-5 accent-ink" />
              Mention to the customer as free
            </label>
          ) : null}
        </div>
        <span className="text-xs text-muted">{paidBy === "us" ? (free ? `Shown to the customer as "${title}", ${aed(0)}. Costs us ${aed(lineCost(l))}.` : `Not on the customer's quotation. Costs us ${aed(lineCost(l))}, in the internal breakdown.`) : `Shown to the customer as "${title}", ${aed(total)}. Costs us ${aed(lineCost(l))}.`}</span>
      </div>
    );
  };

  /* ----- any other charge: one labelled row ----- */
  const otherRow = (l: QuoteLine, index = 0) => {
    const hidden = isHidden(l);
    const total = lineTotal(l);
    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
    const costed = hasCostFloor(l);
    const needPrice = blocked && !hidden && !costed && !(l.unit_price && l.unit_price > 0);
    return (
      <div key={l.id} id={`item-line-${l.id}`} className={`flex flex-col gap-1.5 rounded-control border border-line px-3 py-2 ${hidden ? "bg-chip" : "bg-white"}`}>
        {failChip(l.id)}
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <span className="w-5 shrink-0 self-center text-right text-[11px] font-bold text-muted" aria-hidden>{index + 1}</span>
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
            <button type="button" disabled={disabled} onClick={() => patch(l.id, { visible_to_customer: false }, true)} className={chip(hidden)} title={INTERNAL_ONLY_LABEL} data-internal-chip>Internal cost only</button>
          </span></span>
          <span className="ml-auto w-28 text-right font-bold self-center">{aed(total)}</span>
          {!disabled ? <button type="button" onClick={() => removeLine(l.id)} className="min-h-9 px-2 text-xs font-bold text-red self-center" aria-label="Remove">×</button> : null}
        </div>
        {!disabled ? <button type="button" onClick={() => setOpenRows((s) => { const n = new Set(s); const k = `details-${l.id}`; if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="self-start text-[11px] font-semibold text-muted underline underline-offset-4">{l.details ? "Note shown to the customer" : "Add a note for the customer"}</button> : null}
        {openRows.has(`details-${l.id}`) ? <Textarea value={l.details ?? ""} onChange={(e) => patch(l.id, { details: e.target.value })} rows={2} disabled={disabled} aria-label="Note for the customer" className="min-h-16" /> : null}
        {hidden ? <span className="text-xs text-muted">Internal cost only: never on the customer&apos;s documents; costs us {aed(lineCost(l))}, counted in the profit.</span> : null}
      </div>
    );
  };

  // The Commission line of the internal box: works on sent and approved quotations too (it never touches the
  // customer's figures). It reads and writes the editor's header state, so the whole internal box - profit,
  // margin, total cost - moves the moment a commission is added, changed, approved or declined, no refresh.
  const commissionLine = (
    <CommissionLine
      quotationId={quotation.id}
      commission={{ to: header.commission_to ?? null, kind: (header.commission_kind as "aed" | "percent" | null) ?? null, value: header.commission_value ?? null, status: header.commission_status, decisionNote: quotation.commission_decision_note ?? null }}
      people={settings.commissionPeople ?? []}
      isOwner={isOwner}
      net={totals.net}
      disabled={!canSend}
      onLocal={(c) => setHeader((h) => ({ ...h, commission_to: c.to, commission_kind: c.kind, commission_value: c.value, commission_status: c.status }))}
    />
  );
  const reviseAskDialog = reviseAsk && onAskRevise ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-revise-ask>
      <form action={onAskRevise} className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
        <span className="text-lg font-extrabold">Ask the owner to allow a revision</span>
        <p className="text-sm text-muted">The customer approved this quotation. Say why it has to change; the owner allows one revision or declines.</p>
        <ReasonChips name="reason" label="Why?" rows={2} options={reviseReasons} required placeholder="Tap a reason, or type" />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="md" data-ask-revise-send>Ask the owner</Button>
          <Button type="button" tone="ghost" size="md" onClick={() => setReviseAsk(false)}>Cancel</Button>
        </div>
      </form>
    </div>
  ) : null;
  // Section 11: the tint box follows the lines - it shows while any line (or package item) is tint work.
  const hasTint = !!tintBox && lines.some((l) => l.is_active && lineIsTint(l, services.find((s) => s.id === l.service_id)?.bodyshop_kind ?? null));
  // Approved by the customer, replaced or invoiced: nothing can be typed or removed; the bar carries the one way forward.
  if (lock?.locked) {
    const statusText = quotation.status === "approved" ? `Approved${quotation.approver_name ? ` by ${quotation.approver_name}` : ""}${quotation.responded_at ? `, ${formatDayTime(quotation.responded_at)}` : ""}` : quotation.status === "superseded" ? "Replaced by a newer version" : "Locked";
    return (
      <>
        <LockedQuote
          quotation={quotation}
          lock={lock}
          lines={lines}
          totals={totals}
          showProfit={showProfit}
          commissionLine={commissionLine}
          ownerBox={ownerBox}
          tintBox={hasTint ? tintBox : null}
          statusText={statusText}
          actions={
            <>
              {canSend && onRevise ? <form action={onRevise}><Button type="submit" size="md" data-revise-bar>Revise quotation</Button></form> : null}
              {canSend && !onRevise && onAskRevise ? (
                revision?.requestedAt && !revision.allowedAt && !revision.declinedAt ? (
                  <span className="text-xs font-semibold text-amber" data-revise-pending>Owner asked {formatDayTime(revision.requestedAt)}, waiting</span>
                ) : (
                  <Button type="button" size="md" onClick={() => setReviseAsk(true)} data-ask-revise>Ask owner to revise</Button>
                )
              ) : null}
              {revision?.declinedAt && !revision.allowedAt ? <span className="text-xs font-semibold text-red" data-revise-declined>Declined by the owner{revision.declinedNote ? `: ${revision.declinedNote}` : ""}</span> : null}
              {canSend && onRevise && revision?.allowedAt ? <span className="text-xs font-semibold text-green" data-revise-allowed>Owner allowed one revision</span> : null}
            </>
          }
        />
        {reviseAskDialog}
      </>
    );
  }
  const margin = totals.net > 0 ? (totals.profit / totals.net) * 100 : 0;
  const tone3 = marginToneOf(totals.profit, totals.net, { yellow: settings.marginYellow ?? 30, red: settings.marginRed ?? 20 });
  const marginTone = tone3 === "red" ? "text-red" : tone3 === "amber" ? "text-amber" : "text-green";
  const progressText = `${labourDone} of ${namedLabour.length} line${namedLabour.length === 1 ? "" : "s"} done${wait?.partsTotal ? ` · parts ${wait.partsPriced} of ${wait.partsTotal} priced` : ""}`;
  const scrollToFirstBlocker = () => {
    setAttempted(true);
    const first = blockers[0];
    if (first) document.getElementById(`item-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pb-28">
      <div className="xl:col-span-2 flex flex-col gap-4">
        {lockedName ? <Notice tone="info">{lockedName} is editing this quotation. You can read it; changes open once they leave.</Notice> : null}
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
                {reference.roadTest.state === "done" ? <span className="rounded-full border border-line-strong bg-white px-2 py-0.5 text-[11px] font-semibold">road test: {reference.roadTest.flagged.length ? `${reference.roadTest.flagged.length} noted` : "all good"}</span> : null}
                <span className="ml-auto text-base font-bold" aria-hidden>{stripOpen ? "▴" : "▾"}</span>
              </span>
              {unquotedLabels.length && !sent ? <span className="text-xs font-semibold text-amber">Nothing quoted yet for: {unquotedLabels.join(" · ")}</span> : null}
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
                {reference.roadTest.state === "done" ? (
                  <div className="flex flex-col" data-road-strip>
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Road test</span>
                    {reference.roadTest.flagged.map((f) => {
                      const key = `road:${f.key}`;
                      const quoted = quotedKeys.has(`item:${key}`);
                      return (
                        <div key={f.key} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5" data-road-item={f.status}>
                          <Badge tone={f.status === "bad" ? "red" : "amber"}>{f.statusLabel}</Badge>
                          <span className="font-semibold">{f.label}</span>
                          {f.remarks ? <span className="text-muted">{f.remarks}</span> : null}
                          {quoted ? <span className="ml-auto text-xs font-semibold text-green">✓ Quoted</span> : !disabled ? <button type="button" onClick={() => setPicker({ kind: "both", sourceType: "item", sourceKey: key, label: `${f.label} (road test)` })} className="ml-auto min-h-9 rounded-control border border-line-strong bg-white px-2.5 text-xs font-bold" data-road-add>+ Add job</button> : null}
                        </div>
                      );
                    })}
                    {!reference.roadTest.flagged.length ? <p className="border-t border-line pt-1.5 text-xs text-muted">Nothing noted on the road test.</p> : null}
                    {reference.roadTest.good.length ? <p className="border-t border-line pt-1.5 text-xs text-muted" data-road-good><span className="font-semibold text-green">Good:</span> {reference.roadTest.good.join(", ")}</p> : null}
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
              {labourLines.map((l, i) => labourRow(l, i))}
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
              {(packages?.length ?? 0) > 0 ? <Button type="button" tone="secondary" size="md" onClick={() => setPackageAsk(true)} data-add-package>+ Add a package</Button> : null}
              {isQuotation ? <Button type="button" tone="secondary" size="md" onClick={() => setPartPicker(true)}>+ Add a part</Button> : null}
              <Button type="button" tone="secondary" size="md" onClick={() => setDiscountOpen(true)} data-labour-discount className={header.discount_kind && Number(header.discount_value) > 0 ? "border-green bg-green-soft text-green" : ""}>
                {header.discount_kind && Number(header.discount_value) > 0 ? `Discount ${header.discount_kind === "percent" ? `${header.discount_value}%` : aed(Number(header.discount_value))}` : "Discount"}
              </Button>
              {(() => {
                // The discount against the advisor's limit, live (1.6): green inside it, amber above (the
                // owner approves at send); the round-off at sending counts toward the same limit.
                const given = totals.discount + Math.max(0, -(totals.rounding ?? 0));
                const limit = settings.discountLimit ?? 0;
                if (!(given > 0) || !(totals.discountBase > 0)) return null;
                const pct = (given / totals.discountBase) * 100;
                const pctText = pct.toFixed(pct >= 10 ? 0 : 1);
                const over = limit > 0 && pct > limit + 0.049;
                const pendingOwner = quotation.status === "pending_owner";
                return (
                  <span className={`inline-flex items-center text-xs font-semibold ${over ? "text-amber-bar" : "text-green"}`} data-discount-status data-discount-over={over ? "" : undefined}>
                    {isOwner
                      ? `${aed(given)} = ${pctText}% of labour · owner (no limit)`
                      : over
                        ? `${pctText}% · limit ${limit}% · ${pendingOwner ? "Waiting for owner approval" : "the owner approves before it can be sent"}`
                        : `${aed(given)} = ${pctText}% of labour · within your limit (${limit}%)`}
                  </span>
                );
              })()}
            </div>
          ) : null}
          {totals.labourHours > 0 || totals.labourEstimateHours > 0 ? (
            /* The same two figures the internal box uses: the Est. h boxes added up (after the sanity checks) and the quoted hours. */
            <p className={`text-xs ${totals.estimateTotalSuspect || totals.labourHours + 0.05 < totals.labourEstimateHours ? "font-semibold text-amber" : "text-muted"}`} data-estimate-footer>
              Workshop estimate {hoursText(totals.labourEstimateHours)} · quoted {hoursText(totals.labourHours)}
              {totals.estimateTotalSuspect ? ` · the Est. h boxes add up to ${hoursText(totals.labourEstimateEntered)}, more than three times the quoted hours: check them (the quoted hours are used until then)` : totals.labourHours + 0.05 < totals.labourEstimateHours ? " · quoted lower than the workshop estimate" : ""}
              {workshopEstimate && workshopEstimate.hours !== null && Math.abs((workshopEstimate.managerHours ?? workshopEstimate.hours ?? 0) - totals.labourEstimateHours) > 0.05 ? ` · at approval the manager put ${workshopEstimate.managerHours ?? workshopEstimate.hours} h${workshopEstimate.agreed ? "" : " (not yet agreed)"}` : ""}
            </p>
          ) : null}
        </Card>

        {/* Block 2: parts, priced by Parts; the advisor sets the markup and Include or Leave off */}
        {hasTint ? tintBox : null}
        <Card className="flex flex-col gap-3">
          <SectionLabel right={wait?.partsTotal ? `${wait.partsPriced} of ${wait.partsTotal} priced` : undefined}>Parts</SectionLabel>
          {partLines.length && !disabled ? (
            <div className="flex flex-wrap items-end gap-2">
              <span className={boxLabel} data-markup-all>
                Markup for every part (min {settings.minMarkup}%)
                <span className="flex items-center gap-1.5">
                  <span className="inline-flex overflow-hidden rounded-control border border-line-strong">
                    {(["percent", "aed"] as const).map((m) => (
                      <button key={m} type="button" aria-pressed={allMode === m} onClick={() => setAllMode(m)} className={`min-h-9 min-w-11 px-2.5 text-xs font-bold ${allMode === m ? "bg-ink text-white" : "bg-white"}`} data-markup-all-mode={m}>{m === "percent" ? "%" : "AED"}</button>
                    ))}
                  </span>
                  <Input key={allMode} id="markup-all" defaultValue={allMode === "percent" ? String(settings.minMarkup) : ""} placeholder={allMode === "percent" ? "%" : "AED per part"} inputMode="decimal" className="min-h-9" style={{ width: "7rem" }} aria-label={allMode === "percent" ? "Markup percent for every part" : "Markup in AED for every part"} data-markup-all-value />
                </span>
              </span>
              <Button type="button" tone="secondary" size="md" data-markup-apply-all onClick={() => {
                const raw = (document.getElementById("markup-all") as HTMLInputElement | null)?.value ?? "";
                const v = Number(raw.replace(",", "."));
                if (!raw.trim() || !Number.isFinite(v)) return;
                for (const l of partLines) {
                  if (isUnchosen(l)) continue;
                  if (allMode === "percent") patch(l.id, { markup_mode: "percent", markup_percent: isOwner ? Math.max(0, v) : Math.max(settings.minMarkup, v) }, true);
                  else patch(l.id, { markup_mode: "aed", markup_aed: isOwner ? Math.max(0, v) : Math.max(minimumMarkupAed(l.unit_cost, settings.minMarkup), v) }, true);
                }
              }}>Apply to all</Button>
            </div>
          ) : null}
          {partLines.length === 0 ? <p className="text-sm text-muted">{wait?.openRequests ? `${wait.openRequests} request${wait.openRequests === 1 ? "" : "s"} with Parts. The parts appear here on their own once priced.` : "No parts on this quotation."}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-muted">
                    <th className="py-1 pr-2">#</th>
                    <th className="py-1 pr-2">Part</th>
                    <th className="py-1 pr-2">Availability</th>
                    <th className="py-1 pr-2 text-right">Qty</th>
                    <th className="py-1 pr-2 text-right">Cost</th>
                    <th className="py-1 pr-2 text-right">Markup (% or AED)</th>
                    <th className="py-1 pr-2 text-right">Selling</th>
                    <th className="py-1 pr-2 text-right">Total</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {partLines.map((l, idx) => {
                    const part = partOf(l);
                    const leftOff = !!l.left_off;
                    const optionOff = !!l.option_group && l.chosen === false;
                    const unchosen = leftOff || optionOff;
                    const total = lineTotal(l);
                    const floor = floorPrice(l, settings.minMarkup);
                    const belowFloor = !unchosen && total + 0.005 < floor;
                    const blocked = attempted && blockers.some((b) => b.key === `line-${l.id}`);
                    // The markup in both forms, whatever the mode: % of the cost, AED per unit, and the selling price.
                    const mb = markupBoth(l);
                    const mode = l.markup_mode === "aed" ? "aed" : "percent";
                    const belowMin = !isOwner && effectiveMarkupPercent(l) < settings.minMarkup - 1e-9;
                    // An advisor's figure below the minimum goes back to it, in the line's own mode, with the red note.
                    const setMarkup = (fields: { markup_mode?: "percent" | "aed"; markup_percent?: number; markup_aed?: number }) => {
                      const next = { ...l, ...fields };
                      if (!isOwner && effectiveMarkupPercent(next) < settings.minMarkup - 1e-9) {
                        patch(l.id, next.markup_mode === "aed" ? { markup_mode: "aed", markup_aed: minimumMarkupAed(l.unit_cost, settings.minMarkup) } : { markup_mode: "percent", markup_percent: settings.minMarkup }, true);
                        flagMin(l.id);
                        return;
                      }
                      patch(l.id, fields, true);
                    };
                    return (
                      <tr key={l.id} id={`item-line-${l.id}`} className={unchosen ? "opacity-50" : ""} data-part-line>
                        <td className="py-2 pr-2 align-top text-xs font-bold text-muted">{idx + 1}</td>
                        <td className="py-2 pr-2 align-top min-w-0">
                          {/* Two fixed lines: the part, then its tags, so a row never changes height while the markup is typed */}
                          {failChip(l.id)}
                          <div className="flex items-start gap-1.5">
                            {l.option_group ? <input type="radio" name={`opt-${l.option_group}`} checked={!optionOff} onChange={() => choose(l.option_group!, l.id)} disabled={disabled || leftOff} className="h-4 w-4 shrink-0 accent-ink" aria-label="Use this option" /> : null}
                            {renamePart?.lineId === l.id ? (
                              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" data-rename-part-box>
                                <Input value={renamePart.value} onChange={(e) => setRenamePart({ ...renamePart, value: e.target.value })} className="min-h-9 flex-1 min-w-40 text-xs" textCase="title" aria-label="Customer name for this part" data-rename-part-input />
                                <Button type="button" size="md" disabled={pending} onClick={saveCustomerName} data-rename-part-save>Save</Button>
                                <Button type="button" tone="ghost" size="md" onClick={() => { setRenamePart(null); setRenameError(null); }}>Cancel</Button>
                                {renameError ? <span className="w-full text-[11px] font-semibold text-red" data-rename-part-error>{renameError}</span> : null}
                              </span>
                            ) : (
                              <>
                                <span className="min-w-0 break-words font-semibold uppercase">{l.title}</span>
                                {!disabled && l.part_item_id ? <button type="button" onClick={() => { setRenameError(null); setRenamePart({ lineId: l.id, partId: l.part_item_id!, value: l.title }); }} aria-label="Rename for the customer" title="Rename for the customer (the supplier name and part number never change)" className="min-h-7 min-w-7 shrink-0 rounded-control border border-line text-xs font-bold text-muted hover:border-ink" data-rename-part={l.id}>✎</button> : null}
                              </>
                            )}
                            {l.positions?.length ? <span className="text-xs text-muted shrink-0">{l.positions.join(", ")}</span> : null}
                            {partTypeText(l) ? <Badge tone="outline">{partTypeText(l)}</Badge> : null}
                          </div>
                          <div className="h-6 flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-[11px] text-muted">
                            {leftOff ? <Badge tone="neutral">Left off</Badge> : null}
                            {l.visible_to_customer === false ? <span data-internal-badge><Badge tone="neutral">Internal cost only</Badge></span> : null}
                            {part?.cost_aed === null && !leftOff ? <Badge tone="amber">Waiting for the price</Badge> : null}
                            {optionOff ? <span>Option, not used</span> : null}
                            {part && isBatteryPart(part) && !unchosen ? (
                              <span className="inline-flex items-center gap-1" data-warranty={part.id}>
                                <span>Warranty</span>
                                {WARRANTY_CHOICES.map((m) => {
                                  const on = (warranty[part.id] ?? part.warranty_months ?? settings.batteryWarrantyMonths ?? 12) === m;
                                  return (
                                    <button key={m} type="button" disabled={disabled} aria-pressed={on} onClick={() => pickWarranty(part.id, m)} className={`min-h-6 rounded-control border px-1.5 text-[11px] font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-warranty-months={m}>
                                      {m} m
                                    </button>
                                  );
                                })}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-2 pr-2 align-top text-xs text-muted whitespace-nowrap">{customerAvailabilityWords(part?.availability, daysFromDate(part?.delivery_date, settings.today ?? "")) ?? ""}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.quantity}</td>
                        <td className="py-2 pr-2 align-top text-right">{l.unit_cost === null ? "" : aed(l.unit_cost)}</td>
                        <td className="py-2 pr-2 align-top" data-markup-cell>
                          <div className="flex items-center justify-end gap-1.5">
                            {/* % or AED: switching keeps the selling price, only the way the markup is kept changes */}
                            <span className="inline-flex shrink-0 overflow-hidden rounded-control border border-line-strong" data-markup-mode={mode}>
                              {(["percent", "aed"] as const).map((m) => (
                                <button key={m} type="button" disabled={disabled || unchosen} aria-pressed={mode === m} onClick={() => { if (mode === m) return; patch(l.id, m === "aed" ? { markup_mode: "aed", markup_aed: mb.aed } : { markup_mode: "percent", ...markupFromSell({ ...l, markup_mode: "percent" }, mb.sell) }, true); }} className={`min-h-9 min-w-10 px-2 text-xs font-bold disabled:opacity-50 ${mode === m ? "bg-ink text-white" : "bg-white"}`} data-markup-mode-chip={m}>{m === "percent" ? "%" : "AED"}</button>
                              ))}
                            </span>
                            {mode === "percent" ? (
                              <Input value={num(l.markup_percent === null ? null : Math.round(l.markup_percent * 100) / 100)} onChange={(e) => { if (e.target.value === "") return; const v = Number(e.target.value); if (Number.isFinite(v)) setMarkup({ markup_mode: "percent", markup_percent: v }); }} inputMode="decimal" disabled={disabled || unchosen} className={`text-right min-h-9 ${belowMin || belowFloor || blocked ? "border-red-bar" : ""}`} style={{ width: "5rem" }} aria-label="Markup percent" data-markup-percent-input />
                            ) : (
                              <Input value={num(l.markup_aed)} onChange={(e) => { if (e.target.value === "") return; const v = Number(e.target.value); if (Number.isFinite(v)) setMarkup({ markup_mode: "aed", markup_aed: Math.round(v * 100) / 100 }); }} inputMode="decimal" disabled={disabled || unchosen} className={`text-right min-h-9 ${belowMin || belowFloor || blocked ? "border-red-bar" : ""}`} style={{ width: "6rem" }} aria-label="Markup in AED per unit" data-markup-aed-input />
                            )}
                          </div>
                          {/* Whatever the mode, both forms of the markup show under it */}
                          <span className="mt-1 block whitespace-nowrap text-right text-[11px] text-muted" data-markup-both>
                            <span data-markup-percent>{mb.percent === null ? "—" : `${mb.percent.toFixed(2)}%`}</span> · <span data-markup-aed>{aed(mb.aed)}</span>{(l.quantity || 1) > 1 ? " each" : ""}
                          </span>
                          <span className={`block text-right text-[11px] font-bold text-red ${minFlags.has(l.id) ? "" : "hidden"}`} data-min-markup>Minimum {settings.minMarkup}%</span>
                        </td>
                        <td className="py-2 pr-2 align-top text-right" data-selling-cell>
                          {/* Type the selling price: the markup (% and AED) is worked out from it */}
                          <Input value={num(lineUnitPrice(l))} onChange={(e) => { if (e.target.value === "") return; const v = Number(e.target.value); if (Number.isFinite(v)) setMarkup({ markup_mode: mode, ...markupFromSell(l, v) }); }} inputMode="decimal" disabled={disabled || unchosen || l.unit_cost === null} className="text-right min-h-9" style={{ width: "6.5rem" }} aria-label="Selling price per unit" data-selling-input />
                        </td>
                        <td className="py-2 pr-2 align-top text-right font-bold">
                          {aed(total)}
                          {isOwner && !disabled && !unchosen ? (
                            <details className="text-[11px] font-normal text-left">
                              <summary className="cursor-pointer text-muted">Owner discount{(l.discount_percent ?? 0) > 0 ? ` ${l.discount_percent}%` : ""}</summary>
                              <OwnerPartDiscount percent={l.discount_percent ?? 0} reason={l.discount_reason ?? ""} options={settings.reasons?.part_discount ?? []} onChange={(pct, reason) => patch(l.id, { discount_percent: pct, discount_reason: reason })} />
                            </details>
                          ) : (l.discount_percent ?? 0) > 0 ? <span className="block text-[11px] font-normal text-muted">Discount {l.discount_percent}%</span> : null}
                          <span className={`block text-[11px] font-bold text-red ${belowFloor ? "" : "invisible"}`}>Below the minimum</span>
                        </td>
                        <td className="py-2 align-top text-right">
                          {!disabled && isQuotation ? (
                            leftOff ? (
                              <button type="button" onClick={() => patch(l.id, { left_off: false }, true)} className="min-h-9 rounded-control bg-ink px-2.5 text-xs font-bold text-white whitespace-nowrap">Put back</button>
                            ) : (
                              <button type="button" onClick={() => patch(l.id, { left_off: true }, true)} className="min-h-9 rounded-control border border-line px-2.5 text-xs font-semibold text-muted whitespace-nowrap">Leave off</button>
                            )
                          ) : null}
                          {!disabled && !leftOff ? <button type="button" onClick={() => patch(l.id, { visible_to_customer: l.visible_to_customer === false }, true)} title={INTERNAL_ONLY_LABEL} className="mt-1 block min-h-9 w-full text-right text-[11px] font-semibold text-muted underline underline-offset-4 whitespace-nowrap" data-internal-toggle={l.id}>{l.visible_to_customer === false ? "Show to customer" : "Internal only"}</button> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {partOffers.length ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-control bg-chip p-2 text-xs" data-goes-with>
              <span className="font-semibold">Goes with:</span>
              {partOffers.map((o) => (
                <button key={o.key} type="button" onClick={() => save({ requestPart: { description: o.target.name, quantity: 1, positions: o.axle ? [o.axle] : [], catalogue_id: o.target.id, source_type: null, source_key: null } })} className="min-h-9 rounded-control border border-line-strong bg-white px-2.5 font-bold">
                  + Ask Parts for {o.label.charAt(0).toLowerCase()}{o.label.slice(1)}?
                </button>
              ))}
              <span className="text-muted">Offered only; nothing is added by itself.</span>
            </div>
          ) : null}
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
              // Other charges count from 1 again (the hidden bank charge is not a line).
              const idx = otherLines.filter((x) => !x.fee_kind).indexOf(l);
              if (l.line_type === "recovery") return recoveryRow(l, idx);
              return otherRow(l, idx);
            })}
          </div>
          {!disabled ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {!otherLines.some((l) => l.line_type === "recovery") ? <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "recovery" })}>+ Recovery</Button> : null}
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "other", title: "" })}>+ Other charge</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => addLine({ line_type: "other", title: "", visible_to_customer: false, quantity: 1 })} title={INTERNAL_ONLY_LABEL} data-add-internal>+ Internal cost</Button>
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
            {totals.discount ? <><dt className="font-bold text-green" data-labour-discount-row>{discountLabelOf(q, { hasPackage: hasPackageLine(lines) })}</dt><dd className="text-right font-bold text-green">− {aed(totals.discount)}</dd></> : null}
            {totals.rounding ? <><dt className={totals.rounding < 0 ? "font-bold text-green" : "text-muted"} data-roundoff-row>{totals.rounding < 0 ? "Round-off" : "Rounding"}</dt><dd className={`text-right ${totals.rounding < 0 ? "font-bold text-green" : ""}`}>{totals.rounding < 0 ? "− " : ""}{aed(Math.abs(totals.rounding))}</dd></> : null}
            <dt className="text-muted border-t border-line pt-1">Subtotal before VAT</dt><dd className="text-right border-t border-line pt-1">{aed(totals.net)}</dd>
            <dt className="text-muted">VAT {quotation.vat_percent}%</dt><dd className="text-right">{aed(totals.vat)}</dd>
            <dt className="font-extrabold">Grand total</dt><dd className="text-right text-lg font-extrabold">{aed(totals.total)}</dd>
            {totals.deposit ? <><dt className="text-muted">Deposit required</dt><dd className="text-right font-semibold" data-deposit-row>{aed(totals.deposit)}</dd></> : null}
          </dl>
          {isQuotation ? (
            <div className="flex flex-col gap-2 border-t border-line pt-3" data-deposit-box>
              <label className="flex items-center gap-3 min-h-10 cursor-pointer text-sm font-bold">
                <input type="checkbox" className="h-5 w-5 accent-ink" disabled={disabled} checked={depositOn} onChange={(e) => setHeaderField(e.target.checked ? { deposit_mode: "aed", deposit_value: totals.depositSuggested || null } : { deposit_mode: "none", deposit_value: null }, true)} data-deposit-switch />
                Ask for a deposit
              </label>
              {!depositOn && totals.depositSuggested ? <p className="text-xs text-muted" data-deposit-hint>Suggested: {aed(totals.depositSuggested)} ({settings.depositPercent}% of parts, parts above {aed(settings.depositThreshold)}). The owner changes this rule in Settings.</p> : null}
              {depositOn ? (
                <>
                  <div className="flex flex-wrap gap-1" data-deposit-chips>
                    {([["percent_parts", 50, "50% of parts"], ["percent_parts", 100, "100% of parts"], ["percent_total", 50, "50% of total"]] as const).map(([mode, v, label]) => (
                      <button key={label} type="button" disabled={disabled} aria-pressed={header.deposit_mode === mode && Number(header.deposit_value) === v} onClick={() => setHeaderField({ deposit_mode: mode, deposit_value: v }, true)} className={`min-h-8 rounded-control border px-2.5 text-xs font-semibold ${header.deposit_mode === mode && Number(header.deposit_value) === v ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex overflow-hidden rounded-control border border-line-strong" data-deposit-unit>
                      <button type="button" disabled={disabled} aria-pressed={header.deposit_mode === "aed"} onClick={() => setHeaderField({ deposit_mode: "aed", deposit_value: totals.deposit || null }, true)} className={`min-h-9 px-3 text-xs font-bold ${header.deposit_mode === "aed" ? "bg-ink text-white" : "bg-white"}`}>AED</button>
                      <button type="button" disabled={disabled} aria-pressed={header.deposit_mode !== "aed"} onClick={() => setHeaderField({ deposit_mode: header.deposit_mode === "percent_parts" ? "percent_parts" : "percent_total", deposit_value: header.deposit_mode === "aed" && totals.total > 0 && header.deposit_value ? Math.min(100, Math.round((Number(header.deposit_value) / totals.total) * 100)) : header.deposit_value ?? 50 }, true)} className={`min-h-9 px-3 text-xs font-bold ${header.deposit_mode !== "aed" ? "bg-ink text-white" : "bg-white"}`}>%</button>
                    </span>
                    <Input value={header.deposit_value === null || header.deposit_value === undefined ? "" : String(header.deposit_value)} onChange={(e) => setHeaderField({ deposit_value: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} inputMode="decimal" disabled={disabled} aria-label="Deposit" className="w-28" style={{ width: "7rem" }} data-deposit-value />
                    {header.deposit_mode !== "aed" ? <span className="text-xs text-muted">of {header.deposit_mode === "percent_parts" ? "parts" : "total"}</span> : null}
                    <span className="ml-auto text-sm font-bold" data-deposit-amount>= {aed(totals.deposit)}</span>
                  </div>
                  {totals.depositSuggested ? <p className="text-xs text-muted">Suggested: {aed(totals.depositSuggested)} ({settings.depositPercent}% of parts above {aed(settings.depositThreshold)}).</p> : null}
                </>
              ) : null}
            </div>
          ) : null}
          {settings.discountLimit > 0 && totals.discountBase > 0 && (totals.discount / totals.discountBase) * 100 > settings.discountLimit + 0.001 ? <p className="text-xs font-semibold text-amber">Above the {settings.discountLimit}% discount limit: the owner must approve before sending.</p> : null}
          {showProfit ? (
            <div className="flex flex-col gap-1 rounded-control bg-chip p-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Internal (not shown to the customer)</span>
              <div className="flex flex-col gap-1 py-1">
                <span className="text-[11px] font-semibold text-muted">Customer will pay by</span>
                <div className="flex flex-wrap gap-1">
                  {([["not_sure", "Not sure"], ["card", "Card"], ["link", "Payment link"], ["cash", "Cash"], ["cheque", "Cheque"], ["transfer", "Bank transfer"]] as const).map(([v, label]) => (
                    <button key={v} type="button" disabled={disabled} onClick={() => setHeaderField({ expected_payment_method: v }, true)} aria-pressed={expectedMethod === v} className={`min-h-8 rounded-control border px-2 text-[11px] font-bold ${expectedMethod === v ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{label}</button>
                  ))}
                </div>
                <span className="text-[11px] text-muted">Sets the estimated bank charge only. The customer may still pay any way; the real charge replaces it at payment.</span>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs" data-internal-box>
                <dt className="text-muted">Parts cost</dt><dd className="text-right">{aed(totals.partsCost)}</dd>
                <dt className="text-muted" data-labour-cost-label>
                  Labour at cost ({hoursText(totals.labourCostHours)} {totals.labourCostBasis === "clocked" ? "clocked" : "estimate"} × AED {settings.technicianCostRate ?? 0})
                  {totals.labourCostBasis === "estimate" && (totals.estimateTotalSuspect || totals.estimateSuspectLineIds.length) ? <span className="ml-1 font-semibold text-amber" title="An Est. h box holds a figure that is not hours; the quoted hours are used for that line until it is fixed" data-estimate-cost-warning>· Est. h flagged, quoted hours used</span> : null}
                </dt><dd className="text-right" data-labour-cost>{aed(totals.labourCost)}</dd>
                {totals.outsideCost ? <><dt className="text-muted">Outside work (another company)</dt><dd className="text-right">{aed(totals.outsideCost)}</dd></> : null}
                {totals.ownServiceCost ? <><dt className="text-muted">Our services&apos; cost (film, materials)</dt><dd className="text-right" data-own-service-cost>{aed(totals.ownServiceCost)}</dd></> : null}
                {totals.installerHours > 0 ? <><dt className="text-muted" data-installer-row>Estimated installer hours: {hoursText(totals.installerHours)} × AED {settings.bodyshopRate ?? 0}{settings.installerHistory ? <span className="block text-[11px]" data-installer-history>This model before: about {hoursText(settings.installerHistory.avgHours)} over {settings.installerHistory.jobs} job{settings.installerHistory.jobs === 1 ? "" : "s"}</span> : null}</dt><dd className="text-right">{aed(totals.bodyshopLabourCost)}</dd></> : null}
                <dt className="text-muted">Recovery cost</dt><dd className="text-right">{aed(totals.recoveryCost)}</dd>
                {totals.supplierCharges ? <><dt className="text-muted" data-supplier-charges-label>Supplier charges ({settings.supplierCharges?.words || "courier, freight"})</dt><dd className="text-right" data-supplier-charges-cost>{aed(totals.supplierCharges)}</dd></> : null}
                {commissionLine}
                {department === "bodyshop" || Number(header.materials_cost_aed) > 0 ? <><dt className="text-muted">Materials (film, paint, consumables)</dt><dd className="text-right"><Input value={header.materials_cost_aed ? String(header.materials_cost_aed) : ""} onChange={(e) => setHeaderField({ materials_cost_aed: Number(e.target.value.replace(",", ".")) || 0 }, true)} inputMode="decimal" placeholder="0" disabled={disabled} aria-label="Materials cost" className="w-24 text-right min-h-8 text-xs" data-materials /></dd></> : null}
                {(() => {
                  // Section 7: a package line fills its own internal cost estimate from Settings.
                  const pkg = lines.find((l) => l.is_active && l.package_key && !isUnchosen(l));
                  const c = settings.costing;
                  if (!pkg || !c) return null;
                  const rolls = header.film_rolls_est !== null && header.film_rolls_est !== undefined ? Number(header.film_rolls_est) : (c.rollsEst ?? (c.bigCar ? c.bigRolls : 1));
                  const est = packageCostEstimate({
                    packagePrice: (pkg.unit_price ?? 0) * (pkg.quantity || 1),
                    title: pkg.title,
                    // The snapshot is an OBJECT ({ key, name, items: [...] }), read through the one parser.
                    itemLabels: (toSnapshot(pkg.package_items)?.items ?? []).map((x) => x.label),
                    rolls,
                    filmRollPriceGloss: c.filmRollPriceGloss,
                    filmRollPriceMatte: c.filmRollPriceMatte,
                    tintPerCar: c.tintPerCar,
                    tintFactor: c.tintFactor,
                    tintExtraHours: c.tintExtraHours,
                    ceramicExteriorPerCar: c.ceramicExteriorPerCar,
                    ceramicInteriorPerCar: c.ceramicInteriorPerCar,
                    consumablesPerCar: c.consumablesPerCar,
                    hours: pkg.installer_hours ?? c.packageHours,
                    ratePerHour: c.ratePerHour,
                    recoveryCost: totals.recoveryCost ?? 0,
                  });
                  return (
                    <>
                      <dt className="col-span-2 pt-1 text-[11px] leading-relaxed" data-package-cost>
                        {est.words}
                        {c.bigCar && header.film_rolls_est === null ? <span className="text-muted"> · big car: {c.bigRolls} rolls by Settings</span> : null}
                      </dt>
                      {isOwner ? (
                        <dd className="col-span-2 flex items-center justify-end gap-1 text-[11px]" data-film-rolls-box>
                          <span className="text-muted">Film rolls this job</span>
                          <Input value={header.film_rolls_est === null || header.film_rolls_est === undefined ? "" : String(header.film_rolls_est)} onChange={(e) => { const v = e.target.value.replace(",", "."); setHeaderField({ film_rolls_est: v === "" ? null : Number(v) }, true); }} inputMode="decimal" placeholder={String(c.bigCar ? c.bigRolls : 1)} disabled={disabled} aria-label="Film rolls for this job" className="w-16 text-right min-h-8 text-xs" data-film-rolls />
                        </dd>
                      ) : null}
                    </>
                  );
                })()}
                <dt className="text-muted">Other internal costs</dt><dd className="text-right">{aed(totals.otherCost - totals.recoveryCost)}</dd>
                <dt className="text-muted">Bank charge ({liveRate}% of the total with VAT, estimated{expectedMethod === "not_sure" ? ", card rate" : ""})</dt><dd className="text-right">{aed(totals.bankCharge)}</dd>
                <dt className="font-semibold border-t border-line pt-1">Total cost</dt><dd className="text-right font-semibold border-t border-line pt-1">{aed(totals.totalCost)}</dd>
                <dt className="font-bold">Profit before VAT{totals.commissionPending ? <span className="ml-1 font-semibold text-amber" data-profit-commission-pending>(commission counted, pending owner approval)</span> : null}</dt><dd className={`text-right font-bold ${marginTone}`}>{aed(totals.profit)} · {margin.toFixed(1)}%</dd>
                <dt className="text-muted">Labour margin</dt><dd className="text-right">{aed(totals.labourMargin)}</dd>
                <dt className="text-muted">Parts margin</dt><dd className="text-right">{aed(totals.partsMargin)}{totals.partsUnpriced ? <span className="block text-[11px] font-semibold text-amber" data-margin-incomplete>{totals.partsUnpriced} part{totals.partsUnpriced === 1 ? "" : "s"} not priced yet, margin incomplete</span> : null}</dd>
              </dl>
            </div>
          ) : null}
          {isQuotation ? <p className="text-xs text-muted">Estimated: about {estimatedDays} working day{estimatedDays === 1 ? "" : "s"} after approval. The firm date is set in planning.</p> : null}
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
        {ownerBox}
      </div>

      {picker ? (
        <ServicePicker
          kind={picker.kind}
          title={picker.replace ? undefined : picker.label ? `Add a job for: ${picker.label}` : undefined}
          categories={categories}
          services={services}
          usage={usage}
          department={department}
          suggested={suggestedFor(picker.sourceKey ? (reference?.findings.find((f) => f.sourceKey === picker.sourceKey)?.keys ?? (picker.sourceKey.startsWith("road:") ? [picker.sourceKey] : [])) : referenceKeys)}
          onDone={fromPicker}
          onSaveCustom={async (name) => { const r = await saveCustomService(name, picker.kind === "service" ? "service" : "labour"); if (r.error) setActionError(r.error); else refreshWhenIdle(() => router.refresh()); }}
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
      {removeAsk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-remove-parts-ask>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">Also remove its {removeAsk.parts} part{removeAsk.parts === 1 ? "" : "s"}?</span>
            <p className="text-sm text-muted">They leave the quotation and the parts list. A part already ordered is never removed quietly: Parts are asked whether to return it or keep it in stock.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" onClick={() => doRemove(removeAsk.id, true)} data-remove-with-parts>Yes, remove the parts too</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => doRemove(removeAsk.id, false)} data-remove-keep-parts>No, keep the parts</Button>
              <Button type="button" tone="ghost" size="md" onClick={() => setRemoveAsk(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
      {packageAsk ? (
        <PackageDialog
          packages={packages ?? []}
          onClose={() => setPackageAsk(false)}
          onPick={(pkg, ticked) => {
            const snap = packageSnapshot(pkg, ticked);
            addLine({ line_type: "package", title: pkg.name, package_key: pkg.key, package_items: snap, quantity: 1, price_per: "job" } as Partial<QuoteLine>);
            setPackageAsk(false);
          }}
        />
      ) : null}
      {mergeFor ? (
        <MergeDialog
          lines={lines}
          fromId={mergeFor}
          onClose={() => setMergeFor(null)}
          onPick={(targetId) => {
            const from = lines.find((x) => x.id === mergeFor);
            const t = lines.find((x) => x.id === targetId);
            if (!from || !t) return;
            const hours = Math.round(((Number(t.hours) || 0) + (Number(from.hours) || 0)) * 100) / 100;
            const title = `${t.title || "Labour"} + ${from.title || "labour"}`.slice(0, 180);
            patch(t.id, { hours, title }, true);
            removeLine(from.id);
            setMergeFor(null);
          }}
        />
      ) : null}
      {partsAsk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-parts-ask>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">{partsAsk.message}</span>
            <ul className="text-sm font-semibold uppercase">{partsAsk.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
            <p className="text-xs text-muted">Every priced part belongs on the quotation, Our stock included (our stock only skips the ordering). The customer is not charged for a part that is not here.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" onClick={addMissingNow} data-parts-add>{partsAsk.missing.length === 1 ? "Add it" : "Add them"}</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => { setPartsAsk(null); completeNow(false, true); }} data-parts-leave>Leave {partsAsk.missing.length === 1 ? "it" : "them"} off</Button>
              <Button type="button" tone="ghost" size="md" onClick={() => setPartsAsk(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
      {depositAsk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-deposit-ask>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">{depositAsk}</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" onClick={() => { setDepositAsk(null); setHeaderField({ deposit_mode: "aed", deposit_value: totals.depositSuggested || null }, true); document.querySelector<HTMLElement>("[data-deposit-box]")?.scrollIntoView({ block: "center", behavior: "smooth" }); }} data-deposit-add>Add deposit</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => { setDepositAsk(null); completeNow(false, false, true); }} data-deposit-skip>Send without deposit</Button>
            </div>
          </div>
        </div>
      ) : null}
      {reviseAskDialog}
      {lowAsk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-low-profit-ask>
          <div className="w-full max-w-md rounded-card border-2 border-red-bar bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold text-red">{lowAsk}</span>
            <p className="text-sm text-muted">Sending anyway is written on the quotation and the owner is told.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" onClick={() => setLowAsk(null)} data-low-profit-fix>Go back and fix</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => { setLowAsk(null); completeNow(false, false, false, true); }} data-low-profit-send>Send anyway</Button>
            </div>
          </div>
        </div>
      ) : null}
      {compAsk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-complimentary-ask>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">Price 0: mark as Complimentary?</span>
            <p className="text-sm text-muted">The customer sees the word instead of a price; the line stays valid and our own cost still counts against profit.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" onClick={() => { const id = compAsk; setCompAsk(null); patch(id, { price_display: "complimentary", unit_price: 0 }, true); }} data-comp-yes>Complimentary</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => { const id = compAsk; setCompAsk(null); patch(id, { price_display: "included", unit_price: 0 }, true); }} data-comp-included>Included in package</Button>
              <Button type="button" tone="ghost" size="md" onClick={() => setCompAsk(null)} data-comp-no>No, it needs a price</Button>
            </div>
          </div>
        </div>
      ) : null}
      {markupAsk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-markup-ask>
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">{markupAsk}</span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" onClick={() => { setMarkupAsk(null); const box = document.getElementById("markup-all") ?? document.querySelector<HTMLElement>("[data-markup-box]"); box?.scrollIntoView({ block: "center", behavior: "smooth" }); (box as HTMLElement | null)?.focus(); }} data-markup-set>Set markup</Button>
              <Button type="button" tone="secondary" size="md" onClick={() => { setMarkupAsk(null); completeNow(true); }} data-markup-continue>Continue anyway</Button>
            </div>
          </div>
        </div>
      ) : null}
      {discountOpen ? (
        <LabourDiscountDialog
          kind={header.discount_kind ?? "percent"}
          value={header.discount_value}
          scope={header.discount_scope === "labour_services" ? "labour_services" : "labour"}
          bases={discountBases}
          onClose={() => setDiscountOpen(false)}
          onApply={(kind, value, scope) => { setHeaderField({ discount_kind: value > 0 ? kind : null, discount_value: value > 0 ? value : null, discount_percent: 0, discount_scope: scope }, true); setDiscountOpen(false); }}
        />
      ) : null}
      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3">
            <span className="text-lg font-extrabold">{confirming.message}</span>
            <p className="text-sm text-muted">Yes, keep it: the line stays amber and is not asked about again. Change: the figure goes back to what it was.</p>
            <div className="flex gap-2">
              <Button type="button" size="lg" onClick={() => { const op = confirming.op as { patchLine?: Record<string, unknown> }; if (op.patchLine) save({ patchLine: { ...op.patchLine, markup_confirmed: true } }); setConfirming(null); }} data-confirm-markup>Yes, keep it</Button>
              <Button type="button" tone="secondary" size="lg" onClick={() => { setConfirming(null); router.refresh(); }}>Change</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* The decision, in a slim bar fixed to the bottom: finish, then send; afterwards the state and Send again */}
      {!disabled || (sent && canSend) ? (
        <div className="fixed bottom-0 left-0 right-0 md:left-60 z-40 border-t border-line bg-white px-4 py-2.5">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
            {!disabled ? <span className={`text-[11px] font-bold ${state === "offline" ? "text-amber" : "text-muted"}`}>{state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "No connection · changes kept, will save"}</span> : null}
            {showProfit ? <span className={`text-xs font-extrabold ${marginTone}`} data-margin-chip data-margin-tone={tone3}>Profit {margin.toFixed(0)}%</span> : null}
            {(() => {
              const hist = settings.packageCost ?? {};
              let worst: "red" | "amber" | null = null;
              for (const l of lines) {
                if (!l.package_key || l.left_off || !(l.unit_price && l.unit_price > 0)) continue;
                const avg = hist[l.package_key];
                if (!avg) continue;
                if (l.unit_price < avg) worst = "red";
                else if (l.unit_price < avg * 1.15 && worst !== "red") worst = "amber";
              }
              if (!worst) return null;
              return <span className={`text-xs font-extrabold ${worst === "red" ? "text-red" : "text-amber"}`} data-package-warn={worst}>{worst === "red" ? "Package price below what this package usually costs us" : "Package price looks low against past jobs"}</span>;
            })()}
            {!sent ? <span className="text-xs font-semibold">{progressText}</span> : <span className="text-xs font-semibold">{quotation.status === "sent" ? "Sent, not yet opened" : quotation.status === "opened" ? "Opened by the customer" : quotation.status === "approved" ? "Approved" : quotation.status === "declined" ? "Declined" : quotation.status === "expired" ? "Expired" : quotation.status === "urgent_requested" ? "Urgent work asked for" : "Sent"}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {!sent && !completed && !disabled ? (
                <Button type="button" size="md" className={blockers.length ? "opacity-60" : ""} disabled={pending} onClick={() => { if (blockers.length) { scrollToFirstBlocker(); return; } completeNow(false); }}>
                  {pending ? "Checking…" : isQuotation ? "Quotation complete" : "Estimate complete"}
                </Button>
              ) : null}
              {!sent && completed && canSend ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={blockers.length > 0} onBlocked={scrollToFirstBlocker} existingToken={quotation.token} shortLink={shortLink} status={quotation.status} total={totals.total} roundedTotal={quotation.rounded_total_aed} autoOpen={autoSend} compact /> : null}
              {canSend && sent && onRevise ? <form action={onRevise}><Button type="submit" tone="secondary" size="md" data-revise-bar>Revise quotation</Button></form> : null}
              {canSend && sent && !onRevise && onAskRevise ? (
                <span className="inline-flex flex-wrap items-center gap-2" data-ask-revise-bar>
                  <Button type="button" tone="secondary" size="md" disabled className="opacity-50" title="The customer approved this quotation: the owner must allow a revision">Revise quotation</Button>
                  {revision?.requestedAt && !revision.allowedAt && !revision.declinedAt ? (
                    <span className="text-xs font-semibold text-amber" data-revise-pending>Owner asked {formatDayTime(revision.requestedAt)}, waiting</span>
                  ) : (
                    <Button type="button" size="md" onClick={() => setReviseAsk(true)} data-ask-revise>Ask owner to revise</Button>
                  )}
                  {revision?.declinedAt ? <span className="text-xs font-semibold text-red" data-revise-declined>Declined by the owner{revision.declinedNote ? `: ${revision.declinedNote}` : ""}</span> : null}
                </span>
              ) : null}
              {canSend && sent && onRevise && revision?.allowedAt ? <span className="text-xs font-semibold text-green" data-revise-allowed>Owner allowed one revision</span> : null}
              {canSend && sent && quotation.token && (quotation.status === "sent" || quotation.status === "opened") ? <SendQuoteControl quotationId={quotation.id} kind={quotation.kind} siteUrl={siteUrl} messageTemplate={messageTemplate} phoneDigits={phoneDigits} blocked={false} onBlocked={() => {}} existingToken={quotation.token} shortLink={shortLink} status={quotation.status} total={totals.total} roundedTotal={quotation.rounded_total_aed} again /> : null}
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
/** The bodyshop package chooser: pick one, answer the only-if questions, one price follows. */
function PackageDialog({ packages, onClose, onPick }: { packages: BodyshopPackage[]; onClose: () => void; onPick: (pkg: BodyshopPackage, tickedOptional: string[]) => void }) {
  const [pick, setPick] = useState<BodyshopPackage | null>(packages.length === 1 ? packages[0] : null);
  const [ticked, setTicked] = useState<string[]>([]);
  const optional = pick ? pick.items.filter((i) => i.only_if) : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-package-ask onClick={onClose}>
      <div className="w-full max-w-lg rounded-card bg-white p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-lg font-extrabold">{pick ? pick.name : "Which package?"}</span>
        {!pick ? (
          <div className="flex flex-col gap-2">
            {packages.map((p) => (
              <button key={p.key} type="button" className="min-h-12 rounded-control border border-line-strong bg-white px-3 text-left text-sm font-bold" data-package-choice onClick={() => setPick(p)}>
                {p.name}
                <span className="block text-xs font-medium text-muted">{p.items.length} items{p.time_in_workshop ? ` · ${ESTIMATED_COMPLETION}: ${p.time_in_workshop}` : ""}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {optional.length ? (
              <div className="flex flex-col gap-1 rounded-control border-2 border-ink p-3" data-package-optionals>
                <span className="text-sm font-bold">Does the car have it?</span>
                {optional.map((i) => (
                  <label key={i.label} className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={ticked.includes(i.label)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, i.label] : t.filter((x) => x !== i.label)))} className="h-5 w-5 accent-ink" data-package-optional={i.label} />
                    {i.label} <span className="font-medium text-muted">— only if {i.only_if}</span>
                  </label>
                ))}
                <span className="text-xs text-muted">Not ticked = it stays off every customer document.</span>
              </div>
            ) : null}
            {/* What the customer will read: the ticked optional items only. */}
            <div className="whitespace-pre-line rounded-control bg-chip p-3 text-sm" data-package-preview>{packageDetailsText(packageSnapshot(pick, ticked))}</div>
            <p className="text-xs text-muted">One price for the whole package: type it on the line after Add. The customer never sees item prices.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" onClick={() => onPick(pick, ticked)} data-package-add>Add the package</Button>
              {packages.length > 1 ? <Button type="button" tone="ghost" size="md" onClick={() => setPick(null)}>Back</Button> : null}
              <Button type="button" tone="ghost" size="md" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "Merge into another labour line": pick the target; the hours join it and this line goes. */
function MergeDialog({ lines, fromId, onClose, onPick }: { lines: QuoteLine[]; fromId: string; onClose: () => void; onPick: (targetId: string) => void }) {
  const from = lines.find((x) => x.id === fromId);
  const targets = lines.filter((x) => x.id !== fromId && x.line_type === "labour" && !x.left_off);
  if (!from) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" data-merge-ask onClick={onClose}>
      <div className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-lg font-extrabold">Merge “{from.title || "this line"}” into…</span>
        <p className="text-sm text-muted">Its {from.hours ?? 0} h join the line you pick and this line disappears. Adjust the hours after, so the customer is never charged twice for the same dismantling.</p>
        <div className="flex flex-col gap-2">
          {targets.map((t) => (
            <button key={t.id} type="button" className="min-h-12 rounded-control border border-line-strong bg-white px-3 text-left text-sm font-bold" data-merge-target onClick={() => onPick(t.id)}>
              {t.title || "(no name)"} · {t.hours ?? 0} h
            </button>
          ))}
        </div>
        <Button type="button" tone="ghost" size="md" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function NameBox({ id, value, kind, items, disabled, blocked, onType, onPick, onArrow, onNext }: { id: string; value: string; kind: "labour" | "service"; items: Suggestion[]; disabled: boolean; blocked: boolean; onType: (text: string) => void; onPick: (s: Suggestion) => void; onArrow: () => void; onNext: () => void }) {
  const [focus, setFocus] = useState(false);
  const q = value.trim().toLowerCase();
  const shown = focus && q.length >= 2 ? items.filter((j) => j.title.toLowerCase().includes(q) && j.title.toLowerCase() !== q).slice(0, 8) : [];
  return (
    <div className="relative min-w-0">
      <div className={`flex items-center rounded-control border bg-white focus-within:border-ink ${blocked ? "border-red-bar" : "border-line-strong"}`}>
        {/* A one-row box that grows as the name gets long: the full name always shows, never "…". */}
        <textarea
          id={id}
          value={value}
          rows={1}
          ref={(el) => {
            if (!el) return;
            el.style.height = "0px";
            el.style.height = `${Math.max(40, el.scrollHeight)}px`;
          }}
          onChange={(e) => onType(e.target.value.replace(/\n/g, " "))}
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
          className="min-h-10 min-w-0 flex-1 resize-none overflow-hidden uppercase bg-transparent px-2.5 py-2 text-sm font-semibold outline-none disabled:text-muted"
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
function OwnerPartDiscount({ percent, reason, options = [], onChange }: { percent: number; reason: string; options?: string[]; onChange: (pct: number, reason: string) => void }) {
  const [pct, setPct] = useState(num(percent));
  const [why, setWhy] = useState(reason);
  const send = (p: string, r: string) => {
    const n = Number(p) || 0;
    if (n === 0 || r.trim()) onChange(n, r.trim());
  };
  const waiting = (Number(pct) || 0) > 0 && !why.trim();
  return (
    <div className="flex flex-col gap-2 text-xs mt-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1"><span className="font-semibold text-muted">Discount %</span><Input value={pct} onChange={(e) => { setPct(e.target.value); send(e.target.value, why); }} inputMode="decimal" className="w-20" /></label>
        {waiting ? <span className="text-amber font-semibold pb-3">Tap or write the reason to apply it.</span> : null}
      </div>
      <ReasonChips name="discount_reason" label="Reason (logged)" options={options} defaultValue={why} placeholder="required" onValue={(v) => { setWhy(v); send(pct, v); }} />
    </div>
  );
}


/**
 * "Discount": one box and a % | AED toggle. It comes off our own labour lines (hours) only, before VAT, before the
 * round-off; parts, outside fixed-price services and other charges are never discounted here.
 */
function LabourDiscountDialog({ kind: initialKind, value: initialValue, scope: initialScope, bases, onClose, onApply }: { kind: "percent" | "aed"; value: number | null | undefined; scope: "labour" | "labour_services"; bases: { labour: number; labour_services: number }; onClose: () => void; onApply: (kind: "percent" | "aed", value: number, scope: "labour" | "labour_services") => void }) {
  const [kind, setKind] = useState<"percent" | "aed">(initialKind);
  const [scope, setScope] = useState<"labour" | "labour_services">(initialScope);
  const base = bases[scope];
  const [text, setText] = useState(initialValue ? String(initialValue) : "");
  const boxRef = useRef<HTMLDivElement>(null);
  const v = Number(text.replace(",", ".")) || 0;
  /** Apply reads the box itself: the number box hands its figure on a moment after typing stops, and a quick tap must not lose it. */
  const current = () => Number((boxRef.current?.querySelector("input")?.value ?? text).replace(",", ".")) || 0;
  const amount = kind === "percent" ? round2(base * (Math.min(100, Math.max(0, v)) / 100)) : round2(Math.min(base, Math.max(0, v)));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div ref={boxRef} className="w-full max-w-md rounded-card bg-white p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()} data-labour-discount-dialog>
        <span className="text-lg font-extrabold">Discount</span>
        <div className="flex flex-wrap gap-1.5" data-discount-scope>
          <button type="button" onClick={() => setScope("labour")} aria-pressed={scope === "labour"} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${scope === "labour" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Labour only</button>
          <button type="button" onClick={() => setScope("labour_services")} aria-pressed={scope === "labour_services"} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${scope === "labour_services" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Labour + services</button>
        </div>
        <p className="text-xs text-muted">{scope === "labour" ? `On our own labour lines only (${aed(base)} of labour).` : `On our labour and our own services (${aed(base)}).`} Never on parts, outside work or other charges. Taken off before VAT, then the round-off.</p>
        <div className="flex items-center gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder="0" autoFocus aria-label="Discount amount" className="w-28 text-right min-h-11" />
          <span className="inline-flex rounded-control border border-line-strong overflow-hidden">
            <button type="button" onClick={() => setKind("percent")} aria-pressed={kind === "percent"} className={`min-h-11 px-4 text-sm font-bold ${kind === "percent" ? "bg-ink text-white" : "bg-white"}`}>%</button>
            <button type="button" onClick={() => setKind("aed")} aria-pressed={kind === "aed"} className={`min-h-11 px-4 text-sm font-bold ${kind === "aed" ? "bg-ink text-white" : "bg-white"}`}>AED</button>
          </span>
        </div>
        <p className="text-sm font-bold text-green" data-labour-discount-preview>{v > 0 ? `− ${aed(amount)} off ${scope === "labour" ? "the labour" : "labour and services"}` : "No discount"}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="md" onClick={() => onApply(kind, current(), scope)}>Apply</Button>
          {initialValue ? <Button type="button" tone="secondary" size="md" onClick={() => onApply(kind, 0, scope)}>Remove the discount</Button> : null}
          <Button type="button" tone="ghost" size="md" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
