import "server-only";
import type { CurrentStaff } from "@/lib/auth";
import type { ExtraWaiting } from "@/components/WaitingPanel";
import { isTestEnvironment } from "@/lib/environment";
import { notifyRoles } from "@/lib/notifications";
import { pageAll } from "@/lib/page-all";
import { syncRunsReady } from "@/lib/schema-ready";
import { getSettings, type Settings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZOHO_REAL_ORG_ID, ZohoError, zohoBooksNow, zohoConfigured, zohoConnection, zohoTestOrgId } from "@/lib/zoho";
import { outboxDocs } from "@/lib/zoho-docs";
import { reconcileDueDays } from "@/lib/zoho-reconcile";
import { DEFAULT_UNDO_MINUTES } from "@/lib/money-undo";
import {
  NOT_SET_UP_WORDS,
  NO_TEST_ORG_WORDS,
  STOPPED_WORDS,
  drainZohoOutbox,
  runOutboxRows,
  type FakeZoho,
  type ZohoKind,
} from "@/lib/zoho-sync";
import {
  RUN_CAP_TEST_ROWS,
  RUN_STALE_MS,
  buildPreview,
  dubaiClock,
  itemsWord,
  manualCronWords,
  mergeItems,
  needLineOf,
  reconRunWords,
  reminderDue,
  reminderWords,
  retryRefusal,
  sendsOnPress,
  stuckWords,
  syncModeOf,
  tallyItems,
  type NeedLine,
  type PendingRow,
  type RunItem,
  type SyncPreviewCore,
  type ZohoSyncMode,
} from "@/lib/zoho-sync-rules";

/**
 * ZOHO BOOKS ON MANUAL (3 November 2026, the owner's section 11): nothing goes to Zoho by itself any more. The owner or
 * accounts press "Sync to Zoho" on the Zoho Books page: a preview first (how many tax invoices, payments, bills,
 * settlements, and their totals), then "Yes, send", then the results list in the same window (posted, failed with the
 * reason and Retry, still waiting with the reason). Each run is stored (zoho_sync_runs, once the migration is applied).
 * Once a working day accounts and the owner are told "X items waiting to sync to Zoho". The owner alone can switch the
 * sync back to automatic (the five-minute cron then sends by itself, exactly as before).
 *
 * The go-live rules are untouched: the write guard in zohoFetch, the start-date gates, Stop/Resume and the per-row
 * claim all apply to a manual run exactly as to the cron.
 */

/** How long one press works before it answers the screen (the window then asks for the next part). */
const CHUNK_MS = 45_000;

/* ------------------------------------------------------- the state ------------------------------------------------------- */

export type SendState = {
  mode: ZohoSyncMode;
  /** Why nothing can be sent right now, in plain words (null = ready). */
  block: string | null;
  org: string | null;
  real: boolean;
  /** "OFJ TEST" or "the REAL book (O F J AUTOMOTIVE WORKS LLC)". */
  bookLabel: string;
  /** The TEST server with no Zoho at all: only rows a test marked are "sent" (by the stand-in, never to Zoho). */
  testStub: boolean;
};

/** Where a press of Sync to Zoho would send, read fresh, and what (if anything) stops it. */
export async function sendState(): Promise<SendState> {
  const books = await zohoBooksNow();
  const mode: ZohoSyncMode = books.auto ? "automatic" : "manual";
  const testStub = isTestEnvironment() && !zohoConfigured();
  const real = books.live;
  const org = real ? ZOHO_REAL_ORG_ID : await zohoTestOrgId();
  const bookLabel = real ? "the REAL book (O F J AUTOMOTIVE WORKS LLC)" : "OFJ TEST";
  let block: string | null = null;
  if (!zohoConfigured()) block = testStub ? null : NOT_SET_UP_WORDS;
  else if (!books.live && books.wentLive) block = STOPPED_WORDS;
  else if (!(await zohoConnection())) block = "Zoho Books is not connected: the owner presses Connect on Settings > Zoho Books.";
  else if (!org) block = NO_TEST_ORG_WORDS;
  return { mode, block, org, real, bookLabel, testStub };
}

/* ------------------------------------------------------- what waits ------------------------------------------------------- */

type OutboxPending = { id: string; kind: ZohoKind; record_id: string; enqueued_at: string; last_error: string | null; claimed_at: string | null; zoho_id: string | null };

/** Every row waiting to go (past PostgREST's 1,000-row page), with the documents' names, amounts and effects when asked. */
export async function loadPendingRows(withDocs = true): Promise<PendingRow[]> {
  const admin = createAdminClient();
  const rows = await pageAll<OutboxPending>((a, b) => admin.from("zoho_outbox").select("id, kind, record_id, enqueued_at, last_error, claimed_at, zoho_id").eq("status", "pending").order("enqueued_at").range(a, b));
  const docs = withDocs ? await outboxDocs(rows, { billFigures: true }) : new Map();
  return rows.map((r) => {
    const d = docs.get(`${r.kind}:${r.record_id}`);
    return { ...r, name: d?.name ?? null, amount: d?.amount ?? null, effect: d?.effect, effect_words: d?.effectWords ?? null };
  });
}

export type WaitingCounts = {
  /** Rows a press of Sync to Zoho would send (sendsOnPress): THE number on the bell, the menu, the button and Waiting on you. */
  total: number;
  byKind: Partial<Record<ZohoKind, number>>;
  red: number;
  /** The oldest of those rows (Waiting on you's "since"). */
  oldest: string | null;
  /** Rows tried before that wait for something a press cannot do (a red bill, a cheque, the owner): named apart, never counted above. */
  stuck: number;
  stuckWords: string | null;
};

/**
 * THE count of what waits (the nav badge, the reminder, Waiting on you, the cron's line, the button). Review of
 * 3 November 2026: only the rows a press would move are counted, so pressing Sync to Zoho always clears the number
 * (a supplier payment waiting for its red bill used to keep the bell ringing and the line red every day); the rows
 * that wait for something else are one sentence apart, with what they wait for.
 */
export async function waitingCounts(): Promise<WaitingCounts> {
  const admin = createAdminClient();
  const [rows, { count: red }] = await Promise.all([
    pageAll<{ kind: ZohoKind; enqueued_at: string; last_error: string | null }>((a, b) => admin.from("zoho_outbox").select("kind, enqueued_at, last_error").eq("status", "pending").order("enqueued_at").range(a, b)),
    admin.from("zoho_outbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  const press = rows.filter((r) => sendsOnPress(r.last_error));
  const stuck = rows.filter((r) => !sendsOnPress(r.last_error));
  const byKind: Partial<Record<ZohoKind, number>> = {};
  for (const r of press) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  return { total: press.length, byKind, red: red ?? 0, oldest: press[0]?.enqueued_at ?? null, stuck: stuck.length, stuckWords: stuckWords(stuck.map((r) => ({ kind: r.kind, reason: r.last_error }))) };
}

async function undoMinutes(): Promise<number> {
  return Number(((await getSettings()) as unknown as Record<string, unknown>).money_undo_minutes) || DEFAULT_UNDO_MINUTES;
}

/* ------------------------------------------------------- the preview ------------------------------------------------------- */

export type SyncPreview = SyncPreviewCore & {
  state: SendState;
  red: number;
  /** Someone else's run that is still going (one at a time). */
  runningBy: { name: string; startedAt: string } | null;
  /** A selection (ticked rows, "Sync this"): what was asked for, and the rows that left the queue meanwhile. */
  selected: { asked: number; missing: number } | null;
  /** Ticked rows that need another document first: the words, the add button, the fix link (Mathew, 3 November 2026). */
  needs: NeedLine[];
};

/** A run of someone else's that is still moving (its window is open and sending). */
async function freshRunningRun(): Promise<{ id: string; name: string; startedAt: string } | null> {
  if (!(await syncRunsReady())) return null;
  const admin = createAdminClient();
  // A run whose page closed part-way stops being "in progress" after two quiet minutes.
  await admin.from("zoho_sync_runs").update({ status: "stopped", stop_reason: "The window closed before the end: the rest stayed waiting.", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("status", "running").lt("heartbeat_at", new Date(Date.now() - RUN_STALE_MS).toISOString());
  const { data } = await admin.from("zoho_sync_runs").select("id, started_name, started_at").eq("status", "running").maybeSingle();
  const r = data as { id: string; started_name: string | null; started_at: string } | null;
  return r ? { id: r.id, name: r.started_name ?? "Someone", startedAt: r.started_at } : null;
}

/**
 * THE preview the window shows before anything is sent. Reads the ERP only — never Zoho. With `onlyIds`
 * (ticked rows, "Sync this") the preview covers exactly those rows, and `needs` names any ticked row that
 * hangs on a document outside the selection — with the row to add, or why it cannot go.
 */
export async function loadSyncPreview(onlyIds: string[] | null = null): Promise<SyncPreview> {
  const [state, all, minutes, running, { count: red }] = await Promise.all([
    sendState(),
    loadPendingRows(true),
    undoMinutes(),
    freshRunningRun(),
    createAdminClient().from("zoho_outbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  const asked = onlyIds ? new Set(onlyIds.filter((x) => typeof x === "string").slice(0, 2000)) : null;
  const pending = asked ? all.filter((r) => asked.has(r.id)) : all;
  const core = buildPreview(pending, { undoMinutes: minutes, cap: state.real ? null : RUN_CAP_TEST_ROWS });
  const needs = asked ? await selectionNeeds(pending, all, new Set(pending.map((r) => r.id))) : [];
  return {
    ...core,
    state,
    red: red ?? 0,
    runningBy: running ? { name: running.name, startedAt: running.startedAt } : null,
    selected: asked ? { asked: asked.size, missing: asked.size - pending.length } : null,
    needs,
  };
}

/* ------------------------------------------------- what a row hangs on ------------------------------------------------- */

type ParentRef = { kind: ZohoKind; record: string; name: string | null; synced: boolean };

/**
 * The document each ticked row needs FIRST, found from the ERP's own ids (3 November 2026, Mathew's A2):
 * a supplier payment its bill, a bill its supplier, a payment its tax invoice, a deposit and an invoice
 * their customer, a credit note its invoice, a refund its credit note, a supplier credit its bill, a
 * settlement its payments. One level is enough for the pop-up — the run itself orders and queues deeper.
 */
export async function selectionNeeds(children: PendingRow[], allPending: PendingRow[], inSync: Set<string>): Promise<NeedLine[]> {
  if (!children.length) return [];
  const admin = createAdminClient();
  const ids = (kind: ZohoKind) => children.filter((c) => c.kind === kind).map((c) => c.record_id);
  const read = async <T,>(q: PromiseLike<{ data: T[] | null }>): Promise<T[]> => ((await q).data ?? []) as T[];
  const want: ZohoKind[] = ["billpayment", "bill", "payment", "deposit", "invoice", "creditnote", "cnrefund", "vendorcredit", "settlement"];
  if (!children.some((c) => want.includes(c.kind))) return [];

  // The linkage, batched per kind (every list here is the selection's own records: a handful).
  const [pos, pays, invs, cns, refunds, vcLines, settles] = await Promise.all([
    ids("billpayment").length || ids("bill").length ? read<{ id: string; zoho_bill_id: string | null; supplier_id: string | null; supplier_name: string | null; number: string }>(admin.from("purchase_orders").select("id, zoho_bill_id, supplier_id, supplier_name, number").in("id", [...ids("billpayment"), ...ids("bill")])) : [],
    ids("payment").length || ids("deposit").length ? read<{ id: string; invoice_id: string | null; customer_id: string }>(admin.from("payments").select("id, invoice_id, customer_id").in("id", [...ids("payment"), ...ids("deposit")])) : [],
    ids("invoice").length ? read<{ id: string; customer_id: string; number: string }>(admin.from("invoices").select("id, customer_id, number").in("id", ids("invoice"))) : [],
    ids("creditnote").length ? read<{ id: string; credit_of: string | null; number: string }>(admin.from("invoices").select("id, credit_of, number").in("id", ids("creditnote"))) : [],
    ids("cnrefund").length ? read<{ id: string; zoho_creditnote_id: string | null; number: string }>(admin.from("invoices").select("id, zoho_creditnote_id, number").in("id", ids("cnrefund"))) : [],
    ids("vendorcredit").length ? read<{ part_item_id: string; purchase_order_id: string }>(admin.from("purchase_order_lines").select("part_item_id, purchase_order_id").in("part_item_id", ids("vendorcredit"))) : [],
    ids("settlement").length ? read<{ id: string; settlement_id: string; receipt_number: string | null; zoho_payment_id: string | null }>(admin.from("payments").select("id, settlement_id, receipt_number, zoho_payment_id").in("settlement_id", ids("settlement"))) : [],
  ]);
  const parentInvoiceIds = [...pays.map((p) => p.invoice_id).filter((x): x is string => !!x), ...cns.map((c) => c.credit_of).filter((x): x is string => !!x)];
  const vcPoIds = vcLines.map((l) => l.purchase_order_id);
  const [parentInvs, custRows, supRows, vcPos] = await Promise.all([
    parentInvoiceIds.length ? read<{ id: string; zoho_invoice_id: string | null; number: string }>(admin.from("invoices").select("id, zoho_invoice_id, number").in("id", parentInvoiceIds)) : [],
    (() => {
      const cids = [...pays.filter((p) => !p.invoice_id).map((p) => p.customer_id), ...invs.map((i) => i.customer_id)].filter(Boolean);
      return cids.length ? read<{ id: string; zoho_contact_id: string | null; full_name: string | null; company_name: string | null }>(admin.from("customers").select("id, zoho_contact_id, full_name, company_name").in("id", cids)) : [];
    })(),
    (() => {
      const sids = pos.map((p) => p.supplier_id).filter((x): x is string => !!x);
      return sids.length ? read<{ id: string; zoho_vendor_id: string | null; name: string }>(admin.from("suppliers").select("id, zoho_vendor_id, name").in("id", sids)) : [];
    })(),
    vcPoIds.length ? read<{ id: string; zoho_bill_id: string | null; number: string }>(admin.from("purchase_orders").select("id, zoho_bill_id, number").in("id", vcPoIds)) : [],
  ]);
  const poOf = new Map(pos.map((p) => [p.id, p]));
  const payOf = new Map(pays.map((p) => [p.id, p]));
  const invOf = new Map(invs.map((i) => [i.id, i]));
  const parentInvOf = new Map(parentInvs.map((i) => [i.id, i]));
  const custOf = new Map(custRows.map((c) => [c.id, c]));
  const supOf = new Map(supRows.map((s) => [s.id, s]));
  const vcPoOfPart = new Map(vcLines.map((l) => [l.part_item_id, vcPos.find((p) => p.id === l.purchase_order_id) ?? null]));

  const parentsOf = (c: PendingRow): ParentRef[] => {
    if (c.kind === "billpayment") {
      const po = poOf.get(c.record_id);
      return po ? [{ kind: "bill", record: po.id, name: `${po.supplier_name ?? ""} ${po.number}`.trim(), synced: !!po.zoho_bill_id }] : [];
    }
    if (c.kind === "bill") {
      const po = poOf.get(c.record_id);
      const sup = po?.supplier_id ? supOf.get(po.supplier_id) : null;
      return sup ? [{ kind: "vendor", record: sup.id, name: sup.name, synced: !!sup.zoho_vendor_id }] : [];
    }
    if (c.kind === "payment" || c.kind === "deposit") {
      const p = payOf.get(c.record_id);
      if (!p) return [];
      if (p.invoice_id) {
        const inv = parentInvOf.get(p.invoice_id);
        return inv ? [{ kind: "invoice", record: inv.id, name: inv.number, synced: !!inv.zoho_invoice_id }] : [];
      }
      const cu = custOf.get(p.customer_id);
      return cu ? [{ kind: "contact", record: cu.id, name: cu.company_name ?? cu.full_name, synced: !!cu.zoho_contact_id }] : [];
    }
    if (c.kind === "invoice") {
      const inv = invOf.get(c.record_id);
      const cu = inv ? custOf.get(inv.customer_id) : null;
      return cu ? [{ kind: "contact", record: cu.id, name: cu.company_name ?? cu.full_name, synced: !!cu.zoho_contact_id }] : [];
    }
    if (c.kind === "creditnote") {
      const cn = cns.find((x) => x.id === c.record_id);
      const inv = cn?.credit_of ? parentInvOf.get(cn.credit_of) : null;
      return inv ? [{ kind: "invoice", record: inv.id, name: inv.number, synced: !!inv.zoho_invoice_id }] : [];
    }
    if (c.kind === "cnrefund") {
      const cn = refunds.find((x) => x.id === c.record_id);
      return cn ? [{ kind: "creditnote", record: cn.id, name: cn.number, synced: !!cn.zoho_creditnote_id }] : [];
    }
    if (c.kind === "vendorcredit") {
      const po = vcPoOfPart.get(c.record_id);
      return po ? [{ kind: "bill", record: po.id, name: po.number, synced: !!po.zoho_bill_id }] : [];
    }
    if (c.kind === "settlement") {
      return settles.filter((s) => s.settlement_id === c.record_id && !s.zoho_payment_id).map((s) => ({ kind: "payment" as ZohoKind, record: s.id, name: s.receipt_number, synced: false }));
    }
    return [];
  };

  // The failed rows too: a parent in red is WHY the child cannot go.
  const failedRows = await pageAll<{ id: string; kind: ZohoKind; record_id: string; last_error: string | null }>((a, b) => admin.from("zoho_outbox").select("id, kind, record_id, last_error").eq("status", "failed").order("enqueued_at").range(a, b));
  const out: NeedLine[] = [];
  for (const c of children) {
    for (const parent of parentsOf(c)) {
      if (parent.synced) continue;
      const pend = allPending.find((r) => r.kind === parent.kind && r.record_id === parent.record);
      if (pend && inSync.has(pend.id)) continue; // already ticked: the run sends it first by itself.
      if (pend) {
        out.push(needLineOf({ id: c.id, kind: c.kind, name: c.name }, { kind: parent.kind, name: parent.name ?? pend.name, state: "pending", reason: null, id: pend.id }));
        continue;
      }
      const failed = failedRows.find((r) => r.kind === parent.kind && r.record_id === parent.record);
      if (failed) {
        out.push(needLineOf({ id: c.id, kind: c.kind, name: c.name }, { kind: parent.kind, name: parent.name, state: "failed", reason: failed.last_error, id: null, recordId: parent.record }));
        continue;
      }
      out.push(needLineOf({ id: c.id, kind: c.kind, name: c.name }, { kind: parent.kind, name: parent.name, state: "absent", reason: null, id: null }));
    }
  }
  return out;
}

/** The "why is this still waiting" words for the Zoho page's own list (every pending row, no selection). */
export async function pendingNeedsMap(rows: PendingRow[]): Promise<Map<string, NeedLine>> {
  const needs = await selectionNeeds(rows, rows, new Set());
  const map = new Map<string, NeedLine>();
  for (const n of needs) if (!map.has(n.rowId)) map.set(n.rowId, n);
  return map;
}

/* ------------------------------------------------------- the run ------------------------------------------------------- */

/** The stand-in for Zoho on the TEST server (the browser proof): a row a test marked with zoho_result.e2e_stub. */
function e2eFake(): FakeZoho | undefined {
  if (!isTestEnvironment()) return undefined;
  return {
    applies: (row) => typeof row.zoho_result?.e2e_stub === "string",
    run: (row, attempt) => {
      const stub = String(row.zoho_result?.e2e_stub);
      const words = typeof row.zoho_result?.e2e_words === "string" ? String(row.zoho_result.e2e_words) : null;
      if (stub === "post" || (stub === "fail_once" && attempt > 1)) return { zohoId: `E2E-${row.id.slice(0, 8)}`, result: { e2e: true, e2e_stub: stub } };
      if (stub === "wait") return { wait: words ?? "Test: waits for its parent document." };
      if (stub === "skip") return { result: { skipped: words ?? "Voided in the ERP before it was posted. Nothing went to Zoho.", e2e_stub: stub } };
      if (stub === "reverse") return { zohoId: `E2E-${row.id.slice(0, 8)}`, result: { receipt: words ?? "the payment", reversed: "removed from Zoho", reason: "voided (e2e)", e2e_stub: stub } };
      throw new ZohoError(words ?? "Zoho said: test refusal (e2e).");
    },
  };
}

export type StartResult = { runId: string | null; ids: string[]; error: string | null };

/**
 * Yes, send: the run takes ONLY the rows the person saw that are still waiting now (a row that arrived after the
 * preview goes with the next press), in posting order. One run at a time once the runs table exists.
 */
export async function startSyncRun(staff: CurrentStaff, idsIn: string[], preview: Record<string, unknown>): Promise<StartResult> {
  const state = await sendState();
  if (state.block) return { runId: null, ids: [], error: state.block };
  const asked = new Set(idsIn.filter((x) => typeof x === "string").slice(0, 2000));
  const pending = (await loadPendingRows(false)).filter((r) => asked.has(r.id));
  const ids = buildPreview(pending, { undoMinutes: await undoMinutes(), cap: null }).ids;
  if (!ids.length) return { runId: null, ids: [], error: "Nothing from that preview is waiting any more (it was sent meanwhile, or is being sent now). Press Sync to Zoho again for a fresh preview." };
  if (!(await syncRunsReady())) return { runId: null, ids, error: null };
  const running = await freshRunningRun();
  if (running) return { runId: null, ids: [], error: `${running.name} is sending to Zoho now (started ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(running.startedAt))}). Wait for it to finish, then press Sync to Zoho again.` };
  const { data, error } = await createAdminClient()
    .from("zoho_sync_runs")
    .insert({ org: state.org, book_label: state.bookLabel, started_by: staff.id, started_name: staff.display_name, preview, outbox_ids: ids, status: "running" })
    .select("id")
    .maybeSingle();
  if (error) return { runId: null, ids: [], error: /duplicate|unique/i.test(error.message) ? "Someone else started a sync a moment ago. Wait for it to finish, then press Sync to Zoho again." : `The sync could not start: ${error.message}` };
  return { runId: (data as { id: string } | null)?.id ?? null, ids, error: null };
}

export type ChunkResult = { items: RunItem[]; left: string[]; stopped: string | null; error: string | null };

/** One part of a run (about 45 seconds of sending), then the window asks for the next part. */
export async function runSyncChunk(staff: CurrentStaff, runId: string | null, idsIn: string[]): Promise<ChunkResult> {
  void staff;
  let ids = Array.from(new Set(idsIn.filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))).slice(0, 2000);
  const admin = createAdminClient();
  type StoredRun = { id: string; status: string; outbox_ids: string[]; items: RunItem[] };
  let run: StoredRun | null = null;
  if (runId && (await syncRunsReady())) {
    const { data } = await admin.from("zoho_sync_runs").select("id, status, outbox_ids, items").eq("id", runId).maybeSingle();
    run = data as StoredRun | null;
    if (!run) return { items: [], left: [], stopped: null, error: "This sync is not on record any more. Press Sync to Zoho again." };
    if (run.status !== "running") return { items: [], left: [], stopped: null, error: "This sync was closed (the window was away too long). What was sent stays posted; press Sync to Zoho again for the rest." };
    // Only the rows the person confirmed: the browser's list is a selection, never trusted beyond it.
    const confirmed = new Set(run.outbox_ids);
    ids = ids.filter((id) => confirmed.has(id));
    await admin.from("zoho_sync_runs").update({ heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id);
  }
  const r = await runOutboxRows(ids, { deadlineMs: Date.now() + CHUNK_MS, fake: e2eFake() });
  const docs = await outboxDocs(r.items.filter((i) => i.record_id).map((i) => ({ kind: i.kind, record_id: i.record_id })), { billFigures: true });
  const items = r.items.map((i) => ({ ...i, name: docs.get(`${i.kind}:${i.record_id}`)?.name ?? null, amount: docs.get(`${i.kind}:${i.record_id}`)?.amount ?? null }));
  if (run) {
    const merged = mergeItems(Array.isArray(run.items) ? run.items : [], items);
    const t = tallyItems(merged);
    await admin.from("zoho_sync_runs").update({ items: merged, posted: t.posted, removed: t.removed, skipped: t.skipped, failed: t.failed, waiting: t.waiting, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id);
  }
  return { items, left: r.left, stopped: r.stopped, error: null };
}

/** The run's end: stored as done or stopped (with why), then the recent days whose documents went are compared (read-only). */
export async function finishSyncRun(runId: string | null, how: "done" | "stopped", reason: string | null): Promise<{ recon: string | null }> {
  if (runId && (await syncRunsReady())) {
    await createAdminClient()
      .from("zoho_sync_runs")
      .update({ status: how, stop_reason: how === "stopped" ? (reason ?? "Stopped part-way: the rest stayed waiting.").slice(0, 300) : null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "running");
  }
  // Read-only comparison of every recent day that is due now — a day held back while its documents waited (the
  // Saturday before a Sunday off) included, not only yesterday. Never on a server without Zoho.
  if (!zohoConfigured()) return { recon: null };
  return { recon: reconRunWords(await reconcileDueDays({ drainSaturated: false })) };
}

/** Retry: the ONE red row goes back in the queue and is sent at once — never any other row. */
export async function retryOneRow(id: string): Promise<{ item: RunItem | null; error: string | null }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { item: null, error: "Unknown row." };
  const admin = createAdminClient();
  // A row only a human can settle is never re-run: a document in the REAL book's opening balances, or one the
  // accountant already did by hand in Zoho that turned red again when something was added (with no Zoho id the
  // handler could make a second document). THE rule: retryRefusal.
  const { data: row } = await admin.from("zoho_outbox").select("status, zoho_result").eq("id", id).maybeSingle();
  if (!row) return { item: null, error: "This row is no longer in the queue." };
  const refused = retryRefusal((row as { zoho_result?: Record<string, unknown> | null }).zoho_result);
  if (refused) return { item: null, error: refused };
  if ((row as { status: string }).status === "failed") await admin.from("zoho_outbox").update({ status: "pending", last_error: null, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "failed");
  const r = await runOutboxRows([id], { deadlineMs: Date.now() + CHUNK_MS, fake: e2eFake() });
  const it = r.items[0] ?? null;
  if (!it) return { item: null, error: null };
  const docs = it.record_id ? await outboxDocs([{ kind: it.kind, record_id: it.record_id }], { billFigures: true }) : new Map();
  return { item: { ...it, name: docs.get(`${it.kind}:${it.record_id}`)?.name ?? null, amount: docs.get(`${it.kind}:${it.record_id}`)?.amount ?? null }, error: null };
}

/* ------------------------------------------------------- stored runs ------------------------------------------------------- */

export type SyncRunRow = { id: string; org: string | null; book_label: string | null; started_name: string | null; started_at: string; heartbeat_at: string; finished_at: string | null; status: "running" | "done" | "stopped"; stop_reason: string | null; posted: number; removed: number | null; skipped: number | null; failed: number; waiting: number; items: RunItem[]; outbox_ids: string[] };

const RUN_SELECT = "id, org, book_label, started_name, started_at, heartbeat_at, finished_at, status, stop_reason, posted, removed, skipped, failed, waiting, items, outbox_ids";

/** The latest runs for the "Last syncs" card (nothing before the migration). */
export async function loadRecentRuns(limit = 5): Promise<SyncRunRow[]> {
  if (!(await syncRunsReady())) return [];
  const { data } = await createAdminClient().from("zoho_sync_runs").select(RUN_SELECT).order("started_at", { ascending: false }).limit(limit);
  return (data ?? []) as unknown as SyncRunRow[];
}

type RowNow = { status: string; last_error: string | null; zoho_result: Record<string, unknown> | null };

/** One run and the CURRENT state of each of its rows (a row retried since shows posted; Retry hidden where it is refused). */
export async function loadRun(id: string): Promise<{ run: SyncRunRow; now: Map<string, RowNow> } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await syncRunsReady())) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("zoho_sync_runs").select(RUN_SELECT).eq("id", id).maybeSingle();
  const run = data as unknown as SyncRunRow | null;
  if (!run) return null;
  const ids = (Array.isArray(run.items) ? run.items : []).map((i) => i.id);
  const now = new Map<string, RowNow>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: rows } = await admin.from("zoho_outbox").select("id, status, last_error, zoho_result").in("id", ids.slice(i, i + 150));
    for (const r of (rows ?? []) as (RowNow & { id: string })[]) now.set(r.id, { status: r.status, last_error: r.last_error, zoho_result: r.zoho_result });
  }
  return { run, now };
}

/* ------------------------------------------------------- the cron ------------------------------------------------------- */

/**
 * The five-minute run (3 November 2026): it SENDS only while the owner chose automatic; on manual it only counts what
 * waits (its line on Settings > Background jobs) and keeps the read-only reconciliation of yesterday. It always
 * answers, so the job is never "late" because the sync is manual.
 */
export async function zohoCronTick(limit: number): Promise<{ words: string; pushed: number; failed: number; waiting: number; recon: { day: string; status: string }[] }> {
  const reconWords = (days: { day: string; status: string }[]) => (days.length ? ` · reconciled ${days.map((d) => `${d.day}: ${d.status}`).join(", ")}` : "");
  const books = await zohoBooksNow();
  if (books.auto) {
    const r = await drainZohoOutbox(limit, { requireAuto: true });
    const recon = zohoConfigured() ? await reconcileDueDays({ drainSaturated: r.pushed + r.failed + r.waiting >= limit }) : [];
    const words = (r.skipped ?? `${r.pushed} posted · ${r.failed} failed · ${r.waiting} waiting`) + reconWords(recon);
    return { words, pushed: r.pushed, failed: r.failed, waiting: r.waiting, recon };
  }
  const w = await waitingCounts();
  // The comparison reads Zoho (GET only); a server without Zoho has nothing to compare against. Every recent day that
  // is due, not only yesterday: a day held back until its documents were sent is compared once they went.
  const recon = zohoConfigured() ? await reconcileDueDays({ drainSaturated: false }) : [];
  return { words: manualCronWords(w) + reconWords(recon), pushed: 0, failed: 0, waiting: w.total, recon };
}

/* ------------------------------------------------------- the reminder ------------------------------------------------------- */

/**
 * Once a working day from the opening hour (the hourly housekeeping), while the sync is manual: one bell to accounts and
 * the owner, "12 items waiting to sync to Zoho", with what they are and the red rows. Never twice the same Dubai day
 * (a bell of this type today means told), never in automatic mode, never when the sync cannot run.
 */
export async function zohoWaitingReminder(settings: Settings, nowMs = Date.now()): Promise<{ sent: number; reason: string; title?: string; waiting: number }> {
  const [state, w] = await Promise.all([sendState(), waitingCounts()]);
  const today = dubaiClock(nowMs).date;
  const { data: told } = await createAdminClient().from("notifications").select("id").eq("type", "zoho_waiting").gte("created_at", new Date(`${today}T00:00:00+04:00`).toISOString()).limit(1);
  const due = reminderDue({
    mode: syncModeOf(state.mode),
    nowMs,
    openHour: Number(settings.opening_hour) || 8,
    closeHour: Number(settings.closing_hour) || 17,
    workingDays: Array.isArray(settings.working_days) ? settings.working_days : [],
    toldToday: !!told?.length,
    waiting: w.total,
    blocked: state.block,
  });
  if (!due.due) return { sent: 0, reason: due.reason, waiting: w.total };
  const words = reminderWords({ total: w.total, byKind: w.byKind, red: w.red, stuckWords: w.stuckWords });
  await notifyRoles(["owner", "accounts"], { type: "zoho_waiting", title: words.title, body: words.body, href: "/zoho?sync=1" });
  return { sent: 1, reason: "Sent.", title: words.title, waiting: w.total };
}

/** The same count on Waiting on you (accounts and the owner), while the sync is manual: one line, the button behind it. */
export async function zohoWaitingExtra(): Promise<ExtraWaiting[]> {
  const settings = await getSettings();
  if (syncModeOf(settings.zoho_sync_mode) !== "manual") return [];
  const w = await waitingCounts();
  // Only what a press would send: rows that wait for something else (a red bill) never make a line Sync cannot clear.
  if (!w.total) return [];
  const words = reminderWords({ total: w.total, byKind: w.byKind, red: w.red, stuckWords: w.stuckWords });
  const oldHours = w.oldest ? (Date.now() - Date.parse(w.oldest)) / 3600000 : 0;
  return [
    {
      jobId: "zoho:waiting",
      plate: "Zoho Books",
      car: null,
      what: words.title,
      amount: null,
      actionLabel: "Sync to Zoho",
      href: "/zoho?sync=1",
      always: true,
      urgency: oldHours >= 24 ? "amber" : "grey",
      since: w.oldest,
      hint: `Nothing goes to Zoho by itself: press Sync to Zoho, check the preview (how many and the totals), then Yes.${w.stuckWords ? ` ${w.stuckWords}` : ""}`,
    },
  ];
}

/* ------------------------------------------------------- the switch ------------------------------------------------------- */

/**
 * 11.5: the owner — and only the owner, from his own login (never viewing or acting as someone) — chooses manual or
 * automatic. Saved with its label (works before the migration seeds the row), written to the change log with who and
 * when, and accounts and the owner are told.
 */
export async function setSyncMode(staff: Pick<CurrentStaff, "id" | "role_id" | "display_name" | "viewingAs" | "actingAs">, modeIn: string): Promise<{ words: string | null; error: string | null }> {
  if (staff.role_id !== "owner" || staff.viewingAs || staff.actingAs) return { words: null, error: "Only the owner switches how Zoho Books is sent, from his own login." };
  if (modeIn !== "manual" && modeIn !== "automatic") return { words: null, error: "Pick manual or automatic." };
  const mode = modeIn as ZohoSyncMode;
  const before: ZohoSyncMode = (await zohoBooksNow()).auto ? "automatic" : "manual";
  if (before === mode) return { words: mode === "manual" ? "Already on manual." : "Already automatic.", error: null };
  const admin = createAdminClient();
  const { error } = await admin
    .from("settings")
    .upsert({ key: "zoho_sync_mode", label: "Zoho Books: how documents are sent (manual or automatic)", value: mode, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { words: null, error: `Not saved: ${error.message}` };
  await admin.from("audit_log").insert({ table_name: "settings", record_id: "zoho_sync_mode", action: "update", old_data: { mode: before }, new_data: { mode, by: staff.display_name }, changed_by: staff.id }).then(() => null, () => null);
  const w = await waitingCounts();
  const title = mode === "automatic" ? "Zoho Books now sends automatically every five minutes" : "Zoho Books is on manual: press Sync to Zoho to send";
  const body =
    mode === "automatic"
      ? `Switched by ${staff.display_name}. ${w.total ? `${itemsWord(w.total)} waiting start going within five minutes (25 at a time).` : "Nothing is waiting now."}`
      : `Switched by ${staff.display_name}. Nothing goes to Zoho until the owner or accounts press Sync to Zoho on the Zoho Books page.`;
  await notifyRoles(["owner", "accounts"], { type: "zoho_sync_mode", title, body, href: "/zoho" }).catch(() => null);
  return {
    words: mode === "automatic" ? `Automatic from now: every five minutes the system sends what is waiting by itself (25 at a time). ${w.total ? `${itemsWord(w.total)} waiting start going within five minutes.` : ""}`.trim() : "Manual from now: nothing goes to Zoho until someone presses Sync to Zoho.",
    error: null,
  };
}
