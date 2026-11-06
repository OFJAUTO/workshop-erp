/**
 * Zoho Books: MANUAL sync (3 November 2026, section 11 of the 2 November evening batch). The pure rules, no database:
 * the words for every kind of document, the posting order, the preview (what "Sync to Zoho" will send, counted and
 * totalled), the results words, and the once-a-day reminder. Shared by the cron, the Zoho Books page, the Sync to Zoho
 * window, the housekeeping reminder and accounts' Waiting on you, so every screen says the same numbers.
 *   unit test: tests/unit/zoho-sync-rules.test.mjs
 */
import type { ZohoKind } from "./zoho-sync";
import { DEFAULT_UNDO_MINUTES, heldForUndo } from "./money-undo";
import { formatDate } from "./format";

/* ------------------------------------------------------- the mode ------------------------------------------------------- */

/** Manual (the default since 3 November 2026): nothing goes to Zoho until the owner or accounts press Sync to Zoho. */
export type ZohoSyncMode = "manual" | "automatic";

/** A missing or unknown setting is MANUAL: nothing ever posts by itself unless the owner chose it. */
export function syncModeOf(value: unknown): ZohoSyncMode {
  return value === "automatic" ? "automatic" : "manual";
}

export const SYNC_MODE_WORDS: Record<ZohoSyncMode, { title: string; line: string }> = {
  manual: { title: "Manual", line: "Nothing goes to Zoho until the owner or accounts press Sync to Zoho (a preview first, then Yes)." },
  automatic: { title: "Automatic", line: "The system sends what is waiting by itself every five minutes (25 at a time), without a preview." },
};

/* ------------------------------------------------------- the words ------------------------------------------------------- */

/** One word pair per kind: [one, more than one]. THE words on the sync page, the window, the reminder and Waiting on you. */
export const KIND_WORDS: Record<ZohoKind, [string, string]> = {
  contact: ["Customer", "Customers"],
  deposit: ["Deposit", "Deposits"],
  invoice: ["Tax invoice", "Tax invoices"],
  payment: ["Payment", "Payments"],
  creditnote: ["Credit note", "Credit notes"],
  vendor: ["Supplier", "Suppliers"],
  bill: ["Supplier bill", "Supplier bills"],
  billpayment: ["Supplier payment", "Supplier payments"],
  supplierpay: ["Supplier payment", "Supplier payments"],
  commission: ["Commission", "Commissions"],
  recovery: ["Recovery month", "Recovery months"],
  vendorcredit: ["Supplier credit", "Supplier credits"],
  cnrefund: ["Customer refund", "Customer refunds"],
  settlement: ["Card settlement", "Card settlements"],
};

export const ZOHO_KINDS = Object.keys(KIND_WORDS) as ZohoKind[];

/** "Tax invoice" (unknown kinds read as a plain "Document"). */
export function kindWord(kind: string): string {
  return (KIND_WORDS as Record<string, [string, string]>)[kind]?.[0] ?? "Document";
}

/** "1 tax invoice" / "3 tax invoices" (lower case inside a sentence). */
export function kindCount(kind: string, n: number): string {
  const w = (KIND_WORDS as Record<string, [string, string]>)[kind] ?? ["document", "documents"];
  return `${n} ${(n === 1 ? w[0] : w[1]).toLowerCase()}`;
}

/** "1 item" / "12 items". */
export function itemsWord(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`;
}

export const aed = (n: number) => `AED ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Figures = { net?: number | null; vat?: number | null; total?: number | null };
const fils = (n: number) => Math.round(Number((n * 100).toPrecision(12)));
const plain = (n: number) => (fils(n) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => `${n < 0 ? "−" : "+"}${plain(Math.abs(n))}`;

/**
 * THE true check of a posted document (6 November 2026, LPO-00045-1): Zoho's figures against the ERP's, each to the
 * fils. Null when every figure both sides hold is equal, else "1,010.99 vs 1,011.00 (−0.01)" (the total first, then
 * the net or the VAT by name).
 */
export function figuresDiffWords(zoho: Figures, erp: Figures): string | null {
  for (const key of ["total", "net", "vat"] as const) {
    const z = zoho[key];
    const e = erp[key];
    if (typeof z !== "number" || typeof e !== "number") continue;
    if (fils(z) === fils(e)) continue;
    const label = key === "total" ? "" : key === "net" ? "before VAT " : "VAT ";
    return `${label}${plain(z)} vs ${plain(e)} (${signed((fils(z) - fils(e)) / 100)})`;
  }
  return null;
}

/** The kinds whose posted document can be checked again and corrected (one pass) by their handler. */
export const RECHECK_KINDS: string[] = ["bill", "invoice"];

/**
 * A posted row whose figures differ from the ERP's: the red words, else null. `erpNow` (a bill's figures as the ERP
 * computes them TODAY) wins over the figures stored when it posted - a bill posted before the fils rule stored the
 * same wrong figure on both sides.
 */
export function postedDiffers(kind: string, result: Record<string, unknown> | null | undefined, erpNow?: Figures | null): string | null {
  const r = result ?? null;
  if (!r || r.manual === true || typeof r.skipped === "string" || typeof r.reversed === "string") return null;
  const z = (r.zoho ?? null) as Figures | null;
  if (!z) return null;
  if (kind === "bill") {
    const zoho = { net: z.net ?? null, vat: typeof z.total === "number" && typeof z.net === "number" ? z.total - z.net : null, total: z.total ?? null };
    const words = figuresDiffWords(zoho, erpNow ?? ((r.erp ?? {}) as Figures));
    return words ? `Zoho differs: ${words}` : null;
  }
  if (kind === "invoice" || kind === "creditnote" || kind === "vendorcredit") {
    const words = figuresDiffWords({ total: z.total ?? null, vat: kind === "invoice" ? (z.vat ?? null) : null }, (r.erp ?? {}) as Figures);
    return words ? `Zoho differs: ${words}` : null;
  }
  return null;
}

/** What Zoho holds for a posted row, in plain words (the figures the worker stored next to the ERP's). */
export function resultWords(kind: string, result: Record<string, unknown> | null | undefined, erpNow?: Figures | null): string | null {
  const r = result ?? null;
  if (!r) return null;
  if (r.manual === true) return `Done by hand by ${String(r.name ?? "accounts")} on ${formatDate(String(r.at ?? ""))}: ${String(r.note ?? "")}`;
  if (typeof r.skipped === "string") return r.skipped;
  // A receipt voided, or a supplier payment reversed, after it reached Zoho: the run took it back out (review of
  // 3 November 2026: the words used to read "Paid in Zoho · the bill shows AED 0.00 due" for a removal).
  if (typeof r.reversed === "string") {
    const what = kind === "billpayment" ? `the supplier payment${r.lpo ? ` of ${String(r.lpo)}` : ""}` : r.receipt ? String(r.receipt) : "the payment";
    if (/already/i.test(r.reversed)) return `Already removed in Zoho: ${what} (taken back in the ERP).`;
    return `Removed from Zoho: ${what}${typeof r.reason === "string" && r.reason ? ` (${r.reason})` : " (taken back in the ERP)"}.`;
  }
  if (r.e2e_stub && r.e2e === true) return "Posted (test server: no Zoho call)";
  if (kind === "invoice") {
    const z = r.zoho as { total?: number; vat?: number; balance?: number } | undefined;
    if (!z) return null;
    return `In Zoho: ${aed(z.total ?? 0)} · VAT ${aed(z.vat ?? 0)} · balance ${aed(z.balance ?? 0)}${postedDiffers(kind, r) ? "" : " — matches the ERP to the fils"}`;
  }
  if (kind === "creditnote") {
    const z = r.zoho as { total?: number } | undefined;
    if (!z) return null;
    return `Credit note in Zoho: ${aed(z.total ?? 0)} · applied to ${String(r.applied_to ?? "the invoice")}${typeof r.invoice_balance_after === "number" ? ` · invoice balance now ${aed(r.invoice_balance_after)}` : ""}`;
  }
  if (kind === "bill") {
    const z = r.zoho as { net?: number; vat?: number; total?: number; balance?: number } | undefined;
    if (!z) return null;
    const adj = typeof r.vat_adjustment === "number" && r.vat_adjustment !== 0 ? ` · VAT rounding ${aed(r.vat_adjustment)} as the bill's adjustment` : "";
    return `Bill in Zoho: ${aed(z.net ?? 0)} + VAT ${aed(z.vat ?? 0)}${adj} = ${aed(z.total ?? 0)} · due ${aed(z.balance ?? 0)}${r.attached ? " · scan attached" : ""}${r.price_flags ? ` · ${r.price_flags} price flag(s) in the notes` : ""}${postedDiffers(kind, r, erpNow) ? "" : " — matches the ERP to the fils"}`;
  }
  if (kind === "supplierpay") {
    return `Paid in Zoho${typeof r.amount === "number" ? `: ${aed(r.amount)}` : ""}${typeof r.applied === "number" ? ` · ${aed(r.applied)} on ${String(r.bills ?? "")} bill(s)` : ""}${typeof r.excess === "number" && r.excess > 0 ? ` · ${aed(r.excess)} kept as the advance` : ""}${typeof r.fee === "number" && r.fee > 0 ? ` · fee ${aed(r.fee)} as an expense` : ""}`;
  }
  if (kind === "billpayment") {
    return `Paid in Zoho${typeof r.amount === "number" ? `: ${aed(r.amount)}` : ""}${typeof r.method === "string" ? ` · ${r.method}${r.paid_from ? ` from ${String(r.paid_from)}` : ""}` : ""} · the bill shows ${aed(Number(r.bill_balance_after) || 0)} due${typeof r.proof === "string" ? ` · proof ${r.proof}` : ""}`;
  }
  if (kind === "vendorcredit") {
    const z = r.zoho as { total?: number } | undefined;
    if (!z) return null;
    return `Supplier credit in Zoho: ${aed(z.total ?? 0)}${typeof r.applied_now === "number" && r.applied_now > 0 ? ` · ${aed(r.applied_now)} applied to the bill` : ""}${typeof r.bill_balance_after === "number" ? ` · the bill shows ${aed(r.bill_balance_after)} due` : ""}`;
  }
  if (kind === "cnrefund") {
    return `Refund in Zoho${typeof r.refund === "number" ? `: ${aed(r.refund)}` : ""}${typeof r.cn_unapplied_after === "number" ? ` · ${aed(r.cn_unapplied_after)} of the credit left unapplied` : ""}`;
  }
  if (kind === "settlement") {
    return `Transfer to the bank ${aed(Number(r.received ?? 0))}${typeof r.fee === "number" && r.fee > 0 ? ` · bank charges ${aed(r.fee)}` : ""}`;
  }
  if (kind === "commission" || kind === "recovery") {
    const amount = typeof r.amount === "number" ? aed(r.amount) : "";
    return `Expense in Zoho: ${amount}${r.receipt ? " · proof attached" : typeof r.note === "string" ? ` · ${r.note}` : ""}`;
  }
  const amount = typeof r.amount === "number" ? aed(r.amount) : null;
  const charge = typeof r.bank_charges === "number" && r.bank_charges > 0 ? ` · bank charge ${aed(r.bank_charges)}` : "";
  return amount ? `${r.kind === "advance" ? "Advance" : "Payment"} in Zoho: ${amount}${charge}` : typeof r.note === "string" ? r.note : null;
}

/* ------------------------------------------------------- the order ------------------------------------------------------- */

/**
 * The posting order: customers and suppliers first, then the documents that others hang on (deposits before the
 * invoice that applies them, the invoice before its credit notes and payments, the bill before its payment and
 * credits). A manual sync sorts the WHOLE list this way, so a parent always goes before its children in one run.
 */
export const POSTING_ORDER: Record<ZohoKind, number> = { contact: 0, vendor: 1, deposit: 2, invoice: 3, creditnote: 4, payment: 5, cnrefund: 6, bill: 7, vendorcredit: 8, billpayment: 9, supplierpay: 9, commission: 10, recovery: 11, settlement: 12 };

export function sortForPosting<T extends { kind: string; enqueued_at: string }>(rows: T[]): T[] {
  const rank = (k: string) => (POSTING_ORDER as Record<string, number>)[k] ?? 99;
  return [...rows].sort((a, b) => rank(a.kind) - rank(b.kind) || a.enqueued_at.localeCompare(b.enqueued_at));
}

/* ------------------------------------------------------- the preview ------------------------------------------------------- */

/** The groups the preview shows, in the owner's words, in this order. `money` adds the group to "Money in" or "Money out". */
export const PREVIEW_GROUPS: { key: string; label: string; kinds: ZohoKind[]; money: "in" | "out" | null; countOnly?: boolean }[] = [
  { key: "invoices", label: "Tax invoices", kinds: ["invoice"], money: null },
  { key: "payments", label: "Payments and deposits", kinds: ["payment", "deposit"], money: "in" },
  { key: "creditnotes", label: "Credit notes", kinds: ["creditnote"], money: null },
  { key: "refunds", label: "Customer refunds", kinds: ["cnrefund"], money: "out" },
  { key: "bills", label: "Supplier bills", kinds: ["bill"], money: null },
  { key: "billpayments", label: "Supplier payments", kinds: ["billpayment", "supplierpay"], money: "out" },
  { key: "vendorcredits", label: "Supplier credits", kinds: ["vendorcredit"], money: null },
  { key: "settlements", label: "Card settlements", kinds: ["settlement"], money: null },
  { key: "expenses", label: "Expenses (commissions, recovery months)", kinds: ["commission", "recovery"], money: "out" },
  { key: "records", label: "Customer and supplier records", kinds: ["contact", "vendor"], money: null, countOnly: true },
];

/**
 * What sending one waiting row does to the books (review of 3 November 2026), read from the ERP before the press, so
 * the preview's counts and totals are only the money that FIRST reaches Zoho:
 *   new     — the document goes to Zoho for the first time (counted in its group and in Money in / Money out);
 *   again   — it is already in Zoho: the run only looks at it again (a late proof or scan is attached, an advance is
 *             applied to its invoice, a cancellation turns it red for the accountant) — no new money;
 *   removal — voided or reversed in the ERP after it reached Zoho: the run TAKES IT BACK out of Zoho;
 *   nothing — voided, cancelled or internal before it was sent: the row closes and nothing goes to Zoho.
 */
export type RowEffect = "new" | "again" | "removal" | "nothing";

/** The ERP facts behind a row's effect. `removable`: the worker can delete it from Zoho (a receipt, a supplier payment). */
export type EffectFacts = { inZoho: boolean; gone?: boolean; removable?: boolean; notForZoho?: string | null };

/** THE rule of what a row does (zoho-docs reads the facts; the preview, the list and the results follow it). */
export function rowEffect(f: EffectFacts): { effect: RowEffect; words: string | null } {
  if (f.notForZoho) return { effect: "nothing", words: `Nothing goes to Zoho: ${f.notForZoho}.` };
  if (f.gone && !f.inZoho) return { effect: "nothing", words: "Voided or cancelled before it was sent: nothing goes to Zoho." };
  if (f.gone && f.removable) return { effect: "removal", words: "Voided or reversed after it reached Zoho: Yes takes it back out of Zoho." };
  if (f.gone) return { effect: "again", words: "Cancelled after it reached Zoho: it turns red, to be undone in Zoho by hand. No money moves." };
  if (f.inZoho) return { effect: "again", words: "Already in Zoho: looked at again (a late file is attached, or an advance is applied). No new money." };
  return { effect: "new", words: null };
}

/** One pending outbox row, with the document's name, amount and effect read from the ERP (zoho-docs). */
export type PendingRow = {
  id: string;
  kind: ZohoKind;
  record_id: string;
  enqueued_at: string;
  last_error: string | null;
  claimed_at: string | null;
  name: string | null;
  amount: number | null;
  /** The outbox row's own Zoho id: set when the document reached Zoho before and the row was reopened. */
  zoho_id?: string | null;
  effect?: RowEffect;
  effect_words?: string | null;
};

/** The row's effect: the ERP's facts, else "already in Zoho" when the outbox row carries a Zoho id. */
export function effectOfRow(r: Pick<PendingRow, "effect" | "zoho_id">): RowEffect {
  if (r.effect && r.effect !== "new") return r.effect;
  return r.zoho_id ? "again" : "new";
}

export type PreviewGroup = { key: string; label: string; count: number; total: number; countOnly: boolean };

export type PreviewRow = { id: string; kind: ZohoKind; name: string | null; amount: number | null; reason: string | null; effect: RowEffect; words: string | null };

export type SyncPreviewCore = {
  /** The outbox ids this run sends, in posting order (parents first). */
  ids: string[];
  /** The same rows with their names, amounts and effects, for the list under the totals. */
  rows: PreviewRow[];
  /** The groups and Money in / out count ONLY documents that reach Zoho for the first time. */
  groups: PreviewGroup[];
  moneyIn: number;
  moneyOut: number;
  /** Voided or reversed after they reached Zoho: Yes removes them (their own line, never in Money in / out). */
  removals: { count: number; total: number; rows: PreviewRow[] };
  /** Already in Zoho: looked at again (a late file, an allocation); no new money. */
  again: { count: number; rows: PreviewRow[] };
  /** Nothing goes (voided, cancelled or internal before it was sent): the rows close. */
  nothing: { count: number; rows: PreviewRow[] };
  /** Payments, deposits and supplier payments recorded in the last minutes: they can still be undone, so they go next time. */
  held: { count: number; words: string | null; nextAt: string | null };
  /** Rows another run is sending at this moment (claimed in the last ten minutes). */
  beingSent: number;
  /** Rows over the per-run cap (OFJ TEST's daily allowance): they go with the next press. */
  later: number;
  /** About how many Zoho calls the run makes. */
  calls: number;
};

/** A claim younger than this belongs to a run that is still going (the worker's own rule). */
export const CLAIM_FRESH_MS = 10 * 60 * 1000;

/** OFJ TEST allows 1,000 Zoho calls a day: one press sends at most this many rows there (the REAL book has no cap). */
export const RUN_CAP_TEST_ROWS = 120;

/** Rough Zoho calls per row (search, create, check), for the "about N Zoho calls" line. */
export const CALLS_PER_KIND: Record<ZohoKind, number> = { contact: 2, vendor: 2, deposit: 3, payment: 3, invoice: 6, creditnote: 4, cnrefund: 4, bill: 6, billpayment: 4, supplierpay: 5, vendorcredit: 4, commission: 3, recovery: 3, settlement: 4 };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * THE preview: what one press of Sync to Zoho sends. Rows another run holds are left out; payments still inside the
 * undo window are held for the next press; the rest goes in posting order, capped on OFJ TEST. Each group carries its
 * count and its ERP total of the documents that reach Zoho for the FIRST time, so the person confirms exactly the
 * money that goes; what is taken back out of Zoho, looked at again or closed without sending is named on its own.
 */
export function buildPreview(pending: PendingRow[], opts: { undoMinutes?: number; now?: number; cap?: number | null } = {}): SyncPreviewCore {
  const now = opts.now ?? Date.now();
  const undo = opts.undoMinutes ?? DEFAULT_UNDO_MINUTES;
  const beingSent = pending.filter((r) => r.claimed_at && Date.parse(r.claimed_at) > now - CLAIM_FRESH_MS);
  const free = pending.filter((r) => !beingSent.includes(r));
  const held = free.filter((r) => heldForUndo(r.kind, r.enqueued_at, undo, now));
  const sendable = sortForPosting(free.filter((r) => !held.includes(r)));
  const cap = opts.cap ?? null;
  const send = cap && sendable.length > cap ? sendable.slice(0, cap) : sendable;
  const rows: PreviewRow[] = send.map((r) => ({ id: r.id, kind: r.kind, name: r.name, amount: r.amount, reason: r.last_error, effect: effectOfRow(r), words: r.effect_words ?? null }));
  const firstPosts = rows.filter((r) => r.effect === "new");
  const groups: PreviewGroup[] = [];
  for (const g of PREVIEW_GROUPS) {
    const mine = firstPosts.filter((r) => g.kinds.includes(r.kind));
    if (!mine.length) continue;
    groups.push({ key: g.key, label: g.label, count: mine.length, total: g.countOnly ? 0 : round2(mine.reduce((a, r) => a + (Number(r.amount) || 0), 0)), countOnly: !!g.countOnly });
  }
  const sumOf = (dir: "in" | "out") => round2(PREVIEW_GROUPS.filter((g) => g.money === dir).reduce((a, g) => a + (groups.find((x) => x.key === g.key)?.total ?? 0), 0));
  const of = (e: RowEffect) => rows.filter((r) => r.effect === e);
  const removals = of("removal");
  const heldKinds = new Map<string, number>();
  for (const r of held) heldKinds.set(r.kind, (heldKinds.get(r.kind) ?? 0) + 1);
  const nextAtMs = held.length ? Math.min(...held.map((r) => Date.parse(r.enqueued_at) + undo * 60000)) : null;
  return {
    ids: send.map((r) => r.id),
    rows,
    groups,
    moneyIn: sumOf("in"),
    moneyOut: sumOf("out"),
    removals: { count: removals.length, total: round2(removals.reduce((a, r) => a + (Number(r.amount) || 0), 0)), rows: removals },
    again: { count: of("again").length, rows: of("again") },
    nothing: { count: of("nothing").length, rows: of("nothing") },
    held: {
      count: held.length,
      words: held.length ? `${Array.from(heldKinds.entries()).map(([k, n]) => kindCount(k, n)).join(", ")} recorded in the last ${undo} minutes: ${held.length === 1 ? "it" : "they"} can still be undone, so ${held.length === 1 ? "it goes" : "they go"} with the next Sync to Zoho` : null,
      nextAt: nextAtMs ? new Date(nextAtMs).toISOString() : null,
    },
    beingSent: beingSent.length,
    later: sendable.length - send.length,
    calls: send.reduce((a, r) => a + (CALLS_PER_KIND[r.kind] ?? 4), 0) + (send.length ? 2 : 0),
  };
}

/** "Yes, send 12 items to OFJ TEST". */
export function confirmLabel(n: number, bookLabel: string): string {
  return `Yes, sync and record ${itemsWord(n)}${bookLabel ? ` to ${bookLabel}` : ""}`;
}

/** THE question above the confirm button (Mathew, 3 November 2026): it always names the Zoho book. */
export function confirmQuestion(n: number, bookLabel: string): string {
  const book = bookLabel.startsWith("the REAL book") ? "the REAL book, O F J AUTOMOTIVE WORKS LLC" : bookLabel;
  return `Do you want to sync and record ${n === 1 ? "this 1 item" : `these ${n} items`} to Zoho (${book})?`;
}

/** Where a waiting or failed row's problem is FIXED, from its reason (the link beside the words). */
export function reasonHref(reason: string | null | undefined, ctx: { kind?: ZohoKind; recordId?: string | null } = {}): { href: string; label: string } | null {
  if (!reason) return null;
  if (/TRN/i.test(reason)) return { href: "/parts/suppliers?filter=no_trn", label: "Fix the supplier" };
  // "You can specify Tax Treatment only for transactions within tax period" = the supplier invoice DATE is wrong
  // (LPO-00035-2's bill was typed 28/10/2016): fixed on the LPO page, then Retry.
  if (/tax period/i.test(reason) && (ctx.kind === "bill" || ctx.kind === "billpayment") && ctx.recordId) return { href: `/parts/orders/${ctx.recordId}`, label: "Open the LPO (fix the invoice date, then Retry)" };
  if (/mapping missing/i.test(reason)) return { href: "/settings/zoho/mapping", label: "Open the mapping" };
  if (/not connected|presses Connect/i.test(reason)) return { href: "/settings/zoho", label: "Open Zoho settings" };
  if (/cheque/i.test(reason)) return { href: "/invoices?show=awaiting", label: "Open the money list" };
  return null;
}

/** Fix 3 (4 November 2026): a waiting row with nothing holding it still says WHY it waits - its turn. */
export function waitingTurnWords(mode: "manual" | "automatic"): string {
  return mode === "manual"
    ? "Nothing is holding it: it waits for Sync to Zoho (it goes with the next press)."
    : "Nothing is holding it: it goes with the next five-minute run.";
}

/**
 * One ticked row that needs another document first (Mathew, 3 November 2026): the pop-up says so in
 * plain words, offers to add the parent when a press can send it, and explains why it cannot go when
 * the parent is red. Pure: the server finds the parent, this gives the words.
 */
export type NeedLine = {
  /** The ticked row. */
  rowId: string;
  rowKind: ZohoKind;
  rowName: string | null;
  /** The parent's own outbox row to add to the sync (null = it cannot simply be added). */
  addId: string | null;
  words: string;
  href: string | null;
  hrefLabel: string | null;
};
export function needLineOf(child: { id: string; kind: ZohoKind; name: string | null }, parent: { kind: ZohoKind; name: string | null; state: "pending" | "failed" | "absent"; reason: string | null; id: string | null; /** The parent DOCUMENT's id (the LPO, the invoice), for a fix link straight to it. */ recordId?: string | null }): NeedLine {
  const childWord = `${kindWord(child.kind)}${child.name ? ` ${child.name}` : ""}`;
  const parentWord = `${parent.name ? `${parent.name} ` : "its "}${kindWord(parent.kind).toLowerCase()}`;
  if (parent.state === "failed") {
    const fix = reasonHref(parent.reason, { kind: parent.kind, recordId: parent.recordId ?? null });
    return {
      rowId: child.id,
      rowKind: child.kind,
      rowName: child.name,
      addId: null,
      words: `${childWord} waits for the ${parentWord}, which failed: ${parent.reason ?? "see the red row"}. It cannot go until that is fixed.`,
      href: fix?.href ?? "/zoho?show=failed",
      hrefLabel: fix?.label ?? "See the red row",
    };
  }
  if (parent.state === "absent") {
    return { rowId: child.id, rowKind: child.kind, rowName: child.name, addId: null, words: `${childWord} needs the ${parentWord} first; it is not in the queue, so the sync will queue it by itself and this one goes with the next press.`, href: null, hrefLabel: null };
  }
  return { rowId: child.id, rowKind: child.kind, rowName: child.name, addId: parent.id, words: `${childWord} needs the ${parentWord} first.`, href: null, hrefLabel: null };
}

/* ------------------------------------------------------- the results ------------------------------------------------------- */

/**
 * What happened to one row in a run. "waiting": still in the queue with its reason (it goes with a later press).
 * "removed": taken back out of Zoho (voided or reversed in the ERP after it posted). "skipped": the row closed and
 * nothing went to Zoho (voided or cancelled before it was sent, internal, before the go-live start date).
 */
export type RunOutcome = "posted" | "removed" | "skipped" | "failed" | "waiting";
export type RunItem = { id: string; kind: ZohoKind; record_id: string; outcome: RunOutcome; words: string | null; name?: string | null; amount?: number | null; at: string };

export type RunTally = { posted: number; removed: number; skipped: number; failed: number; waiting: number };

export function tallyItems(items: { outcome: RunOutcome }[]): RunTally {
  const n = (o: RunOutcome) => items.filter((i) => i.outcome === o).length;
  return { posted: n("posted"), removed: n("removed"), skipped: n("skipped"), failed: n("failed"), waiting: n("waiting") };
}

/** The outcome of a handler's answer that did not fail or wait: posted, taken back out of Zoho, or closed with nothing sent. */
export function doneOutcome(result: Record<string, unknown> | null | undefined): "posted" | "removed" | "skipped" {
  if (typeof result?.reversed === "string") return "removed";
  if (typeof result?.skipped === "string") return "skipped";
  return "posted";
}

/** "12 posted · 1 removed from Zoho · 2 closed, nothing sent · 1 failed · 2 still waiting" (zero parts left out; "Nothing sent" when all are zero). */
export function runWords(t: { posted: number; failed: number; waiting: number; removed?: number | null; skipped?: number | null }): string {
  const removed = Number(t.removed) || 0;
  const skipped = Number(t.skipped) || 0;
  const parts = [
    t.posted ? `${t.posted} posted` : "",
    removed ? `${removed} removed from Zoho` : "",
    skipped ? `${skipped} closed, nothing sent` : "",
    t.failed ? `${t.failed} failed` : "",
    t.waiting ? `${t.waiting} still waiting` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing sent";
}

/** Merge a chunk's items into what the run already holds: the latest outcome per row wins (a Retry after a failure). */
export function mergeItems(prev: RunItem[], next: RunItem[]): RunItem[] {
  const out = [...prev];
  for (const it of next) {
    const i = out.findIndex((x) => x.id === it.id);
    if (i >= 0) out[i] = { ...out[i], ...it, name: it.name ?? out[i].name, amount: it.amount ?? out[i].amount };
    else out.push(it);
  }
  return out;
}

/** Zoho refused because its own call allowance is used up (OFJ TEST: 1,000 calls a day): the run stops, the row waits. */
export function isRateLimitError(message: string): boolean {
  return /maximum call rate limit|exceeded the maximum|too many requests|HTTP 429|rate limit/i.test(message);
}

export const RATE_LIMIT_WORDS = "Zoho's call allowance is used up for now (OFJ TEST allows 1,000 calls a day): the rest stays waiting. Press Sync to Zoho again later or tomorrow.";

/** The wait written when Zoho could not be reached for the chart of accounts (a hiccup on Zoho's side). */
export const ACCOUNTS_WAIT_WORDS = "Zoho could not be reached for the chart of accounts";

/**
 * THE rule of what a press of Sync to Zoho can move (review of 3 November 2026): a waiting row nobody has tried yet,
 * or one that waits only because Zoho itself was busy (its call allowance, the chart of accounts). A row that was tried
 * and waits for something else — its bill is red, a cheque has not cleared, the owner has not approved — stays
 * waiting however often Sync is pressed: the reminder, the menu number, the button's number and Waiting on you never
 * count it (they name it apart), and it never holds a day back from the reconciliation.
 */
export function sendsOnPress(lastError: string | null | undefined): boolean {
  if (!lastError) return true;
  return /call allowance is used up/i.test(lastError) || lastError.startsWith(ACCOUNTS_WAIT_WORDS);
}

/** The same rule as a PostgREST or-filter on zoho_outbox (for counts and the oldest row): keep the two in step. */
export const SENDS_ON_PRESS_FILTER = "last_error.is.null,last_error.ilike.*call*allowance*is*used*up*,last_error.ilike.Zoho*could*not*be*reached*for*the*chart*of*accounts*";

/** The rows that wait for something a press cannot do, in one sentence (the reminder, Waiting on you, the cron's line). */
export function stuckWords(rows: { kind: string; reason: string | null }[]): string | null {
  if (!rows.length) return null;
  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  const list = sortForPosting(Array.from(byKind.keys()).map((k) => ({ kind: k, enqueued_at: "" })))
    .map((k) => kindCount(k.kind, byKind.get(k.kind) ?? 0))
    .join(", ");
  const first = rows[0].reason ? ` (${rows[0].reason.trim().replace(/[.:]+$/, "")}${rows.length > 1 ? ", and more" : ""})` : "";
  const one = rows.length === 1;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${one ? "waits" : "wait"} for something Sync to Zoho cannot do${first}: fix that first (often a red row on the Zoho Books page), then ${one ? "it goes" : "they go"} with the next sync.`;
}

/**
 * Retry is refused on a row a Retry could post twice: a document in the REAL book's opening balances (hand_only), or
 * one the accountant already did by hand in Zoho (manual) and that turned red again because something was added later
 * — with no Zoho id the handler would make a second document. Null = Retry may run.
 */
export function retryRefusal(result: Record<string, unknown> | null | undefined): string | null {
  if (result?.hand_only === true) return 'This one is corrected by hand in Zoho (it sits in the opening balances): make the change there, then press "Done by hand".';
  if (result?.manual === true) return 'This one was done by hand in Zoho before, so Retry could post it a second time: make the change in Zoho by hand, then press "Done by hand".';
  return null;
}

/** A run that has not moved for this long was closed with the page: it is shown as stopped part-way. */
export const RUN_STALE_MS = 2 * 60 * 1000;

/* ------------------------------------------------------- the reminder ------------------------------------------------------- */

const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The Dubai date (YYYY-MM-DD), hour and weekday id of a moment. Dubai has no daylight saving time. */
export function dubaiClock(nowMs: number): { date: string; hour: number; dayId: string } {
  const d = new Date(nowMs + 4 * 3600000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), dayId: DAY_IDS[d.getUTCDay()] };
}

/**
 * Is today's "X items waiting to sync to Zoho" bell due on this hourly run? Manual mode only, something waiting,
 * nothing stopping the sync, a working day, between the opening and the closing hour, and not told yet today.
 */
export function reminderDue(input: { mode: ZohoSyncMode; nowMs: number; openHour: number; closeHour: number; workingDays: string[]; toldToday: boolean; waiting: number; blocked: string | null }): { due: boolean; reason: string } {
  if (input.mode !== "manual") return { due: false, reason: "Automatic mode: the documents go by themselves." };
  if (input.waiting <= 0) return { due: false, reason: "Nothing waiting." };
  if (input.blocked) return { due: false, reason: `The sync cannot run: ${input.blocked}` };
  const c = dubaiClock(input.nowMs);
  if (input.workingDays.length && !input.workingDays.includes(c.dayId)) return { due: false, reason: "Not a working day." };
  if (c.hour < input.openHour) return { due: false, reason: "Before opening time." };
  if (input.closeHour > input.openHour && c.hour >= input.closeHour) return { due: false, reason: "After closing time." };
  if (input.toldToday) return { due: false, reason: "Already told today." };
  return { due: true, reason: "Due." };
}

/**
 * The bell: "12 items waiting to sync to Zoho", and what they are. `total` and `byKind` are the rows a press would send
 * (sendsOnPress); rows that wait for something else are one sentence after them (`stuck`), never in the title.
 */
export function reminderWords(w: { total: number; byKind: Partial<Record<ZohoKind, number>>; red: number; stuckWords?: string | null }): { title: string; body: string } {
  const kinds = sortForPosting(Object.entries(w.byKind).filter(([, n]) => (n ?? 0) > 0).map(([k]) => ({ kind: k, enqueued_at: "" })));
  const list = kinds.map((k) => kindCount(k.kind, w.byKind[k.kind as ZohoKind] ?? 0)).join(" · ");
  const red = w.red ? ` ${w.red} red row${w.red === 1 ? " needs" : "s need"} a look.` : "";
  const stuck = w.stuckWords ? ` ${w.stuckWords}` : "";
  return {
    title: `${itemsWord(w.total)} waiting to sync to Zoho`,
    body: `${list ? `${list.charAt(0).toUpperCase()}${list.slice(1)}.` : ""}${red}${stuck} Open Zoho Books and press Sync to Zoho: check the preview, then Yes.`.trim(),
  };
}

/**
 * The daily reconciliation in manual mode: a day whose end (Dubai) comes after the oldest row a press would send still
 * waits for Sync to Zoho — compared now it would turn red for documents that simply have not gone yet.
 */
export function dayWaitsForSync(day: string, firstUnsent: string | null): boolean {
  if (!firstUnsent) return false;
  const unsent = Date.parse(firstUnsent);
  if (!Number.isFinite(unsent)) return false;
  return Date.parse(`${day}T00:00:00+04:00`) + 86400000 > unsent;
}

const DAY_MS = 86400000;
const dayEndMs = (day: string) => Date.parse(`${day}T00:00:00+04:00`) + DAY_MS;

/**
 * Is YESTERDAY's check due on this run? Never while the queue is still busy (a saturated drain leaves documents for
 * the next run), never before 00:30 the morning after (the evening's last posts land first); then when the day has no
 * row, when its row was written BEFORE the day ended (a manual check mid-day), or — while it is still yesterday —
 * once an hour while it is red, so a difference that cleared itself goes green again.
 */
export function reconDue(row: { status: string; checked_at: string } | null, day: string, nowMs: number, drainSaturated: boolean): boolean {
  if (drainSaturated) return false;
  const dayEnd = dayEndMs(day);
  if (nowMs < dayEnd + 30 * 60 * 1000) return false;
  if (!row) return true;
  const checked = Date.parse(row.checked_at);
  if (!Number.isFinite(checked) || checked < dayEnd) return true;
  return row.status === "red" && nowMs - checked >= 3600 * 1000;
}

/** How far back the automatic comparison looks for a day it has not compared yet (a long weekend, a holiday). */
export const RECON_LOOKBACK_DAYS = 10;
/** At most this many days are compared per run (each day is several Zoho reads; OFJ TEST allows 1,000 calls a day). */
export const RECON_DAYS_PER_RUN = 3;

/**
 * THE days the automatic, read-only comparison takes on this run (review of 3 November 2026), oldest first: every day
 * of the last RECON_LOOKBACK_DAYS that has no row, or whose row was written before the day ended — not only
 * yesterday — so a day held back because its documents waited for Sync to Zoho is compared after the next sync even
 * when it is no longer yesterday (the Saturday before a Sunday off). Yesterday also keeps its hourly re-check while
 * red. A day still waiting for Sync to Zoho stops the walk (every later day waits too). Capped per run.
 */
export function reconDaysDue(input: { nowMs: number; rows: Record<string, { status: string; checked_at: string } | undefined>; firstUnsent: string | null; drainSaturated: boolean; lookback?: number; cap?: number }): string[] {
  if (input.drainSaturated) return [];
  const lookback = Math.max(1, input.lookback ?? RECON_LOOKBACK_DAYS);
  const cap = Math.max(1, input.cap ?? RECON_DAYS_PER_RUN);
  const yesterday = new Date(input.nowMs + 4 * 3600000 - DAY_MS).toISOString().slice(0, 10);
  const out: string[] = [];
  for (let back = lookback - 1; back >= 0 && out.length < cap; back--) {
    const day = new Date(Date.parse(`${yesterday}T00:00:00Z`) - back * DAY_MS).toISOString().slice(0, 10);
    if (dayWaitsForSync(day, input.firstUnsent)) break;
    const row = input.rows[day] ?? null;
    const checked = row ? Date.parse(row.checked_at) : NaN;
    const due = day === yesterday ? reconDue(row, day, input.nowMs, false) : !row || !(checked >= dayEndMs(day));
    if (due) out.push(day);
  }
  return out;
}

/** "Compared with Zoho: 2026-11-01 identical ✓ · 2026-11-02 a difference – see Reconciliation." (null when nothing was compared). */
export function reconRunWords(days: { day: string; status: string }[]): string | null {
  if (!days.length) return null;
  return `Compared with Zoho: ${days.map((d) => `${d.day} ${d.status === "green" ? "identical ✓" : "a difference – see Reconciliation"}`).join(" · ")}.`;
}

/** The five-minute run's line on Settings > Background jobs while the sync is manual. */
export function manualCronWords(w: { total: number; red: number; stuck?: number }): string {
  return `Manual: ${w.total ? `${itemsWord(w.total)} waiting for Sync to Zoho` : "nothing waiting"}${w.stuck ? ` · ${w.stuck} waiting on something else` : ""}${w.red ? ` · ${w.red} red` : ""}`;
}
