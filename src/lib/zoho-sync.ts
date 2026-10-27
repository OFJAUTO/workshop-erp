import "server-only";
import { logAppError } from "@/lib/app-errors";
import { INVOICE_LINE_SELECT, INVOICE_SELECT, PAYMENT_SELECT, toInvoice, toInvoiceLine, toPayment, type InvoiceLineRow, type InvoiceRow, type PaymentRow } from "@/lib/invoice-data";
import { round2 } from "@/lib/money";
import { getSettings, type Settings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZOHO_REAL_ORG_ID, ZohoError, listAccounts, listTaxes, zohoConfigured, zohoFetch, zohoLiveNow, zohoTestOrgId } from "@/lib/zoho";

/**
 * Zoho Books, phase 1 (26 October 2026, docs/zoho-plan.md): customers, tax invoices, payments and deposits post to
 * Zoho through the zoho_outbox table. The screens only ENQUEUE (a plain database insert that works everywhere);
 * the WORKER (drainZohoOutbox) talks to Zoho and runs only where the Zoho secret lives: the five-minute cron on
 * the live site and the Sync now button. One-way: the only things ever read back are Zoho ids and the figures
 * stored on the outbox row to prove the match.
 *
 * The hard rules, in order:
 *  - Writes go only to the organization zohoWriteOrg() names: OFJ TEST until the owner turns the go-live switch
 *    on (zohoFetch itself refuses a write to REAL while the switch is off - the guard lives there).
 *  - Nothing posts twice: the Zoho id is stored on the ERP record, and before creating, the worker looks the
 *    document up in Zoho (invoice number, receipt number, customer phone) and ADOPTS what it finds.
 *  - Totals must match to the fils: after posting an invoice the worker compares Zoho's total and VAT with the
 *    ERP's; one corrective pass is allowed (the Round-off line), then the row goes FAILED with both figures.
 *  - A missing account mapping fails the row in plain words ("Mapping missing: ..."), never half-posts.
 */

/* ------------------------------------------------------- the mapping ------------------------------------------------------- */

export const INCOME_TYPES = [
  { key: "labour", label: "Mechanical labour" },
  { key: "parts", label: "Spare parts" },
  { key: "bodyshop", label: "Bodyshop & PPF (incl. packages)" },
  { key: "recovery", label: "Recovery" },
  { key: "inspection_fee", label: "Inspection fee" },
  { key: "other", label: "Other work" },
] as const;
export type IncomeKey = (typeof INCOME_TYPES)[number]["key"];

export const DEPOSIT_METHODS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card machine" },
  { key: "link", label: "Payment link" },
  { key: "transfer", label: "Bank transfer" },
  { key: "cheque", label: "Cheque" },
] as const;
export type MethodKey = (typeof DEPOSIT_METHODS)[number]["key"];

/** Phase 2: what supplier bills post to (the parts themselves, and courier/freight charged on the invoice). */
export const PURCHASE_TYPES = [
  { key: "parts", label: "Parts purchases" },
  { key: "courier", label: "Courier & freight" },
] as const;
export type PurchaseKey = (typeof PURCHASE_TYPES)[number]["key"];

/** Phase 2: the owner's expense buckets (commissions when the voucher is paid; recovery when the month is paid). */
export const EXPENSE_TYPES = [
  { key: "commission", label: "Sales commissions" },
  { key: "recovery", label: "Recovery & transport" },
] as const;
export type ExpenseKey = (typeof EXPENSE_TYPES)[number]["key"];

/** Zoho account NAMES (not ids): the same mapping reads in OFJ TEST today and in the REAL book at go-live. */
export type ZohoAccountMap = {
  income: Partial<Record<IncomeKey, string>>;
  depositTo: Partial<Record<MethodKey, string>>;
  purchases: Partial<Record<PurchaseKey, string>>;
  expense: Partial<Record<ExpenseKey, string>>;
  /** The cash/bank account supplier payments and expenses are PAID FROM. */
  paidFrom?: string;
  bankCharges?: string;
  advances?: string;
  /** Reference only (no ERP refund records yet): where a credit-note refund would be paid from. */
  advancesRefund?: string;
};

/** The pre-fill when the live chart has no better match; also what "Create the suggested accounts" makes in OFJ TEST. */
export const SUGGESTED_MAP: { income: Record<IncomeKey, string>; depositTo: Record<MethodKey, string>; purchases: Record<PurchaseKey, string>; expense: Record<ExpenseKey, string>; paidFrom: string; bankCharges: string; advances: string; advancesRefund: string } = {
  income: {
    labour: "Mechanical labour income",
    parts: "Spare parts income",
    bodyshop: "Bodyshop and PPF income",
    recovery: "Recovery income",
    inspection_fee: "Inspection fee income",
    other: "Other workshop income",
  },
  depositTo: {
    cash: "Petty Cash",
    card: "Card machine clearing",
    link: "Payment link clearing",
    transfer: "Bank - AED",
    cheque: "Bank - AED",
  },
  purchases: {
    parts: "Parts purchases",
    courier: "Courier and freight",
  },
  expense: {
    commission: "Sales commissions",
    recovery: "Recovery and transport",
  },
  paidFrom: "Bank - AED",
  bankCharges: "Bank Fees and Charges",
  advances: "Customer advances",
  advancesRefund: "Bank - AED",
};

export function readZohoMap(settings: Settings): ZohoAccountMap {
  const raw = (settings.zoho_account_map ?? {}) as ZohoAccountMap;
  return { income: raw.income ?? {}, depositTo: raw.depositTo ?? {}, purchases: raw.purchases ?? {}, expense: raw.expense ?? {}, paidFrom: raw.paidFrom, bankCharges: raw.bankCharges, advances: raw.advances, advancesRefund: raw.advancesRefund };
}

/** Where writes go: OFJ TEST until the owner declares go-live (zohoFetch refuses REAL anyway while the switch is off). */
export async function zohoWriteOrg(): Promise<string | null> {
  const settings = await getSettings();
  if (settings.zoho_live_enabled === true) return ZOHO_REAL_ORG_ID;
  return zohoTestOrgId();
}

/** PURE: is this document dated before the go-live start date? (yyyy-mm-dd compare; no gate until live). */
export function beforeGoLiveStart(docDate: string, live: boolean, startDate: string): boolean {
  if (!live) return false;
  const start = (startDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
  return docDate < start;
}

/** The cutover as the handlers see it: whether the books are live, and the first day the REAL book owns. */
async function cutover(): Promise<{ live: boolean; start: string }> {
  const settings = await getSettings();
  return { live: settings.zoho_live_enabled === true, start: String(settings.zoho_golive_start_date ?? "").trim() };
}

/** Once live: the start date when this parent document predates it (so it is not, and never will be, in REAL). */
async function parentBeforeStart(docDate: string | null | undefined): Promise<string | null> {
  if (!docDate) return null;
  const { live, start } = await cutover();
  return beforeGoLiveStart(docDate.slice(0, 10), live, start) ? start : null;
}

const DONE_BY_HAND = 'The accountant enters it by hand in the REAL book (with the opening balances), then presses "Done by hand" here.';

/**
 * Once live, a document dated before the start date never posts to REAL. When OFJ TEST's archived queue holds it
 * as posted, that is simply its home. When it never reached OFJ TEST (it arrived, or was dated back, after the
 * flip) it sits in NO Zoho book — so it fails in plain words instead of turning green, and the accountant closes
 * it with "Done by hand".
 */
async function startDateSkip(docDate: string, kinds: ZohoKind | ZohoKind[], recordId: string): Promise<HandlerOut | null> {
  const { live, start } = await cutover();
  if (!beforeGoLiveStart(docDate, live, start)) return null;
  const testOrg = await zohoTestOrgId();
  const { data } = testOrg
    ? await createAdminClient().from("zoho_outbox_archive").select("status").eq("org", testOrg).in("kind", Array.isArray(kinds) ? kinds : [kinds]).eq("record_id", recordId).eq("status", "synced").limit(1)
    : { data: [] };
  if ((data ?? []).length) return { result: { skipped: `Dated ${docDate}, before the go-live start date ${start}: it stays in OFJ TEST's history and never posts to the REAL book.` } };
  throw new ZohoError(`Dated ${docDate}, before the go-live start date ${start}, and it never reached OFJ TEST: it is in no Zoho book. ${DONE_BY_HAND}`);
}

type Resolved = {
  income: Record<IncomeKey, string>;
  depositTo: Record<MethodKey, string>;
  taxId: string;
  /** Phase 2 groups resolve softly: a missing bills/expenses mapping fails ONLY the rows that need it, never the phase 1 money. */
  purchases?: Record<PurchaseKey, string>;
  purchasesError?: string;
  expense?: Record<ExpenseKey, string>;
  expenseError?: string;
  paidFrom?: string;
  paidFromError?: string;
  /** Where credit-note refunds are paid from (functional since phase 3). */
  advancesRefund?: string;
  advancesRefundError?: string;
};

/** The account a handler needs, or its group's plain-words reason. */
function needAccounts<T>(group: T | undefined, error: string | undefined): T {
  if (!group) throw new ZohoError(error ?? "The account mapping could not be read.");
  return group;
}

/**
 * Names become account ids in the organization being written to. A name missing from the mapping fails in plain
 * words; a mapped name missing from the chart is CREATED in OFJ TEST (never in REAL - there the accountant makes
 * it first and the row fails with the account's name).
 */
async function resolveZohoAccounts(org: string, map: ZohoAccountMap): Promise<Resolved> {
  const [taxes, chart] = await Promise.all([listTaxes(org), listAccounts(org)]);
  const tax = taxes.find((t) => Number(t.tax_percentage) === 5);
  if (!tax) throw new ZohoError("No 5% tax exists in this Zoho organization. Run the mirror on Settings > Zoho Books.");
  const byName = new Map(chart.filter((a) => a.is_active !== false).map((a) => [a.account_name.trim().toLowerCase(), a]));
  const mayCreate = org !== ZOHO_REAL_ORG_ID;
  const resolve = async (name: string | undefined, label: string, kind: "income" | "cash" | "bank" | "expense"): Promise<string> => {
    const clean = (name ?? "").trim();
    if (!clean) throw new ZohoError(`Mapping missing: ${label}. Pick the account on Settings > Zoho Books > Mapping.`);
    const found = byName.get(clean.toLowerCase());
    if (found) return found.account_id;
    if (!mayCreate) throw new ZohoError(`Account not found in this organization: ${clean}. The accountant creates it in Zoho first.`);
    // OFJ TEST only: make the mapped account so testing never waits on the accountant.
    const made =
      kind === "bank"
        ? await zohoFetch<{ bankaccount?: { account_id: string } }>("/bankaccounts", { org, method: "POST", body: { account_name: clean, account_type: "bank" } }).then((j) => j.bankaccount?.account_id)
        : await zohoFetch<{ chart_of_account?: { account_id: string } }>("/chartofaccounts", { org, method: "POST", body: { account_name: clean, account_type: kind } }).then((j) => j.chart_of_account?.account_id);
    if (!made) throw new ZohoError(`Zoho did not return the new account ${clean}.`);
    byName.set(clean.toLowerCase(), { account_id: made, account_name: clean, account_type: kind });
    return made;
  };
  const income = {} as Record<IncomeKey, string>;
  for (const t of INCOME_TYPES) income[t.key] = await resolve(map.income[t.key], t.label, "income");
  const depositTo = {} as Record<MethodKey, string>;
  for (const m of DEPOSIT_METHODS) depositTo[m.key] = await resolve(map.depositTo[m.key], `Deposit-to account for ${m.label}`, m.key === "cash" ? "cash" : "bank");
  const out: Resolved = { income, depositTo, taxId: tax.tax_id };
  // The phase 2 groups fail softly: only the rows needing them carry the reason.
  try {
    const purchases = {} as Record<PurchaseKey, string>;
    for (const p of PURCHASE_TYPES) purchases[p.key] = await resolve(map.purchases[p.key], p.label, "expense");
    out.purchases = purchases;
  } catch (e) {
    out.purchasesError = e instanceof Error ? e.message : String(e);
  }
  try {
    const expense = {} as Record<ExpenseKey, string>;
    for (const x of EXPENSE_TYPES) expense[x.key] = await resolve(map.expense[x.key], x.label, "expense");
    out.expense = expense;
  } catch (e) {
    out.expenseError = e instanceof Error ? e.message : String(e);
  }
  try {
    out.paidFrom = await resolve(map.paidFrom, "Paid-from account (supplier payments and expenses)", "bank");
  } catch (e) {
    out.paidFromError = e instanceof Error ? e.message : String(e);
  }
  try {
    out.advancesRefund = await resolve(map.advancesRefund, "Advance refunds paid from", "bank");
  } catch (e) {
    out.advancesRefundError = e instanceof Error ? e.message : String(e);
  }
  return out;
}

/* ------------------------------------------------------- the outbox ------------------------------------------------------- */

export type ZohoKind = "contact" | "deposit" | "invoice" | "payment" | "creditnote" | "vendor" | "bill" | "billpayment" | "commission" | "recovery" | "vendorcredit" | "cnrefund";
export type OutboxRow = {
  id: string;
  kind: ZohoKind;
  record_id: string;
  job_id: string | null;
  status: "pending" | "synced" | "failed";
  attempts: number;
  last_error: string | null;
  zoho_id: string | null;
  zoho_result: Record<string, unknown> | null;
  enqueued_at: string;
  synced_at: string | null;
};

/** One row per document. A failed row goes back to pending; a synced row is left alone (nothing posts twice). */
export async function enqueueZoho(kind: ZohoKind, recordId: string, jobId: string | null = null, by: string | null = null): Promise<void> {
  // Supabase returns errors instead of throwing: each is checked, or a lost enqueue would be silent.
  const admin = createAdminClient();
  const { data: ex, error: readError } = await admin.from("zoho_outbox").select("id, status").eq("kind", kind).eq("record_id", recordId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!ex) {
    const { error } = await admin.from("zoho_outbox").insert({ kind, record_id: recordId, job_id: jobId, created_by: by });
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    return;
  }
  if (ex.status === "failed") {
    const { error } = await admin.from("zoho_outbox").update({ status: "pending", last_error: null, updated_at: new Date().toISOString() }).eq("id", ex.id);
    if (error) throw new Error(error.message);
  }
}

/** The hooks call this: a Zoho hiccup must never break a receipt or an invoice. */
export async function tryEnqueueZoho(kind: ZohoKind, recordId: string, jobId: string | null = null, by: string | null = null): Promise<void> {
  try {
    await enqueueZoho(kind, recordId, jobId, by);
  } catch (e) {
    await logAppError("zoho_enqueue", e, { jobId, detail: { kind, recordId } });
  }
}

/** Something changed in the ERP AFTER the document reached Zoho (a void, a bounce, a credit note): the row turns red for accounts. */
export async function flagZohoAttention(kind: ZohoKind, recordId: string, reason: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: ex, error: readError } = await admin.from("zoho_outbox").select("id").eq("kind", kind).eq("record_id", recordId).maybeSingle();
    if (readError) throw new Error(readError.message);
    const { error } = ex
      ? await admin.from("zoho_outbox").update({ status: "failed", last_error: reason, updated_at: new Date().toISOString() }).eq("id", ex.id)
      : await admin.from("zoho_outbox").insert({ kind, record_id: recordId, status: "failed", last_error: reason });
    if (error) throw new Error(error.message);
  } catch (e) {
    await logAppError("zoho_flag", e, { detail: { kind, recordId } });
  }
}

/** Something was ADDED to an already-synced document (a voucher proof uploaded late): the row runs once more.
 * Clearing claimed_at also releases a row that is mid-flight, so the worker's final write misses and the next
 * run picks the addition up instead of losing it. */
export async function reopenZoho(kind: ZohoKind, recordId: string): Promise<void> {
  try {
    const { error } = await createAdminClient().from("zoho_outbox").update({ status: "pending", last_error: null, claimed_at: null, updated_at: new Date().toISOString() }).eq("kind", kind).eq("record_id", recordId);
    if (error) throw new Error(error.message);
  } catch (e) {
    await logAppError("zoho_reopen", e, { detail: { kind, recordId } });
  }
}

/** A dependency joins the queue only when it has NO row at all — a FAILED parent keeps its reason and its red row
 * (enqueueZoho would flip it back to a reasonless "Waiting" on every drain). */
async function ensureQueued(kind: ZohoKind, recordId: string, jobId: string | null): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("zoho_outbox").upsert({ kind, record_id: recordId, job_id: jobId }, { onConflict: "kind,record_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } catch (e) {
    await logAppError("zoho_ensure_queued", e, { detail: { kind, recordId } });
  }
}

/* ------------------------------------------------------- helpers ------------------------------------------------------- */

const MODE: Record<MethodKey, string> = { cash: "cash", card: "creditcard", link: "others", transfer: "banktransfer", cheque: "check" };
const near = (a: number, b: number) => Math.abs(a - b) < 0.009;
/** Zoho takes plain dates: the Dubai day of the stamp. */
const dubaiDate = (iso: string) => new Date(Date.parse(iso) + 4 * 3600 * 1000).toISOString().slice(0, 10);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Open-in-Zoho addresses for the sync page. */
export function zohoOpenUrl(org: string, kind: ZohoKind, zohoId: string): string {
  const section =
    kind === "invoice" ? "invoices"
    : kind === "contact" || kind === "vendor" ? "contacts"
    : kind === "creditnote" ? "creditnotes"
    : kind === "bill" ? "bills"
    : kind === "vendorcredit" ? "vendorcredits"
    : kind === "cnrefund" ? "creditnotes"
    : kind === "billpayment" ? "paymentsmade"
    : kind === "commission" || kind === "recovery" ? "expenses"
    : "paymentsreceived";
  return `https://books.zoho.com/app/${org}#/${section}/${zohoId}`;
}

type HandlerOut = { zohoId?: string | null; result?: Record<string, unknown>; wait?: string };

/* ------------------------------------------------------- contacts ------------------------------------------------------- */

type CustomerRow = {
  id: string;
  customer_number: string;
  full_name: string;
  company_name: string | null;
  phone: string;
  email: string | null;
  trn: string | null;
  zoho_contact_id: string | null;
};

type ZohoContact = { contact_id: string; contact_name: string };

/**
 * The customer's Zoho contact: stored id first, then a search by mobile (last nine digits), then by name, then
 * create. The id lands on customers.zoho_contact_id, and any waiting contact row in the outbox is closed too.
 */
export async function ensureContact(org: string, customerId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("customers").select("id, customer_number, full_name, company_name, phone, email, trn, zoho_contact_id").eq("id", customerId).maybeSingle();
  const c = data as CustomerRow | null;
  if (!c) throw new ZohoError("The customer no longer exists in the ERP.");
  let zid = c.zoho_contact_id;
  const name = (c.company_name?.trim() || c.full_name).trim();
  const sameName = (x: ZohoContact) => x.contact_name.trim().toLowerCase() === name.toLowerCase() || x.contact_name.trim().toLowerCase() === `${name} · ${c.customer_number}`.toLowerCase();
  // The two searches: by mobile AND the same name (two people may share a number - gate-in allows it), then by
  // the exact name. Adopting the first phone hit blind would post one customer's money on another's ledger.
  const lookFor = async (): Promise<string | null> => {
    const digits = (c.phone ?? "").replace(/\D/g, "").slice(-9);
    if (digits.length >= 7) {
      const j = await zohoFetch<{ contacts?: ZohoContact[] }>(`/contacts?phone_contains=${encodeURIComponent(digits)}`, { org });
      const hit = j.contacts?.find(sameName);
      if (hit) return hit.contact_id;
    }
    // contains, not exact: a contact created under the clash suffix must still be found on a retry.
    const j = await zohoFetch<{ contacts?: ZohoContact[] }>(`/contacts?contact_name_contains=${encodeURIComponent(name)}`, { org });
    return j.contacts?.find(sameName)?.contact_id ?? null;
  };
  if (!zid) {
    zid = await lookFor();
    if (!zid) {
      const words = c.full_name.trim().split(/\s+/);
      const body = (contactName: string) => ({
        contact_name: cut(contactName, 200),
        ...(c.company_name ? { company_name: cut(c.company_name, 200) } : {}),
        contact_type: "customer",
        contact_persons: [{ first_name: words[0] ?? c.full_name, last_name: words.slice(1).join(" "), mobile: c.phone, phone: c.phone, ...(c.email ? { email: c.email } : {}), is_primary_contact: true }],
        ...(c.trn ? { tax_treatment: "vat_registered", tax_reg_no: c.trn } : { tax_treatment: "vat_not_registered" }),
        place_of_supply: "AE",
        notes: `ERP ${c.customer_number}`,
      });
      try {
        const j = await zohoFetch<{ contact?: ZohoContact }>("/contacts", { org, method: "POST", body: body(name) });
        zid = j.contact?.contact_id ?? null;
      } catch (e) {
        if (e instanceof ZohoError && /exist/i.test(e.message)) {
          // "Exists" can mean our own just-created contact (a half-finished run): search again before anything new.
          zid = await lookFor();
          if (!zid) {
            // A different person really holds this display name: the customer number makes ours unmistakable.
            const j = await zohoFetch<{ contact?: ZohoContact }>("/contacts", { org, method: "POST", body: body(`${name} · ${c.customer_number}`) });
            zid = j.contact?.contact_id ?? null;
          }
        } else throw e;
      }
      if (!zid) throw new ZohoError("Zoho did not return the new contact.");
    }
    await admin.from("customers").update({ zoho_contact_id: zid }).eq("id", c.id);
  }
  await admin.from("zoho_outbox").update({ status: "synced", zoho_id: zid, synced_at: new Date().toISOString(), last_error: null }).eq("kind", "contact").eq("record_id", c.id).neq("status", "synced");
  return zid;
}

/* ------------------------------------------------------- invoices ------------------------------------------------------- */

type QLineLite = { id: string; line_type: string | null; side: string | null; film_colour: string | null; tint_percent: number | null };

function incomeKeyOf(line: InvoiceLineRow, q: QLineLite | undefined, jobDept: string | null): IncomeKey {
  if (line.section === "fees") return "inspection_fee";
  if (line.section === "parts" || q?.line_type === "part") return "parts";
  if (q?.line_type === "recovery") return "recovery";
  if (q?.line_type === "package" || line.package_items) return "bodyshop";
  if (q?.side === "bodyshop" || q?.film_colour || q?.tint_percent != null || jobDept === "bodyshop") return "bodyshop";
  if (q?.line_type === "labour" || /^\d+(\.\d)? h$/.test(line.details ?? "")) return "labour";
  return "other";
}

type ZohoInvoice = { invoice_id: string; invoice_number: string; status: string; sub_total: number; tax_total: number; total: number; balance: number; reference_number?: string; customer_id?: string };

async function zohoInvoiceById(org: string, id: string): Promise<ZohoInvoice | null> {
  try {
    const j = await zohoFetch<{ invoice?: ZohoInvoice }>(`/invoices/${id}`, { org });
    return j.invoice ?? null;
  } catch (e) {
    if (e instanceof ZohoError && e.code === 1002) return null;
    throw e;
  }
}

async function zohoInvoiceByNumber(org: string, number: string): Promise<ZohoInvoice | null> {
  const j = await zohoFetch<{ invoices?: ZohoInvoice[] }>(`/invoices?invoice_number=${encodeURIComponent(number)}`, { org });
  return j.invoices?.find((x) => x.invoice_number === number) ?? null;
}

/** Payments already sitting on the Zoho invoice (directly or as applied credits), so a retry never applies twice. */
async function zohoAppliedPayments(org: string, zohoInvoiceId: string): Promise<Set<string>> {
  const applied = new Set<string>();
  const pays = await zohoFetch<{ payments?: { payment_id: string }[] }>(`/invoices/${zohoInvoiceId}/payments`, { org });
  for (const p of pays.payments ?? []) applied.add(String(p.payment_id));
  const credits = await zohoFetch<{ credits?: { payment_id?: string; creditnote_id?: string }[] }>(`/invoices/${zohoInvoiceId}/creditsapplied`, { org });
  for (const cr of credits.credits ?? []) if (cr.payment_id) applied.add(String(cr.payment_id));
  return applied;
}

/** How much CREDIT NOTE money already sits on the Zoho invoice (phase 2): the balance check must count it. */
async function zohoCreditedTotal(org: string, zohoInvoiceId: string): Promise<number> {
  const j = await zohoFetch<{ credits?: { creditnote_id?: string; credited_amount?: number; amount_applied?: number }[] }>(`/invoices/${zohoInvoiceId}/creditsapplied`, { org });
  return round2((j.credits ?? []).filter((c) => c.creditnote_id).reduce((a, c) => a + (Number(c.credited_amount ?? c.amount_applied) || 0), 0));
}

/** The ERP payments that belong on this invoice: its own rows plus the job's deposits; cheques only once cleared. */
function countablePayments(rows: PaymentRow[]): PaymentRow[] {
  return rows.filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared"));
}

/** How much of a Zoho payment is still unapplied (a deposit may already sit on another invoice). */
async function paymentUnused(org: string, zohoPaymentId: string): Promise<number> {
  const j = await zohoFetch<{ payment?: { amount: number; unused_amount?: number; invoices?: { amount_applied: number }[] } }>(`/customerpayments/${zohoPaymentId}`, { org });
  const p = j.payment;
  if (!p) return 0;
  if (typeof p.unused_amount === "number") return round2(p.unused_amount);
  const applied = (p.invoices ?? []).reduce((a, i) => a + (Number(i.amount_applied) || 0), 0);
  return round2(Number(p.amount) - applied);
}

type ApplyOut = { applied: number; available: number; shorts: string[] };

async function applyToZohoInvoice(org: string, zohoInvoiceId: string, pays: { zohoId: string; amount: number; receipt: string }[]): Promise<ApplyOut> {
  if (!pays.length) return { applied: 0, available: 0, shorts: [] };
  const already = await zohoAppliedPayments(org, zohoInvoiceId);
  const inv = await zohoInvoiceById(org, zohoInvoiceId);
  let remaining = inv?.balance ?? 0;
  let available = 0;
  const shorts: string[] = [];
  const invoice_payments: { payment_id: string; amount_applied: number }[] = [];
  for (const p of pays) {
    if (already.has(p.zohoId)) {
      available = round2(available + p.amount);
      continue;
    }
    // Only the payment's UNUSED part can go on: a deposit already applied elsewhere has nothing left to give —
    // and the caller is told, in the receipt's own words, how much ran short.
    const unused = await paymentUnused(org, p.zohoId);
    const usable = round2(Math.min(p.amount, unused));
    available = round2(available + usable);
    if (usable < p.amount - 0.005) shorts.push(`${p.receipt} has only ${usable.toFixed(2)} left in Zoho (${p.amount.toFixed(2)} here) — the rest sits on another document`);
    const take = round2(Math.min(usable, remaining));
    if (take <= 0) continue;
    invoice_payments.push({ payment_id: p.zohoId, amount_applied: take });
    remaining = round2(remaining - take);
  }
  if (invoice_payments.length) await zohoFetch(`/invoices/${zohoInvoiceId}/credits`, { org, method: "POST", body: { invoice_payments } });
  return { applied: invoice_payments.length, available, shorts };
}

async function syncInvoiceRow(org: string, accounts: Resolved, invoiceId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const { data: invRaw } = await admin.from("invoices").select(`${INVOICE_SELECT}, zoho_invoice_id`).eq("id", invoiceId).maybeSingle();
  if (!invRaw) throw new ZohoError("The invoice no longer exists in the ERP.");
  const inv = toInvoice(invRaw as Record<string, unknown>) as InvoiceRow & { zoho_invoice_id: string | null };
  if (inv.kind !== "tax_invoice") return { result: { skipped: "Only tax invoices go to Zoho." } };
  if (inv.deposit_for_quotation_id) return { result: { skipped: "A deposit document: the advance itself goes to Zoho as a payment." } };
  if (inv.status === "cancelled" && !inv.zoho_invoice_id) return { result: { skipped: "Cancelled in the ERP before it was posted. Nothing went to Zoho." } };
  if (inv.status === "cancelled") throw new ZohoError(`${inv.number} was cancelled in the ERP after it reached Zoho: the accountant voids it in Zoho by hand.`);
  const invGate = await startDateSkip(dubaiDate(inv.issued_at), "invoice", inv.id);
  if (invGate) return invGate;

  const [{ data: lineRows }, { data: payRows }, job] = await Promise.all([
    admin.from("invoice_lines").select(INVOICE_LINE_SELECT).eq("invoice_id", inv.id).eq("is_active", true).order("position"),
    admin.from("payments").select(`${PAYMENT_SELECT}, zoho_payment_id`).or(`invoice_id.eq.${inv.id}${inv.job_id ? `,and(job_id.eq.${inv.job_id},is_deposit.eq.true)` : ""}`),
    inv.job_id ? admin.from("jobs").select("job_number, department").eq("id", inv.job_id).maybeSingle().then((r) => r.data as { job_number: string; department: string | null } | null) : Promise.resolve(null),
  ]);
  const lines = (lineRows ?? []).map((r) => toInvoiceLine(r as Record<string, unknown>));
  const erpPays = countablePayments((payRows ?? []).map((r) => toPayment(r as Record<string, unknown>)));

  // Line provenance for the income account: the quotation line says what kind of work it was.
  const qIds = lines.map((l) => l.quotation_line_id).filter(Boolean) as string[];
  const qMap = new Map<string, QLineLite>();
  if (qIds.length) {
    const { data: qRows } = await admin.from("quotation_lines").select("id, line_type, side, film_colour, tint_percent").in("id", qIds);
    for (const q of (qRows ?? []) as QLineLite[]) qMap.set(q.id, q);
  }

  const snap = (inv.customer_snapshot ?? {}) as { trn?: string | null };
  const roundoff = round2(inv.taxable_aed - (inv.subtotal_aed - inv.discount_aed - inv.warranty_credit_aed));
  // Which income account each line went to (by type), stored on the row as proof for the sync page and the tests.
  const incomeCounts: Partial<Record<IncomeKey, number>> = {};
  for (const l of lines) {
    const k = incomeKeyOf(l, l.quotation_line_id ? qMap.get(l.quotation_line_id) : undefined, job?.department ?? null);
    incomeCounts[k] = (incomeCounts[k] ?? 0) + 1;
  }
  // Zoho honours ONE discount level: with discount_type entity_level the per-line discount field is IGNORED
  // (found live, 26 October 2026 — the uncapped corrective pass had been hiding it in Round-off). So the lines
  // go at their pre-discount figures and every discount — per line, quotation-wide, warranty — folds into the
  // one entity discount, exactly how the ERP's own documents show them (one summed green Discount row).
  const buildItems = (roundoffAed: number) => {
    let lineDiscounts = 0;
    const items: Record<string, unknown>[] = lines.map((l, i) => {
      const q = l.quotation_line_id ? qMap.get(l.quotation_line_id) : undefined;
      const comp = l.price_display === "complimentary" || l.price_display === "included" || l.amount_aed === 0;
      const realDiscount = (Number(l.discount_percent) || 0) > 0;
      let qty = l.quantity > 0 ? l.quantity : 1;
      let rate = comp ? 0 : l.quantity > 0 ? l.unit_price : l.amount_aed;
      let discount = comp ? 0 : round2(rate * qty - l.amount_aed);
      // qty × rate must land the line's exact amount. When it cannot (a labour line stores its hours to one
      // decimal: 0.33 h × 350 = 115.50 but quantity 0.3), the line posts as one unit at the exact amount — the
      // hours already sit in the description — rather than leaking the difference into the Round-off account or
      // claiming a discount the ERP document does not have.
      if (!comp && (discount < -0.009 || (!realDiscount && discount > 0.009))) {
        qty = 1;
        rate = l.amount_aed;
        discount = 0;
      }
      lineDiscounts = round2(lineDiscounts + Math.max(0, discount));
      const word = l.price_display === "included" ? "Included" : "Complimentary";
      return {
        name: cut(l.description, 100),
        description: cut([comp ? word : null, l.details].filter(Boolean).join(" · "), 2000),
        quantity: qty,
        rate,
        tax_id: accounts.taxId,
        account_id: accounts.income[incomeKeyOf(l, q, job?.department ?? null)],
        item_order: i + 1,
      };
    });
    if (roundoffAed !== 0) items.push({ name: "Round-off", quantity: 1, rate: roundoffAed, tax_id: accounts.taxId, account_id: accounts.income.other, item_order: items.length + 1 });
    return { items, lineDiscounts };
  };
  const body = (roundoffAed: number) => {
    const built = buildItems(roundoffAed);
    const discountTotal = round2(inv.discount_aed + inv.warranty_credit_aed + built.lineDiscounts);
    return {
      customer_id: "", // filled below
      invoice_number: inv.number,
      date: dubaiDate(inv.issued_at),
      reference_number: job?.job_number ?? inv.number,
      place_of_supply: "DU",
      ...(snap.trn ? { is_reverse_charge_applied: false } : {}),
      line_items: built.items,
      ...(discountTotal > 0 ? { discount: discountTotal, discount_type: "entity_level", is_discount_before_tax: true } : {}),
      ...(inv.discount_note || inv.notes ? { notes: cut([inv.discount_note, inv.notes].filter(Boolean).join("\n"), 2000) } : {}),
    };
  };

  const contactId = await ensureContact(org, inv.customer_id);
  const matches = (z: ZohoInvoice) => near(z.total, inv.total_aed) && near(z.tax_total, inv.vat_aed);

  // Never twice: stored id, else the same number already in Zoho (adopted only when it is OURS), else create.
  let z: ZohoInvoice | null = inv.zoho_invoice_id ? await zohoInvoiceById(org, inv.zoho_invoice_id) : null;
  if (!z) {
    const byNumber = await zohoInvoiceByNumber(org, inv.number);
    // The list row misses tax_total, so the found invoice is read in full before any judgement on its figures.
    const full = byNumber ? await zohoInvoiceById(org, byNumber.invoice_id) : null;
    // Only OUR OWN earlier post is adopted: it must sit on the same customer, and either the figures match or it
    // is a half-finished run on the same job (corrected below). Anything else holding our number — another
    // customer's document, or a leftover with different figures — is NEVER overwritten: FAILED in plain words.
    if (full && String(full.customer_id ?? "") !== contactId) {
      throw new ZohoError(`An invoice numbered ${inv.number} already exists in Zoho on a different customer: the accountant checks it in Zoho.`);
    }
    if (full && !matches(full) && (byNumber?.reference_number ?? full.reference_number) !== (job?.job_number ?? inv.number)) {
      throw new ZohoError(`An invoice numbered ${inv.number} already exists in Zoho with different figures (${full.total.toFixed(2)} there, ${inv.total_aed.toFixed(2)} here) and belongs to another job: the accountant checks it in Zoho.`);
    }
    z = full;
  }
  if (!z) {
    try {
      const j = await zohoFetch<{ invoice?: ZohoInvoice }>("/invoices?ignore_auto_number_generation=true", { org, method: "POST", body: { ...body(roundoff), customer_id: contactId } });
      z = j.invoice ?? null;
    } catch (e) {
      // A race or an earlier run that died after creating: adopt what exists instead of failing.
      const again = await zohoInvoiceByNumber(org, inv.number);
      if (!again) throw e;
      z = again;
    }
    if (!z) throw new ZohoError("Zoho did not return the new invoice.");
  }

  // Totals to the fils: one corrective pass on the Round-off line, for ROUNDING only (a shift past 1 AED is a
  // real difference and fails with both figures — Round-off must stay what it claims to be), then FAILED.
  if (!matches(z)) {
    const fix = round2(roundoff + (inv.taxable_aed - round2(z.total - z.tax_total)));
    if (Math.abs(fix - roundoff) > 1) {
      throw new ZohoError(`Totals differ for ${inv.number} beyond rounding: Zoho has ${z.total.toFixed(2)} (VAT ${z.tax_total.toFixed(2)}), the ERP has ${inv.total_aed.toFixed(2)} (VAT ${inv.vat_aed.toFixed(2)}).`);
    }
    await zohoFetch(`/invoices/${z.invoice_id}?ignore_auto_number_generation=true`, { org, method: "PUT", body: { ...body(fix), customer_id: contactId } });
    z = await zohoInvoiceById(org, z.invoice_id);
    if (!z || !matches(z)) {
      throw new ZohoError(`Totals differ for ${inv.number}: Zoho has ${z?.total.toFixed(2)} (VAT ${z?.tax_total.toFixed(2)}), the ERP has ${inv.total_aed.toFixed(2)} (VAT ${inv.vat_aed.toFixed(2)}).`);
    }
  }
  await admin.from("invoices").update({ zoho_invoice_id: z.invoice_id }).eq("id", inv.id);
  if (z.status === "draft") await zohoFetch(`/invoices/${z.invoice_id}/status/sent`, { org, method: "POST" });

  // Advances and payments already in Zoho land on the invoice now; the rest follow from their own rows.
  const synced = erpPays.filter((p) => (p as PaymentRow & { zoho_payment_id?: string | null }).zoho_payment_id);
  const applyOut = await applyToZohoInvoice(
    org,
    z.invoice_id,
    synced.map((p) => ({ zohoId: String((p as PaymentRow & { zoho_payment_id?: string | null }).zoho_payment_id), amount: p.amount_aed, receipt: p.number })),
  );
  // A payment whose credit was consumed by another document cannot cover this invoice: FAILED in the receipt's own
  // words, so the accountant knows exactly what to look at (the retry recomputes from Zoho's live state).
  if (applyOut.shorts.length) throw new ZohoError(`${inv.number} cannot be covered as the ERP expects: ${applyOut.shorts.join("; ")}.`);
  const after = (await zohoInvoiceById(org, z.invoice_id)) ?? z;
  // Credit notes applied in Zoho (phase 2) reduce the balance there while the ERP's own balance ignores them.
  const credited = await zohoCreditedTotal(org, z.invoice_id);
  const expectedBalance = Math.max(0, round2(inv.total_aed - applyOut.available - credited));
  if (!near(after.balance, expectedBalance)) {
    throw new ZohoError(`The balance differs for ${inv.number}: Zoho says ${after.balance.toFixed(2)}, the ERP expects ${expectedBalance.toFixed(2)} after the payments posted so far.`);
  }
  const appliedNow = applyOut.applied;
  return {
    zohoId: z.invoice_id,
    result: {
      number: inv.number,
      zoho: { total: after.total, vat: after.tax_total, balance: after.balance },
      erp: { total: inv.total_aed, vat: inv.vat_aed, taxable: inv.taxable_aed },
      applied_payments: appliedNow,
      line_accounts: incomeCounts,
    },
  };
}

/* ------------------------------------------------------- payments and deposits ------------------------------------------------------- */

type ZohoPayment = { payment_id: string; reference_number?: string; amount: number; bank_charges?: number };

async function syncPaymentRow(org: string, accounts: Resolved, paymentId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("payments").select(`${PAYMENT_SELECT}, zoho_payment_id`).eq("id", paymentId).maybeSingle();
  if (!raw) throw new ZohoError("The payment no longer exists in the ERP.");
  const p = toPayment(raw as Record<string, unknown>) as PaymentRow & { zoho_payment_id: string | null };
  if (p.status === "pending_owner") return { wait: "Waiting for the owner to approve the over-balance payment." };
  if ((p.status === "voided" || p.status === "reversed") && !p.zoho_payment_id) return { result: { skipped: "Voided in the ERP before it was posted. Nothing went to Zoho." } };
  if (p.status === "voided" || p.status === "reversed") throw new ZohoError(`${p.number} was ${p.status} in the ERP after it reached Zoho: the accountant removes it in Zoho by hand.`);
  if (p.method === "cheque" && p.cheque_status !== "cleared") return { wait: "Waiting for the cheque to clear." };
  const payGate = await startDateSkip(dubaiDate(p.method === "cheque" ? (p.cleared_at ?? p.received_at) : p.received_at), ["deposit", "payment"], p.id);
  if (payGate) return payGate;

  const contactId = await ensureContact(org, p.customer_id);
  let zid = p.zoho_payment_id;
  if (!zid) {
    // Scoped to the customer: a receipt number reused after Clear test data never adopts someone else's payment.
    const j = await zohoFetch<{ customerpayments?: ZohoPayment[] }>(`/customerpayments?reference_number=${encodeURIComponent(p.number)}&customer_id=${encodeURIComponent(contactId)}`, { org });
    const same = j.customerpayments?.find((x) => x.reference_number === p.number) ?? null;
    if (same && !near(Number(same.amount), p.amount_aed)) throw new ZohoError(`A payment with the receipt number ${p.number} already exists in Zoho with a different amount (${Number(same.amount).toFixed(2)} there, ${p.amount_aed.toFixed(2)} here): the accountant checks it in Zoho.`);
    zid = same?.payment_id ?? null;
  }
  // When the tax invoice is already in Zoho, the payment can be applied the moment it is created.
  let zohoInvoiceId: string | null = null;
  let preStartNote: string | null = null;
  if (p.invoice_id) {
    const { data: invRow } = await admin.from("payments").select("invoice:invoices!payments_invoice_id_fkey(zoho_invoice_id, kind, number, issued_at)").eq("id", p.id).maybeSingle();
    const inv = (invRow as unknown as { invoice: { zoho_invoice_id: string | null; kind: string; number: string; issued_at: string } | null } | null)?.invoice;
    if (inv?.kind === "tax_invoice") zohoInvoiceId = inv.zoho_invoice_id;
    // Money received after go-live on an invoice from before it: the payment still posts (it is REAL money), unapplied.
    if (inv?.kind === "tax_invoice" && !inv.zoho_invoice_id && (await parentBeforeStart(dubaiDate(inv.issued_at)))) {
      preStartNote = `Posted unapplied: ${inv.number} is dated before the go-live start date (opening balance), so the accountant applies this payment to it by hand.`;
    }
  } else if (p.is_deposit && p.job_id) {
    const { data: jobInv } = await admin.from("invoices").select("zoho_invoice_id").eq("job_id", p.job_id).eq("kind", "tax_invoice").eq("status", "issued").is("deposit_for_quotation_id", null).not("zoho_invoice_id", "is", null).limit(1).maybeSingle();
    zohoInvoiceId = (jobInv as { zoho_invoice_id: string | null } | null)?.zoho_invoice_id ?? null;
  }
  if (!zid) {
    const base = {
      customer_id: contactId,
      payment_mode: MODE[p.method],
      amount: p.amount_aed,
      date: dubaiDate(p.method === "cheque" ? (p.cleared_at ?? p.received_at) : p.received_at),
      reference_number: p.number,
      description: p.is_deposit ? `Advance payment (deposit)${p.deposit_invoice_number ? ` · ${p.deposit_invoice_number}` : ""}` : `Payment in the ERP (${p.number})`,
      ...(p.bank_charge_aed > 0 ? { bank_charges: p.bank_charge_aed } : {}),
      account_id: accounts.depositTo[p.method],
    };
    try {
      // The plan's model: an advance is an unapplied payment, applied to the tax invoice when that syncs.
      const j = await zohoFetch<{ payment?: ZohoPayment }>("/customerpayments", { org, method: "POST", body: base });
      zid = j.payment?.payment_id ?? null;
    } catch (e) {
      // If this Zoho edition insists on an invoice, apply directly when the tax invoice is already there.
      if (e instanceof ZohoError && /invoice/i.test(e.message) && zohoInvoiceId) {
        const j = await zohoFetch<{ payment?: ZohoPayment }>("/customerpayments", { org, method: "POST", body: { ...base, invoices: [{ invoice_id: zohoInvoiceId, amount_applied: p.amount_aed }] } });
        zid = j.payment?.payment_id ?? null;
        zohoInvoiceId = null; // already applied
      } else if (e instanceof ZohoError && /invoice/i.test(e.message) && !zohoInvoiceId) {
        return { wait: "Waiting for the invoice: Zoho refused an unapplied payment and the tax invoice has not reached Zoho yet." };
      } else throw e;
    }
    if (!zid) throw new ZohoError("Zoho did not return the new payment.");
  }
  await admin.from("payments").update({ zoho_payment_id: zid }).eq("id", p.id);
  // A void that landed while the worker was posting must not end green: the row turns red for the accountant.
  const { data: fresh } = await admin.from("payments").select("status").eq("id", p.id).maybeSingle();
  if (fresh && (fresh.status === "voided" || fresh.status === "reversed")) {
    throw new ZohoError(`${p.number} was ${fresh.status} in the ERP while it was being posted: remove the payment in Zoho by hand.`);
  }
  let applied = 0;
  if (zohoInvoiceId) applied = (await applyToZohoInvoice(org, zohoInvoiceId, [{ zohoId: zid, amount: p.amount_aed, receipt: p.number }])).applied;
  return {
    zohoId: zid,
    result: {
      receipt: p.number,
      amount: p.amount_aed,
      bank_charges: p.bank_charge_aed,
      mode: MODE[p.method],
      kind: p.is_deposit ? "advance" : "payment",
      applied_now: applied,
      ...(preStartNote ? { note: preStartNote } : {}),
    },
  };
}

/* ------------------------------------------------- phase 2: vendors, bills, credit notes, expenses ------------------------------------------------- */

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
/** What Zoho accepts on bill/credit-note attachments; expense receipts also take xls/xlsx/doc/docx. */
const BILL_ATTACH_EXTS = new Set(["pdf", "png", "jpg", "jpeg", "gif", "bmp"]);
const RECEIPT_EXTS = new Set(["pdf", "png", "jpg", "jpeg", "gif", "bmp", "xls", "xlsx"]);

async function bucketFile(bucket: string, path: string): Promise<{ data: Buffer; ext: string; contentType: string; name: string } | null> {
  try {
    const { data } = await createAdminClient().storage.from(bucket).download(path);
    if (!data) return null;
    const name = path.split("/").pop() ?? "file";
    const ext = (name.split(".").pop() ?? "").toLowerCase();
    return { data: Buffer.from(await data.arrayBuffer()), ext, contentType: CONTENT_TYPES[ext] ?? "application/octet-stream", name };
  } catch {
    return null;
  }
}

type SupplierLite = { id: string; name: string; phone: string | null; email: string | null; trn: string | null; vat_registered: boolean; zoho_vendor_id: string | null };

/**
 * The supplier's Zoho vendor: stored id first, then the exact name among vendors, then create. Zoho contact names
 * are unique across customers AND vendors, so a clash with a customer gets the "· Supplier" suffix.
 */
export async function ensureVendor(org: string, supplierId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("suppliers").select("id, name, phone, email, trn, zoho_vendor_id").eq("id", supplierId).maybeSingle();
  const s = data as SupplierLite | null;
  if (!s) throw new ZohoError("The supplier no longer exists in the ERP.");
  let zid = s.zoho_vendor_id;
  const name = s.name.trim();
  const sameName = (x: ZohoContact) => x.contact_name.trim().toLowerCase() === name.toLowerCase() || x.contact_name.trim().toLowerCase() === `${name} · supplier`;
  const lookFor = async (): Promise<string | null> => {
    // contains, not exact: a vendor created under the "· Supplier" suffix must still be found on a retry.
    const j = await zohoFetch<{ contacts?: ZohoContact[] }>(`/contacts?contact_name_contains=${encodeURIComponent(name)}&contact_type=vendor`, { org });
    return j.contacts?.find(sameName)?.contact_id ?? null;
  };
  if (!zid) {
    zid = await lookFor();
    if (!zid) {
      const trn = (s.trn ?? "").replace(/\D/g, "");
      const body = (contactName: string) => ({
        contact_name: cut(contactName, 200),
        company_name: cut(name, 200),
        contact_type: "vendor",
        ...(s.phone || s.email ? { contact_persons: [{ first_name: cut(name, 100), mobile: s.phone ?? "", phone: s.phone ?? "", ...(s.email ? { email: s.email } : {}), is_primary_contact: true }] } : {}),
        ...(trn.length === 15 ? { tax_treatment: "vat_registered", tax_reg_no: trn } : { tax_treatment: "vat_not_registered" }),
        place_of_supply: "AE",
      });
      try {
        const j = await zohoFetch<{ contact?: ZohoContact }>("/contacts", { org, method: "POST", body: body(name) });
        zid = j.contact?.contact_id ?? null;
      } catch (e) {
        if (e instanceof ZohoError && /exist/i.test(e.message)) {
          zid = await lookFor();
          if (!zid) {
            const j = await zohoFetch<{ contact?: ZohoContact }>("/contacts", { org, method: "POST", body: body(`${name} · Supplier`) });
            zid = j.contact?.contact_id ?? null;
          }
        } else throw e;
      }
      if (!zid) throw new ZohoError("Zoho did not return the new vendor.");
    }
    await admin.from("suppliers").update({ zoho_vendor_id: zid }).eq("id", s.id);
  }
  await admin.from("zoho_outbox").update({ status: "synced", zoho_id: zid, synced_at: new Date().toISOString(), last_error: null }).eq("kind", "vendor").eq("record_id", s.id).neq("status", "synced");
  return zid;
}

/* ----------------------------------------------------------- credit notes ----------------------------------------------------------- */

type ZohoCreditNote = { creditnote_id: string; creditnote_number: string; status: string; total: number; balance: number; customer_id?: string };

async function zohoCreditNoteById(org: string, id: string): Promise<ZohoCreditNote | null> {
  try {
    const j = await zohoFetch<{ creditnote?: ZohoCreditNote }>(`/creditnotes/${id}`, { org });
    return j.creditnote ?? null;
  } catch (e) {
    if (e instanceof ZohoError && e.code === 1002) return null;
    throw e;
  }
}

/**
 * An ERP credit note (one lump line, owner-issued) becomes a Zoho credit note with the SAME CN number, applied
 * against the original invoice. The UAE edition requires a credit reason; the ERP has none, so "others" with the
 * owner's own wording in the line. Refunds are not posted: the ERP records no refunds yet.
 */
async function syncCreditNoteRow(org: string, accounts: Resolved, invoiceId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("invoices").select(`${INVOICE_SELECT}, zoho_creditnote_id`).eq("id", invoiceId).maybeSingle();
  if (!raw) throw new ZohoError("The credit note no longer exists in the ERP.");
  const cn = toInvoice(raw as Record<string, unknown>) as InvoiceRow & { zoho_creditnote_id: string | null };
  if (cn.kind !== "credit_note") return { result: { skipped: "Not a credit note." } };
  if (cn.status === "cancelled" && !cn.zoho_creditnote_id) return { result: { skipped: "Cancelled in the ERP before it was posted. Nothing went to Zoho." } };
  if (cn.status === "cancelled") throw new ZohoError(`${cn.number} was cancelled in the ERP after it reached Zoho: the accountant voids it in Zoho by hand.`);
  if (!cn.credit_of) throw new ZohoError(`${cn.number} has no parent invoice in the ERP.`);
  const cnGate = await startDateSkip(dubaiDate(cn.issued_at), "creditnote", cn.id);
  if (cnGate) return cnGate;
  const [{ data: parent }, { data: lineRows }, job] = await Promise.all([
    admin.from("invoices").select("id, number, job_id, zoho_invoice_id, issued_at").eq("id", cn.credit_of).maybeSingle(),
    admin.from("invoice_lines").select(INVOICE_LINE_SELECT).eq("invoice_id", cn.id).eq("is_active", true).order("position"),
    cn.job_id ? admin.from("jobs").select("department").eq("id", cn.job_id).maybeSingle().then((r) => r.data as { department: string | null } | null) : Promise.resolve(null),
  ]);
  const par = parent as { id: string; number: string; job_id: string | null; zoho_invoice_id: string | null; issued_at: string } | null;
  if (!par) throw new ZohoError(`${cn.number}: the invoice it credits no longer exists in the ERP.`);
  if (!par.zoho_invoice_id) {
    const preStart = await parentBeforeStart(dubaiDate(par.issued_at));
    if (preStart) throw new ZohoError(`${cn.number} credits ${par.number}, which is dated before the go-live start date ${preStart} and so is not in the REAL book (a UAE credit note must name its invoice). ${DONE_BY_HAND}`);
    // The parent posts first; the credit note waits its turn.
    await ensureQueued("invoice", par.id, par.job_id);
    return { wait: `Waiting for ${par.number} to reach Zoho first.` };
  }
  const contactId = await ensureContact(org, cn.customer_id);
  const lines = (lineRows ?? []).map((r) => toInvoiceLine(r as Record<string, unknown>));
  const incomeKey: IncomeKey = job?.department === "bodyshop" ? "bodyshop" : "other";
  const matches = (z: ZohoCreditNote) => near(z.total, cn.total_aed);

  let z: ZohoCreditNote | null = cn.zoho_creditnote_id ? await zohoCreditNoteById(org, cn.zoho_creditnote_id) : null;
  if (!z) {
    const j = await zohoFetch<{ creditnotes?: ZohoCreditNote[] }>(`/creditnotes?creditnote_number=${encodeURIComponent(cn.number)}`, { org });
    const found = j.creditnotes?.find((x) => x.creditnote_number === cn.number) ?? null;
    const full = found ? await zohoCreditNoteById(org, found.creditnote_id) : null;
    if (full && (String(full.customer_id ?? "") !== contactId || !matches(full))) {
      throw new ZohoError(`A credit note numbered ${cn.number} already exists in Zoho with different figures or on another customer: the accountant checks it in Zoho.`);
    }
    z = full;
  }
  if (!z) {
    // Never credit twice: a credit note entered BY HAND in Zoho during phase 1 carries Zoho's own number, so the
    // number search above cannot see it — but the invoice's applied credits can. More credit than the invoice has
    // room for means something is already there: a human decides, nothing posts.
    const parentBefore = await zohoInvoiceById(org, par.zoho_invoice_id);
    const creditedBefore = await zohoCreditedTotal(org, par.zoho_invoice_id);
    if (parentBefore && creditedBefore + cn.total_aed > parentBefore.total + 0.009) {
      throw new ZohoError(`${par.number} already carries ${creditedBefore.toFixed(2)} of credit in Zoho (maybe entered by hand before the sync): posting ${cn.number} (${cn.total_aed.toFixed(2)}) would credit more than the invoice. The accountant checks it in Zoho.`);
    }
    const body = {
      customer_id: contactId,
      creditnote_number: cn.number,
      date: dubaiDate(cn.issued_at),
      reason_for_credit_debit_note: "others",
      reference_number: par.number,
      // Must match the invoice it credits, or Zoho refuses the association ("Place Of Supply is different").
      place_of_supply: "DU",
      line_items: lines.length
        ? lines.map((l, i) => ({ name: cut(l.description, 100), quantity: 1, rate: l.amount_aed, tax_id: accounts.taxId, account_id: accounts.income[incomeKey], item_order: i + 1 }))
        : [{ name: cut(cn.notes ?? `Credit against ${par.number}`, 100), quantity: 1, rate: cn.taxable_aed, tax_id: accounts.taxId, account_id: accounts.income[incomeKey] }],
      ...(cn.notes ? { notes: cut(cn.notes, 2000) } : {}),
    };
    try {
      // The UAE edition insists on the associated invoice ("Specify the Associated Invoice Number"), and passing
      // it here also applies the credit against that invoice in the same breath.
      const j = await zohoFetch<{ creditnote?: ZohoCreditNote }>(`/creditnotes?ignore_auto_number_generation=true&invoice_id=${encodeURIComponent(par.zoho_invoice_id)}`, { org, method: "POST", body });
      z = j.creditnote ?? null;
    } catch (e) {
      const again = await zohoFetch<{ creditnotes?: ZohoCreditNote[] }>(`/creditnotes?creditnote_number=${encodeURIComponent(cn.number)}`, { org });
      const found = again.creditnotes?.find((x) => x.creditnote_number === cn.number);
      const full = found ? await zohoCreditNoteById(org, found.creditnote_id) : null;
      if (!full || String(full.customer_id ?? "") !== contactId) throw e;
      z = full;
    }
    if (!z) throw new ZohoError("Zoho did not return the new credit note.");
  }
  if (!matches(z)) throw new ZohoError(`Totals differ for ${cn.number}: Zoho has ${z.total.toFixed(2)}, the ERP has ${cn.total_aed.toFixed(2)}.`);
  await admin.from("invoices").update({ zoho_creditnote_id: z.creditnote_id }).eq("id", cn.id);

  // Apply the unapplied part against the original invoice (never twice: Zoho's own balance says what is left).
  let appliedNow = 0;
  const parentInv = await zohoInvoiceById(org, par.zoho_invoice_id);
  const canApply = round2(Math.min(z.balance, parentInv?.balance ?? 0));
  if (canApply > 0.005) {
    await zohoFetch(`/creditnotes/${z.creditnote_id}/invoices`, { org, method: "POST", body: { invoices: [{ invoice_id: par.zoho_invoice_id, amount_applied: canApply }] } });
    appliedNow = canApply;
  }
  const after = (await zohoCreditNoteById(org, z.creditnote_id)) ?? z;
  const parentAfter = await zohoInvoiceById(org, par.zoho_invoice_id);
  void appliedNow;
  return {
    zohoId: z.creditnote_id,
    result: {
      number: cn.number,
      zoho: { total: after.total, unapplied: after.balance },
      erp: { total: cn.total_aed, vat: cn.vat_aed },
      applied_to: par.number,
      // What sits on invoices in all: creation-against-the-invoice applies it in the same breath.
      applied_total: round2(after.total - after.balance),
      invoice_balance_after: parentAfter?.balance ?? null,
    },
  };
}

/* ----------------------------------------------------------- bills ----------------------------------------------------------- */

type ZohoBill = { bill_id: string; bill_number: string; status: string; sub_total: number; tax_total: number; total: number; balance: number; vendor_id?: string; documents?: unknown[] };

async function zohoBillById(org: string, id: string): Promise<ZohoBill | null> {
  try {
    const j = await zohoFetch<{ bill?: ZohoBill }>(`/bills/${id}`, { org });
    return j.bill ?? null;
  } catch (e) {
    if (e instanceof ZohoError && e.code === 1002) return null;
    throw e;
  }
}

export type PoRow = {
  id: string;
  number: string;
  kind: string;
  job_id: string | null;
  supplier_id: string | null;
  supplier_name: string;
  total_cost_aed: number | null;
  supplier_invoice_status: string | null;
  supplier_invoice_number: string | null;
  supplier_invoice_date: string | null;
  supplier_invoice_amount: number | null;
  supplier_invoice_path: string | null;
  supplier_paid_at: string | null;
  supplier_paid_reference: string | null;
  zoho_bill_id: string | null;
  zoho_billpayment_id: string | null;
};

const PO_ZOHO_SELECT = "id, number, kind, job_id, supplier_id, supplier_name, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_path, supplier_paid_at, supplier_paid_reference, zoho_bill_id, zoho_billpayment_id";

export async function poForZoho(poId: string): Promise<PoRow> {
  const { data } = await createAdminClient().from("purchase_orders").select(PO_ZOHO_SELECT).eq("id", poId).maybeSingle();
  if (!data) throw new ZohoError("The LPO no longer exists in the ERP.");
  const po = data as unknown as PoRow;
  po.total_cost_aed = Number(po.total_cost_aed) || 0;
  po.supplier_invoice_amount = po.supplier_invoice_amount == null ? null : Number(po.supplier_invoice_amount);
  return po;
}

/** The LPO's supplier record, by id or (legacy rows) by name. */
async function poVendor(org: string, po: PoRow): Promise<{ vendorId: string; trn: string; vatRegistered: boolean }> {
  const admin = createAdminClient();
  let supplierId = po.supplier_id;
  if (!supplierId) {
    const { data } = await admin.from("suppliers").select("id").ilike("name", po.supplier_name).limit(1).maybeSingle();
    supplierId = (data as { id: string } | null)?.id ?? null;
    if (!supplierId) throw new ZohoError(`${po.number} has no supplier record in the ERP (only the name "${po.supplier_name}").`);
  }
  const vendorId = await ensureVendor(org, supplierId);
  const { data: s } = await admin.from("suppliers").select("trn, vat_registered").eq("id", supplierId).maybeSingle();
  const row = s as { trn: string | null; vat_registered: boolean } | null;
  return { vendorId, trn: (row?.trn ?? "").replace(/\D/g, ""), vatRegistered: row?.vat_registered !== false };
}

/**
 * The supplier's VAT standing decides the bill's tax: a registered supplier needs a 15-digit TRN and bills with
 * VAT 5%; one with the "not VAT registered" switch bills without VAT. Either way the Zoho vendor is kept in step
 * (idempotent PUT — the vendor may have been created before the TRN was known). Returns whether lines carry tax.
 */
async function vendorVatRegistered(org: string, po: PoRow, v: { vendorId: string; trn: string; vatRegistered: boolean }): Promise<boolean> {
  if (!v.vatRegistered) {
    await zohoFetch(`/contacts/${v.vendorId}`, { org, method: "PUT", body: { tax_treatment: "vat_not_registered" } });
    return false;
  }
  if (v.trn.length !== 15) {
    throw new ZohoError(`${po.supplier_name} has no TRN in the ERP, and a VAT bill needs the supplier's VAT registration: enter the 15-digit TRN from their invoice on Parts > Suppliers (or mark them "not VAT registered" there), then press Retry.`);
  }
  await zohoFetch(`/contacts/${v.vendorId}`, { org, method: "PUT", body: { tax_treatment: "vat_registered", tax_reg_no: v.trn } });
  return true;
}

export type BillErpFigures = {
  lines: { description: string; quantity: number; unit: number; lpoUnit: number; check: string | null }[];
  charges: { description: string; amount: number }[];
  chargesSum: number;
  linesTotal: number;
  useEntered: boolean;
  /** Before VAT. */
  expectedNet: number;
  partsRate: number;
  taxed: boolean;
  /** What the bill totals in Zoho (net + 5% when the supplier is VAT-registered). */
  gross: number;
};

/**
 * The ONE computation of what an LPO's bill is worth — used by the sync AND the daily reconciliation, so the
 * two can never drift. The bill reflects what the supplier DELIVERED and invoiced: received quantities when
 * recorded, ordered quantities on a fully received LPO, nothing for an undelivered line on a part delivery;
 * each courier/freight charge rides as its own line; and the before-VAT figure Peter TYPED wins when it
 * differs from the lines.
 */
export async function billErpFigures(po: PoRow): Promise<BillErpFigures> {
  const admin = createAdminClient();
  const [{ data: lineRows }, { data: chargeRows }, { data: poStatusRow }, { data: supRow }] = await Promise.all([
    admin.from("purchase_order_lines").select("description, quantity, received_qty, unit_cost, invoice_unit_cost, invoice_check").eq("po_id", po.id),
    admin.from("supplier_charges").select("description, amount_aed").eq("po_id", po.id).eq("is_active", true).is("removed_at", null),
    admin.from("purchase_orders").select("status").eq("id", po.id).maybeSingle(),
    po.supplier_id ? admin.from("suppliers").select("vat_registered").eq("id", po.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const fullyReceived = ((poStatusRow as { status?: string } | null)?.status ?? "") !== "partly_received";
  const lines = (lineRows ?? []).map((l) => ({
    description: String(l.description ?? ""),
    quantity: l.received_qty != null ? Number(l.received_qty) || 0 : fullyReceived ? Number(l.quantity) || 0 : 0,
    unit: Number(l.invoice_unit_cost ?? l.unit_cost) || 0,
    lpoUnit: Number(l.unit_cost) || 0,
    check: (l.invoice_check ?? null) as string | null,
  }));
  const charges = (chargeRows ?? []).map((c) => ({ description: String(c.description ?? ""), amount: round2(Number(c.amount_aed) || 0) }));
  const partsNet = round2(lines.reduce((a, l) => a + l.quantity * l.unit, 0));
  const chargesSum = round2(charges.reduce((a, c) => a + c.amount, 0));
  const linesTotal = round2(partsNet + chargesSum);
  const entered = po.supplier_invoice_amount;
  const useEntered = entered != null && entered > 0 && Math.abs(entered - linesTotal) > 0.05;
  const expectedNet = useEntered ? round2(entered) : linesTotal;
  const partsRate = round2(expectedNet - chargesSum);
  const taxed = (supRow as { vat_registered?: boolean } | null)?.vat_registered !== false;
  const gross = taxed ? round2(expectedNet + round2(expectedNet * 0.05)) : expectedNet;
  return { lines, charges, chargesSum, linesTotal, useEntered, expectedNet, partsRate, taxed, gross };
}

/**
 * One Zoho bill per supplier LPO with its invoice entered: the bill number is the SUPPLIER'S invoice number,
 * the parts go as one summary line at the invoice's NET figures (Zoho adds the 5%), each courier/freight charge
 * is its own line, the price-differs flags ride in the notes and the scan is attached.
 */
async function syncBillRow(org: string, accounts: Resolved, poId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const po = await poForZoho(poId);
  if (po.kind === "main") return { result: { skipped: "A main LPO splits into supplier LPOs; the bills sit on those." } };
  if (/^our stock$/i.test(po.supplier_name.trim())) return { result: { skipped: "An Our-stock LPO is internal (our own shelf): no supplier bill." } };
  if (po.supplier_invoice_status !== "received" || !po.supplier_invoice_number || !po.supplier_invoice_date) {
    return { wait: "Waiting for the supplier invoice to be entered on the LPO." };
  }
  const billGate = await startDateSkip(String(po.supplier_invoice_date).slice(0, 10), "bill", po.id);
  if (billGate) return billGate;
  const vendor = await poVendor(org, po);
  const taxed = await vendorVatRegistered(org, po, vendor);
  const vendorId = vendor.vendorId;
  const { lines, charges, chargesSum, linesTotal, useEntered, expectedNet, partsRate } = await billErpFigures(po);
  if (partsRate < -0.005) throw new ZohoError(`${po.number}: the invoice amount entered (${expectedNet.toFixed(2)}) is less than the courier/freight charges on it (${chargesSum.toFixed(2)}): check the figures on the LPO page.`);
  const purchases = needAccounts(accounts.purchases, accounts.purchasesError);
  const flagged = lines.filter((l) => l.check && l.check !== "match");
  const notes = cut(
    [
      `ERP ${po.number}`,
      ...(useEntered ? [`Entered invoice total ${expectedNet.toFixed(2)} (the LPO lines sum to ${linesTotal.toFixed(2)})`] : []),
      ...flagged.map((l) => `Price differs from the LPO — ${l.description}: LPO ${l.lpoUnit.toFixed(2)}, invoice ${l.unit.toFixed(2)} (${l.check})`),
    ].join("\n"),
    2000,
  );
  const line_items: Record<string, unknown>[] = [];
  if (partsRate > 0.005 || lines.length) {
    line_items.push({ name: cut(`Parts per ${po.number} – ${lines.length} item${lines.length === 1 ? "" : "s"}`, 100), rate: partsRate, quantity: 1, account_id: purchases.parts, ...(taxed ? { tax_id: accounts.taxId } : {}) });
  }
  for (const c of charges) line_items.push({ name: cut(c.description, 100), rate: c.amount, quantity: 1, account_id: purchases.courier, ...(taxed ? { tax_id: accounts.taxId } : {}) });
  if (!line_items.length) throw new ZohoError(`${po.number} has nothing to bill (no lines and no charges).`);

  const matches = (z: ZohoBill) => near(z.sub_total, expectedNet);
  let z: ZohoBill | null = po.zoho_bill_id ? await zohoBillById(org, po.zoho_bill_id) : null;
  if (!z) {
    const j = await zohoFetch<{ bills?: ZohoBill[] }>(`/bills?bill_number=${encodeURIComponent(po.supplier_invoice_number)}&vendor_id=${encodeURIComponent(vendorId)}`, { org });
    const found = j.bills?.find((x) => x.bill_number === po.supplier_invoice_number) ?? null;
    const full = found ? await zohoBillById(org, found.bill_id) : null;
    if (full && !matches(full)) {
      throw new ZohoError(`A bill numbered ${po.supplier_invoice_number} already exists in Zoho for this supplier with different figures (${full.sub_total.toFixed(2)} there, ${expectedNet.toFixed(2)} here) — another LPO may share the same supplier invoice: the accountant combines them in Zoho by hand.`);
    }
    z = full;
  }
  if (!z) {
    const body = { vendor_id: vendorId, bill_number: po.supplier_invoice_number, date: po.supplier_invoice_date, reference_number: po.number, line_items, notes, is_inclusive_tax: false, tax_treatment: taxed ? "vat_registered" : "vat_not_registered" };
    try {
      const j = await zohoFetch<{ bill?: ZohoBill }>("/bills", { org, method: "POST", body });
      z = j.bill ?? null;
    } catch (e) {
      const again = await zohoFetch<{ bills?: ZohoBill[] }>(`/bills?bill_number=${encodeURIComponent(po.supplier_invoice_number)}&vendor_id=${encodeURIComponent(vendorId)}`, { org });
      const found = again.bills?.find((x) => x.bill_number === po.supplier_invoice_number);
      const full = found ? await zohoBillById(org, found.bill_id) : null;
      if (!full) throw e;
      z = full;
    }
    if (!z) throw new ZohoError("Zoho did not return the new bill.");
  }
  if (!matches(z)) throw new ZohoError(`Totals differ for the bill ${po.supplier_invoice_number} (${po.number}): Zoho has ${z.sub_total.toFixed(2)} before VAT, the ERP has ${expectedNet.toFixed(2)}.`);
  // The VAT standing too: a bill posted before the supplier's switch moved must not turn green on a Retry.
  if (taxed !== z.tax_total > 0.005) {
    throw new ZohoError(`The bill ${po.supplier_invoice_number} (${po.number}) carries ${z.tax_total > 0.005 ? `VAT ${z.tax_total.toFixed(2)}` : "no VAT"} in Zoho, but ${po.supplier_name} is now ${taxed ? "VAT registered" : "NOT VAT registered"} in the ERP: correct the bill in Zoho by hand, then press "Done by hand".`);
  }
  await admin.from("purchase_orders").update({ zoho_bill_id: z.bill_id }).eq("id", po.id);

  // The scan: the first live invoice file on the LPO (stock orders have none - that is fine). Never twice: the
  // bill's own documents list says whether something is already attached.
  let attached = (z.documents?.length ?? 0) > 0;
  let attachNote: string | null = null;
  if (!attached) {
    const { data: files } = await admin.from("job_files").select("storage_path").eq("kind", "supplier_invoice").eq("ref_id", po.id).is("removed_at", null).order("created_at").limit(5);
    const paths = [...((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path), ...(po.supplier_invoice_path ? [po.supplier_invoice_path] : [])];
    let readable = 0;
    for (const p of paths) {
      const file = await bucketFile("job-files", p);
      if (!file) continue;
      if (!BILL_ATTACH_EXTS.has(file.ext)) {
        attachNote = "The scan's format is not one Zoho accepts (it needs pdf, jpg, png, gif or bmp).";
        continue;
      }
      readable++;
      await zohoFetch(`/bills/${z.bill_id}/attachment`, { org, method: "POST", upload: { field: "attachment", filename: file.name, contentType: file.contentType, data: file.data } });
      attached = true;
      attachNote = null;
      break;
    }
    // A scan exists but could not be read from storage: FAILED so a Retry attaches it, never a silent miss.
    if (!attached && paths.length && !readable && !attachNote) {
      throw new ZohoError(`The bill for ${po.number} posted but its scan could not be read from storage: press Retry to attach it.`);
    }
  }
  return {
    zohoId: z.bill_id,
    result: {
      bill: po.supplier_invoice_number,
      lpo: po.number,
      zoho: { net: z.sub_total, vat: z.tax_total, total: z.total, balance: z.balance },
      erp: { net: expectedNet, charges: chargesSum },
      attached,
      ...(attachNote ? { note: attachNote } : {}),
      ...(flagged.length ? { price_flags: flagged.length } : {}),
    },
  };
}

/** The supplier marked paid: one Zoho vendor payment settling the bill in full, from the mapped paid-from account. */
async function syncBillPaymentRow(org: string, accounts: Resolved, poId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const po = await poForZoho(poId);
  if (/^our stock$/i.test(po.supplier_name.trim())) return { result: { skipped: "An Our-stock LPO is internal (our own shelf): no supplier payment." } };
  if (!po.supplier_paid_at) return { wait: "Waiting for the LPO to be marked paid." };
  const bpGate = await startDateSkip(dubaiDate(po.supplier_paid_at), "billpayment", po.id);
  if (bpGate) return bpGate;
  if (!po.zoho_bill_id) {
    const preStart = await parentBeforeStart(po.supplier_invoice_date ? String(po.supplier_invoice_date) : null);
    if (preStart) throw new ZohoError(`The bill ${po.supplier_invoice_number ?? po.number} (${po.number}) is dated before the go-live start date ${preStart}, so it is not in the REAL book: this supplier payment (${dubaiDate(po.supplier_paid_at)}) cannot post against it. ${DONE_BY_HAND}`);
    await ensureQueued("bill", po.id, po.job_id);
    return { wait: `Waiting for the bill of ${po.number} to reach Zoho first.` };
  }
  const vendorId = (await poVendor(org, po)).vendorId;
  let zid = po.zoho_billpayment_id;
  if (!zid) {
    const j = await zohoFetch<{ vendorpayments?: { payment_id: string; reference_number?: string }[] }>(`/vendorpayments?reference_number=${encodeURIComponent(po.number)}&vendor_id=${encodeURIComponent(vendorId)}`, { org });
    zid = j.vendorpayments?.find((x) => x.reference_number === po.number)?.payment_id ?? null;
  }
  let amount = 0;
  if (!zid) {
    const bill = await zohoBillById(org, po.zoho_bill_id);
    if (!bill) throw new ZohoError(`The Zoho bill of ${po.number} cannot be read back.`);
    if (bill.balance <= 0.005) {
      return { zohoId: null, result: { skipped: `The bill ${bill.bill_number} is already settled in Zoho.`, lpo: po.number } };
    }
    amount = round2(bill.balance);
    const j = await zohoFetch<{ vendorpayment?: { payment_id: string } }>("/vendorpayments", {
      org,
      method: "POST",
      body: {
        vendor_id: vendorId,
        amount,
        date: dubaiDate(po.supplier_paid_at),
        payment_mode: "banktransfer",
        paid_through_account_id: needAccounts(accounts.paidFrom, accounts.paidFromError),
        reference_number: po.number,
        description: cut(`${po.number}${po.supplier_paid_reference ? ` · ${po.supplier_paid_reference}` : ""}`, 200),
        bills: [{ bill_id: po.zoho_bill_id, amount_applied: amount }],
      },
    });
    zid = j.vendorpayment?.payment_id ?? null;
    if (!zid) throw new ZohoError("Zoho did not return the new vendor payment.");
  }
  // An adopted payment (a run that died after creating it) reports ITS OWN amount: the reconciliation trusts this
  // figure, and the bill's total would be wrong whenever a supplier credit was applied first.
  if (!amount) {
    const vp = await zohoFetch<{ vendorpayment?: { amount?: number } }>(`/vendorpayments/${zid}`, { org });
    amount = round2(Number(vp.vendorpayment?.amount) || 0);
  }
  // The id is stored only once the bill really shows 0 due: an adopted foreign/partial payment must fail loudly
  // WITHOUT locking creation out on the next run.
  const after = await zohoBillById(org, po.zoho_bill_id);
  if (after && after.balance > 0.005) throw new ZohoError(`${po.number} is marked paid in the ERP but the Zoho bill still shows ${after.balance.toFixed(2)} due: the accountant checks it in Zoho.`);
  await admin.from("purchase_orders").update({ zoho_billpayment_id: zid }).eq("id", po.id);
  return { zohoId: zid, result: { lpo: po.number, bill: po.supplier_invoice_number, amount: amount || null, bill_balance_after: after?.balance ?? 0 } };
}

/* ----------------------------------------------------------- vendor credits (returned parts) ----------------------------------------------------------- */

type ZohoVendorCredit = { vendor_credit_id: string; vendor_credit_number: string; status: string; total: number; balance: number; vendor_id?: string; reference_number?: string };

async function zohoVendorCreditById(org: string, id: string): Promise<ZohoVendorCredit | null> {
  try {
    const j = await zohoFetch<{ vendor_credit?: ZohoVendorCredit }>(`/vendorcredits/${id}`, { org });
    return j.vendor_credit ?? null;
  } catch (e) {
    if (e instanceof ZohoError && e.code === 1002) return null;
    throw e;
  }
}

/**
 * A part returned to the supplier = a Zoho vendor credit (the supplier's credit note), applied against the
 * part's bill when that bill still owes anything. The reference RET-<part id> makes retries adopt, never
 * duplicate; Zoho vendor credits take no attachments, so the credit-note scan stays in the ERP.
 */
async function syncVendorCreditRow(org: string, accounts: Resolved, partId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("part_items")
    .select("id, job_id, description, quantity, confirmed_quantity, received_qty, returned_qty, cost_aed, final_cost_aed, supplier, po_id, disposition, disposition_note, disposition_at, return_status, zoho_vendorcredit_id")
    .eq("id", partId)
    .maybeSingle();
  const part = data as { id: string; job_id: string | null; description: string; quantity: number; confirmed_quantity: number | null; received_qty: number | null; returned_qty: number | null; cost_aed: number | null; final_cost_aed: number | null; supplier: string | null; po_id: string | null; disposition: string | null; disposition_note: string | null; disposition_at: string | null; return_status: string | null; zoho_vendorcredit_id: string | null } | null;
  if (!part) throw new ZohoError("The part no longer exists in the ERP.");
  // ONLY a return to the supplier is a supplier credit. return_status "returned" alone means "back with Parts"
  // (a part handed back, later kept in stock, scrapped or fitted as goodwill) — never money from the supplier.
  if (part.disposition !== "returned") {
    return { result: { skipped: "The part is not recorded as returned to the supplier. Nothing posted." } };
  }
  const vcGate = await startDateSkip(dubaiDate(part.disposition_at ?? new Date().toISOString()), "vendorcredit", part.id);
  if (vcGate) return vcGate;

  // The supplier: through the part's LPO, else by the name on the part.
  const admin2 = admin;
  let po: PoRow | null = null;
  if (part.po_id) po = await poForZoho(part.po_id).catch(() => null);
  let supplierId = po?.supplier_id ?? null;
  const supplierName = po?.supplier_name ?? part.supplier ?? "";
  if (!supplierId && supplierName) {
    const { data: s } = await admin2.from("suppliers").select("id").ilike("name", supplierName).limit(1).maybeSingle();
    supplierId = (s as { id: string } | null)?.id ?? null;
  }
  if (!supplierId) throw new ZohoError(`The returned part "${part.description}" has no supplier record in the ERP: pick the supplier on the Parts page, then press Retry.`);
  if (/^our stock$/i.test(supplierName.trim())) return { result: { skipped: "Returned to our own shelf: no supplier credit." } };
  // The credit belongs on the part's bill: when the supplier's invoice is not in Zoho yet, it waits for it, so the
  // same facts post the same money whichever was typed first (a credit posted alone would never be applied, and
  // the supplier payment would then pay the bill in full).
  let billNote: string | null = null;
  if (po && po.kind !== "main" && !po.zoho_bill_id) {
    const preStart = await parentBeforeStart(po.supplier_invoice_date ? String(po.supplier_invoice_date) : null);
    if (preStart) {
      billNote = `The bill ${po.supplier_invoice_number ?? po.number} is dated before the go-live start date (opening balance): the accountant applies this credit to it by hand.`;
    } else {
      await ensureQueued("bill", po.id, po.job_id);
      return { wait: `Waiting for the bill of ${po.number} to reach Zoho first: the credit is applied to it.` };
    }
  }
  const vendorId = await ensureVendor(org, supplierId);
  const { data: sRow } = await admin2.from("suppliers").select("trn, vat_registered").eq("id", supplierId).maybeSingle();
  const sup = sRow as { trn: string | null; vat_registered: boolean } | null;
  const taxed = sup?.vat_registered !== false;
  if (taxed && ((sup?.trn ?? "").replace(/\D/g, "").length !== 15)) {
    throw new ZohoError(`${supplierName} has no TRN in the ERP, and a VAT credit needs the supplier's VAT registration: enter it on Parts > Suppliers (or mark them "not VAT registered"), then press Retry.`);
  }

  const qty = Number(part.returned_qty) || Number(part.received_qty) || Number(part.confirmed_quantity) || Number(part.quantity) || 0;
  const rate = round2(Number(part.final_cost_aed) > 0 ? Number(part.final_cost_aed) : Number(part.cost_aed) || 0);
  const amount = round2(qty * rate);
  if (amount <= 0) throw new ZohoError(`The returned part "${part.description}" has no cost recorded, so there is nothing to credit.`);
  const reference = `RET-${part.id.replace(/-/g, "").slice(0, 12)}`;
  const expectedTotal = taxed ? round2(amount + round2(amount * 0.05)) : amount;
  const matches = (z: ZohoVendorCredit) => near(z.total, expectedTotal);

  let z: ZohoVendorCredit | null = part.zoho_vendorcredit_id ? await zohoVendorCreditById(org, part.zoho_vendorcredit_id) : null;
  if (!z) {
    const j = await zohoFetch<{ vendorcredits?: ZohoVendorCredit[] }>(`/vendorcredits?reference_number=${encodeURIComponent(reference)}`, { org });
    const found = j.vendorcredits?.find((x) => x.reference_number === reference && String(x.vendor_id ?? "") === vendorId) ?? null;
    const full = found ? await zohoVendorCreditById(org, found.vendor_credit_id) : null;
    if (full && !matches(full)) throw new ZohoError(`A vendor credit for this return already exists in Zoho with different figures (${full.total.toFixed(2)} there, ${expectedTotal.toFixed(2)} here): the accountant checks it in Zoho.`);
    z = full;
  }
  if (!z) {
    const body = {
      vendor_id: vendorId,
      // OFJ TEST has no auto-numbering for vendor credits, so the number is given (same as the reference).
      vendor_credit_number: reference,
      date: dubaiDate(part.disposition_at ?? new Date().toISOString()),
      reference_number: reference,
      notes: cut([po ? `ERP ${po.number}` : null, part.disposition_note ? `Supplier credit note: ${part.disposition_note}` : "Supplier credit note to follow", "The scan stays in the ERP (Zoho vendor credits take no attachments)."].filter(Boolean).join("\n"), 2000),
      tax_treatment: taxed ? "vat_registered" : "vat_not_registered",
      line_items: [{ name: cut(`${part.description} · returned`, 100), quantity: qty, rate, account_id: needAccounts(accounts.purchases, accounts.purchasesError).parts, ...(taxed ? { tax_id: accounts.taxId } : {}) }],
    };
    try {
      const j = await zohoFetch<{ vendor_credit?: ZohoVendorCredit }>("/vendorcredits?ignore_auto_number_generation=true", { org, method: "POST", body });
      z = j.vendor_credit ?? null;
    } catch (e) {
      const again = await zohoFetch<{ vendorcredits?: ZohoVendorCredit[] }>(`/vendorcredits?reference_number=${encodeURIComponent(reference)}`, { org });
      const found = again.vendorcredits?.find((x) => x.reference_number === reference && String(x.vendor_id ?? "") === vendorId);
      const full = found ? await zohoVendorCreditById(org, found.vendor_credit_id) : null;
      if (!full) throw e;
      z = full;
    }
    if (!z) throw new ZohoError("Zoho did not return the new vendor credit.");
  }
  if (!matches(z)) throw new ZohoError(`Totals differ for the return of "${part.description}": Zoho has ${z.total.toFixed(2)}, the ERP has ${expectedTotal.toFixed(2)}.`);
  await admin2.from("part_items").update({ zoho_vendorcredit_id: z.vendor_credit_id }).eq("id", part.id);

  // Apply against the part's bill while it still owes anything (never twice: Zoho lists what is credited).
  let appliedNow = 0;
  let billBalanceAfter: number | null = null;
  if (po?.zoho_bill_id) {
    const credited = await zohoFetch<{ bills_credited?: { bill_id: string }[] }>(`/vendorcredits/${z.vendor_credit_id}/bills`, { org });
    const already = (credited.bills_credited ?? []).some((b) => String(b.bill_id) === po!.zoho_bill_id);
    if (!already) {
      const bill = await zohoBillById(org, po.zoho_bill_id);
      const take = round2(Math.min(z.balance, bill?.balance ?? 0));
      if (take > 0.005) {
        await zohoFetch(`/vendorcredits/${z.vendor_credit_id}/bills`, { org, method: "POST", body: { bills: [{ bill_id: po.zoho_bill_id, amount_applied: take }] } });
        appliedNow = take;
      }
    }
    billBalanceAfter = (await zohoBillById(org, po.zoho_bill_id))?.balance ?? null;
  }
  const after = (await zohoVendorCreditById(org, z.vendor_credit_id)) ?? z;
  return {
    zohoId: z.vendor_credit_id,
    result: {
      part: cut(part.description, 80),
      lpo: po?.number ?? null,
      qty,
      zoho: { total: after.total, unapplied: after.balance },
      erp: { total: expectedTotal, net: amount },
      applied_now: appliedNow,
      ...(billBalanceAfter != null ? { bill_balance_after: billBalanceAfter } : {}),
      supplier_credit_note: part.disposition_note ?? "to follow",
      note: billNote ?? "The credit-note scan stays in the ERP (Zoho vendor credits take no attachments).",
    },
  };
}

/* ----------------------------------------------------------- credit-note refunds ----------------------------------------------------------- */

/**
 * Accounts recorded a refund paid to the customer against a credit note: the refund posts from the mapped
 * paid-from account. Only the credit's UNAPPLIED part can refund (a credit already sitting on an invoice is
 * not money owed back), and the reference RF-<CN number> makes retries adopt.
 */
async function syncCnRefundRow(org: string, accounts: Resolved, invoiceId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("invoices").select(`${INVOICE_SELECT}, zoho_creditnote_id, zoho_refund_id, refund_paid_at, refund_paid_by, refund_method, refund_reference, refund_amount_aed`).eq("id", invoiceId).maybeSingle();
  if (!raw) throw new ZohoError("The credit note no longer exists in the ERP.");
  const cn = toInvoice(raw as Record<string, unknown>) as InvoiceRow & { zoho_creditnote_id: string | null; zoho_refund_id: string | null; refund_paid_at: string | null; refund_method: string | null; refund_reference: string | null; refund_amount_aed: number | null };
  if (cn.kind !== "credit_note") return { result: { skipped: "Not a credit note." } };
  if (!cn.refund_paid_at) return { wait: "Waiting for the refund to be recorded on the credit note." };
  const rfGate = await startDateSkip(dubaiDate(cn.refund_paid_at), "cnrefund", cn.id);
  if (rfGate) return rfGate;
  if (!cn.zoho_creditnote_id) {
    // A credit note from before go-live never reaches REAL, so its refund would wait forever: it fails instead.
    const preStart = await parentBeforeStart(dubaiDate(cn.issued_at));
    if (preStart) throw new ZohoError(`${cn.number} is dated before the go-live start date ${preStart}, so it is not in the REAL book: this refund of AED ${round2(Number(cn.refund_amount_aed) || cn.total_aed).toFixed(2)} (${cn.refund_method === "cash" ? "cash" : "bank transfer"}, ${dubaiDate(cn.refund_paid_at)}) cannot post against it. ${DONE_BY_HAND}`);
    await ensureQueued("creditnote", cn.id, cn.job_id);
    return { wait: `Waiting for ${cn.number} to reach Zoho first.` };
  }
  const amount = round2(Number(cn.refund_amount_aed) || cn.total_aed);
  const reference = `RF-${cn.number}`;
  const fromAccount = needAccounts(accounts.advancesRefund, accounts.advancesRefundError);

  // Adopt first: the refund may already be there from a half-finished run.
  let refundId = cn.zoho_refund_id;
  if (!refundId) {
    const j = await zohoFetch<{ creditnote_refunds?: { creditnote_refund_id: string; reference_number?: string; amount_bcy?: number; amount?: number }[] }>(`/creditnotes/${cn.zoho_creditnote_id}/refunds`, { org });
    const found = (j.creditnote_refunds ?? []).find((r) => r.reference_number === reference) ?? null;
    if (found) {
      const there = Number(found.amount ?? found.amount_bcy) || 0;
      if (!near(there, amount)) throw new ZohoError(`A refund for ${cn.number} already exists in Zoho with a different amount (${there.toFixed(2)} there, ${amount.toFixed(2)} here): the accountant checks it in Zoho.`);
      refundId = found.creditnote_refund_id;
    }
  }
  if (!refundId) {
    const before = await zohoCreditNoteById(org, cn.zoho_creditnote_id);
    if (!before) throw new ZohoError(`${cn.number} cannot be read back from Zoho.`);
    if (before.balance < amount - 0.005) {
      throw new ZohoError(`Only ${before.balance.toFixed(2)} of ${cn.number} is unapplied in Zoho (the rest sits on the invoice), so a refund of ${amount.toFixed(2)} cannot post: the accountant frees the credit in Zoho or corrects the refund amount.`);
    }
    const j = await zohoFetch<{ creditnote_refund?: { creditnote_refund_id: string } }>(`/creditnotes/${cn.zoho_creditnote_id}/refunds`, {
      org,
      method: "POST",
      body: {
        date: dubaiDate(cn.refund_paid_at),
        refund_mode: cn.refund_method === "cash" ? "cash" : "banktransfer",
        amount,
        from_account_id: fromAccount,
        reference_number: reference,
        ...(cn.refund_reference ? { description: cut(cn.refund_reference, 200) } : {}),
      },
    });
    refundId = j.creditnote_refund?.creditnote_refund_id ?? null;
    if (!refundId) throw new ZohoError("Zoho did not return the new refund.");
  }
  await admin.from("invoices").update({ zoho_refund_id: refundId }).eq("id", cn.id);
  const after = await zohoCreditNoteById(org, cn.zoho_creditnote_id);
  return {
    // The refund has no page of its own in Zoho: the row links to the credit note.
    zohoId: cn.zoho_creditnote_id,
    result: { number: cn.number, refund: amount, mode: cn.refund_method ?? "transfer", zoho_refund_id: refundId, cn_unapplied_after: after?.balance ?? null },
  };
}

/* ----------------------------------------------------------- expenses ----------------------------------------------------------- */

type ZohoExpense = { expense_id: string; total: number; status?: string; expense_receipt_name?: string | null; reference_number?: string };

async function zohoExpenseById(org: string, id: string): Promise<ZohoExpense | null> {
  try {
    const j = await zohoFetch<{ expense?: ZohoExpense }>(`/expenses/${id}`, { org });
    return j.expense ?? null;
  } catch (e) {
    if (e instanceof ZohoError && e.code === 1002) return null;
    throw e;
  }
}

async function expenseByReference(org: string, reference: string): Promise<ZohoExpense | null> {
  const j = await zohoFetch<{ expenses?: ZohoExpense[] }>(`/expenses?reference_number=${encodeURIComponent(reference)}`, { org });
  const found = j.expenses?.find((x) => x.reference_number === reference) ?? null;
  return found ? await zohoExpenseById(org, found.expense_id) : null;
}

async function createExpense(org: string, input: { accountId: string; paidThroughId: string; date: string; amount: number; reference: string; description: string }): Promise<ZohoExpense> {
  const existing = await expenseByReference(org, input.reference);
  if (existing) {
    if (!near(existing.total, input.amount)) throw new ZohoError(`An expense with the reference ${input.reference} already exists in Zoho with a different amount (${existing.total.toFixed(2)} there, ${input.amount.toFixed(2)} here): the accountant checks it in Zoho.`);
    return existing;
  }
  const j = await zohoFetch<{ expense?: ZohoExpense }>("/expenses", {
    org,
    method: "POST",
    body: { account_id: input.accountId, paid_through_account_id: input.paidThroughId, date: input.date, amount: input.amount, reference_number: cut(input.reference, 100), description: cut(input.description, 100) },
  });
  if (!j.expense) throw new ZohoError("Zoho did not return the new expense.");
  return j.expense;
}

async function attachReceipt(org: string, expense: ZohoExpense, file: { data: Buffer; ext: string; contentType: string; name: string } | null): Promise<boolean> {
  if (expense.expense_receipt_name) return true;
  if (!file || !RECEIPT_EXTS.has(file.ext)) return false;
  await zohoFetch(`/expenses/${expense.expense_id}/receipt`, { org, method: "POST", upload: { field: "receipt", filename: file.name, contentType: file.contentType, data: file.data } });
  return true;
}

/** A paid commission voucher (CPV-xxxxx) = one Zoho expense with the signed voucher or slip as the receipt. */
async function syncCommissionRow(org: string, accounts: Resolved, paymentId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const { data } = await admin.from("commission_payments").select("id, number, recipient, method, paid_on, amount_aed, reference, proof_path, is_active, zoho_expense_id").eq("id", paymentId).maybeSingle();
  const v = data as { id: string; number: string; recipient: string; method: string; paid_on: string; amount_aed: number; reference: string | null; proof_path: string | null; is_active: boolean; zoho_expense_id: string | null } | null;
  if (!v) throw new ZohoError("The commission voucher no longer exists in the ERP.");
  if (!v.is_active) return { result: { skipped: "The voucher is inactive in the ERP. Nothing posted." } };
  const commGate = await startDateSkip(String(v.paid_on).slice(0, 10), "commission", v.id);
  if (commGate) return commGate;
  const amount = round2(Number(v.amount_aed) || 0);
  let z = v.zoho_expense_id ? await zohoExpenseById(org, v.zoho_expense_id) : null;
  if (!z) {
    z = await createExpense(org, {
      accountId: needAccounts(accounts.expense, accounts.expenseError).commission,
      paidThroughId: v.method === "cash" ? accounts.depositTo.cash : needAccounts(accounts.paidFrom, accounts.paidFromError),
      date: String(v.paid_on).slice(0, 10),
      amount,
      reference: v.number,
      description: `Commission · ${v.recipient}`,
    });
  }
  if (!near(z.total, amount)) throw new ZohoError(`Totals differ for ${v.number}: Zoho has ${z.total.toFixed(2)}, the ERP has ${amount.toFixed(2)}.`);
  await admin.from("commission_payments").update({ zoho_expense_id: z.expense_id }).eq("id", v.id);
  const receipt = await attachReceipt(org, z, v.proof_path ? await bucketFile("job-files", v.proof_path) : null);
  return {
    zohoId: z.expense_id,
    result: { voucher: v.number, recipient: v.recipient, amount, mode: v.method, receipt, ...(receipt ? {} : { note: "The signed voucher is not uploaded yet; it attaches by itself once it is." }) },
  };
}

/** A recovery month marked paid = one Zoho expense per driver/company, with the month's trip list attached as Excel. */
async function syncRecoveryRow(org: string, accounts: Resolved, payoutId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const { data } = await admin.from("recovery_payouts").select("id, who, month, total_aed, trip_count, paid_at, zoho_expense_id").eq("id", payoutId).maybeSingle();
  const p = data as { id: string; who: string; month: string; total_aed: number; trip_count: number; paid_at: string; zoho_expense_id: string | null } | null;
  if (!p) throw new ZohoError("The recovery payout no longer exists in the ERP.");
  const recGate = await startDateSkip(dubaiDate(p.paid_at), "recovery", p.id);
  if (recGate) return recGate;
  const amount = round2(Number(p.total_aed) || 0);
  const reference = cut(`RECOV ${p.month} ${p.who}`, 100);
  let z = p.zoho_expense_id ? await zohoExpenseById(org, p.zoho_expense_id) : null;
  if (!z) {
    z = await createExpense(org, {
      accountId: needAccounts(accounts.expense, accounts.expenseError).recovery,
      paidThroughId: needAccounts(accounts.paidFrom, accounts.paidFromError),
      date: dubaiDate(p.paid_at),
      amount,
      reference,
      description: `Recovery ${p.month} · ${p.who} · ${p.trip_count} trip${p.trip_count === 1 ? "" : "s"}`,
    });
  }
  if (!near(z.total, amount)) throw new ZohoError(`Totals differ for the recovery month ${p.month} (${p.who}): Zoho has ${z.total.toFixed(2)}, the ERP has ${amount.toFixed(2)}.`);
  await admin.from("recovery_payouts").update({ zoho_expense_id: z.expense_id }).eq("id", p.id);
  let receipt = !!z.expense_receipt_name;
  if (!receipt) {
    // The month's trip list as the receipt, built fresh (the same figures the /recovery page showed).
    const { data: tripRows } = await admin.from("recovery_trips").select("job_id, kind, company, driver_name, scheduled_date, delivered_at, created_at, price_aed, road_km").eq("paid_month", p.month).eq("is_active", true);
    const whoOf = (t: { company: string | null; driver_name: string | null }) => t.company ?? (t.driver_name ? `Our truck · ${t.driver_name}` : "Our truck");
    const trips = ((tripRows ?? []) as { job_id: string | null; kind: string; company: string | null; driver_name: string | null; scheduled_date: string | null; delivered_at: string | null; created_at: string; price_aed: number | null; road_km: number | null }[]).filter((t) => whoOf(t) === p.who);
    const { buildXlsx } = await import("@/lib/xlsx");
    const buf = await buildXlsx([
      {
        name: cut(p.who.replace(/[\\/?*[\]:]/g, " "), 31) || "Month",
        columns: [
          { header: "Date", key: "date", width: 12 },
          { header: "Kind", key: "kind", width: 10 },
          { header: "Km", key: "km", width: 8 },
          { header: "Price AED", key: "price", width: 12, numFmt: "#,##0.00" },
        ],
        rows: trips.map((t) => ({ date: String(t.delivered_at ?? t.scheduled_date ?? t.created_at).slice(0, 10), kind: t.kind, km: Number(t.road_km) || "", price: round2(Number(t.price_aed) || 0) })),
        totals: { price: amount },
      },
    ]);
    receipt = await attachReceipt(org, z, { data: buf, ext: "xlsx", contentType: CONTENT_TYPES.xlsx, name: `recovery-${p.month}.xlsx` });
  }
  return { zohoId: z.expense_id, result: { month: p.month, who: p.who, amount, trips: p.trip_count, receipt } };
}

/* ------------------------------------------------------- the worker ------------------------------------------------------- */

export type DrainReport = { pushed: number; failed: number; waiting: number; skipped?: string };

const KIND_ORDER: Record<ZohoKind, number> = { contact: 0, vendor: 1, deposit: 2, invoice: 3, creditnote: 4, payment: 5, cnrefund: 6, bill: 7, vendorcredit: 8, billpayment: 9, commission: 10, recovery: 11 };

/**
 * The five-minute worker (and the Sync now button): oldest first, contacts before deposits before invoices before
 * payments, one Zoho call at a time (zohoFetch's own queue), every row's outcome written on the row. A row that
 * cannot run yet (a cheque not cleared, an invoice not in Zoho) stays pending with the reason; a real refusal goes
 * FAILED and shows amber on the accounts' Waiting on you.
 */
export async function drainZohoOutbox(limit = 25): Promise<DrainReport> {
  if (!zohoConfigured()) return { pushed: 0, failed: 0, waiting: 0, skipped: "Zoho is not set up on this server (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET)." };
  // The organization comes from the switch as it stands NOW (not the request's cached settings).
  const liveAtStart = await zohoLiveNow();
  const org = liveAtStart ? ZOHO_REAL_ORG_ID : await zohoTestOrgId();
  if (!org) return { pushed: 0, failed: 0, waiting: 0, skipped: "No test organization is picked on Settings > Zoho Books." };
  const admin = createAdminClient();
  // A claim older than ten minutes belongs to a worker that died: the row may be taken again.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await admin.from("zoho_outbox").select("id, kind, record_id, attempts, enqueued_at").eq("status", "pending").or(`claimed_at.is.null,claimed_at.lt.${cutoff}`).order("enqueued_at").limit(limit);
  const rows = (data ?? []) as Pick<OutboxRow, "id" | "kind" | "record_id" | "attempts" | "enqueued_at">[];
  const report: DrainReport = { pushed: 0, failed: 0, waiting: 0 };
  if (!rows.length) return report;
  rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.enqueued_at.localeCompare(b.enqueued_at));
  let accounts: Resolved | null = null;
  let accountsError: string | null = null;
  let accountsFatal = false;
  for (const row of rows) {
    // The claim: two drains at once (the cron next to a Sync now) never run the same row twice — the row is
    // marked in flight, not just version-checked, so a drain that STARTS mid-handler cannot take it either.
    const now = new Date().toISOString();
    const { data: claimed } = await admin.from("zoho_outbox").update({ claimed_at: now, attempts: row.attempts + 1, updated_at: now }).eq("id", row.id).eq("status", "pending").or(`claimed_at.is.null,claimed_at.lt.${cutoff}`).select("id");
    if (!claimed?.length) continue;
    // The go-live switch moved while this run was going: this row now belongs to the other book, whose ids were
    // just swapped in. Release it and stop; the next run starts on the right organization.
    if ((await zohoLiveNow()) !== liveAtStart) {
      await admin.from("zoho_outbox").update({ claimed_at: null, attempts: row.attempts }).eq("id", row.id).eq("claimed_at", now);
      report.skipped = "The go-live switch changed during this run; the next run continues on the new organization.";
      break;
    }
    try {
      let out: HandlerOut;
      if (row.kind === "contact") out = { zohoId: await ensureContact(org, row.record_id) };
      else if (row.kind === "vendor") out = { zohoId: await ensureVendor(org, row.record_id) };
      else {
        if (!accounts && !accountsError) {
          try {
            accounts = await resolveZohoAccounts(org, readZohoMap(await getSettings()));
          } catch (e) {
            accountsError = e instanceof Error ? e.message : String(e);
            // Only a problem a human must fix (the mapping, the connection) fails rows; a hiccup waits.
            accountsFatal = /Mapping missing|not found in this organization|No 5% tax|not connected|cannot be read|Pick the OFJ TEST/i.test(accountsError);
          }
        }
        if (!accounts) {
          if (accountsFatal) throw new ZohoError(accountsError ?? "The account mapping could not be read.");
          out = { wait: `Zoho could not be reached for the chart of accounts: ${accountsError ?? "unknown"}` };
        } else {
          out =
            row.kind === "invoice" ? await syncInvoiceRow(org, accounts, row.record_id)
            : row.kind === "creditnote" ? await syncCreditNoteRow(org, accounts, row.record_id)
            : row.kind === "bill" ? await syncBillRow(org, accounts, row.record_id)
            : row.kind === "billpayment" ? await syncBillPaymentRow(org, accounts, row.record_id)
            : row.kind === "commission" ? await syncCommissionRow(org, accounts, row.record_id)
            : row.kind === "recovery" ? await syncRecoveryRow(org, accounts, row.record_id)
            : row.kind === "vendorcredit" ? await syncVendorCreditRow(org, accounts, row.record_id)
            : row.kind === "cnrefund" ? await syncCnRefundRow(org, accounts, row.record_id)
            : await syncPaymentRow(org, accounts, row.record_id);
        }
      }
      // Every outcome write carries the claim stamp: a row reopened mid-flight (a proof uploaded while the
      // handler ran) keeps its fresh pending state and runs again, instead of being marked synced over it.
      if (out.wait) {
        await admin.from("zoho_outbox").update({ last_error: out.wait, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("claimed_at", now);
        report.waiting++;
      } else {
        const { data: s } = await admin.from("zoho_outbox").update({ status: "synced", synced_at: new Date().toISOString(), zoho_id: out.zohoId ?? null, zoho_result: out.result ?? null, last_error: null, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("claimed_at", now).select("id");
        if (s?.length) report.pushed++;
        else report.waiting++;
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const { data: f } = await admin.from("zoho_outbox").update({ status: "failed", last_error: msg, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", row.id).eq("claimed_at", now).select("id");
      if (f?.length) report.failed++;
      else report.waiting++;
      await logAppError("zoho_sync", e, { detail: { kind: row.kind, record: row.record_id } });
    }
  }
  return report;
}

/** Reads a whole table page by page: PostgREST caps one answer at 1,000 rows, which would blind the backfill. */
export async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await fetchPage(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/**
 * The owner's backfill: everything already in the ERP joins the queue — phase 1 money and phase 2 purchases/expenses.
 * Once LIVE it is the go-live replay: only documents dated on or after the start date (anything earlier never
 * posts to REAL), and no bulk customers or suppliers — the handlers make the contacts each document needs.
 */
export async function enqueueBackfill(by: string | null): Promise<{ contacts: number; deposits: number; invoices: number; payments: number; creditnotes: number; vendors: number; bills: number; billpayments: number; commissions: number; recoveries: number; vendorcredits: number; cnrefunds: number }> {
  const admin = createAdminClient();
  const out = { contacts: 0, deposits: 0, invoices: 0, payments: 0, creditnotes: 0, vendors: 0, bills: 0, billpayments: 0, commissions: 0, recoveries: 0, vendorcredits: 0, cnrefunds: 0 };
  // Read the switch fresh: the go-live flip calls this in the same request that just turned it on.
  const live = await zohoLiveNow();
  const startDate = String((await getSettings()).zoho_golive_start_date ?? "").trim();
  const since = live && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null;
  if (live && !since) throw new Error("The books are live but no start date is set: nothing can be replayed safely.");
  /** On or after the start date (always true before go-live). Stamps are read as Dubai days. */
  const onOrAfter = (stamp: string | null | undefined, isDay = false): boolean => !since || (!!stamp && (isDay ? String(stamp).slice(0, 10) : dubaiDate(String(stamp))) >= since);
  const existing = await pageAll<{ kind: string; record_id: string }>((a, b) => admin.from("zoho_outbox").select("kind, record_id").order("enqueued_at").range(a, b));
  const have = new Set(existing.map((r) => `${r.kind}:${r.record_id}`));
  const put: { kind: ZohoKind; record_id: string; job_id: string | null; created_by: string | null }[] = [];
  const customers = since ? [] : await pageAll<{ id: string }>((a, b) => admin.from("customers").select("id").eq("is_active", true).order("id").range(a, b));
  for (const c of customers) {
    if (have.has(`contact:${c.id}`)) continue;
    put.push({ kind: "contact", record_id: c.id, job_id: null, created_by: by });
    out.contacts++;
  }
  const invoices = await pageAll<{ id: string; job_id: string | null; issued_at: string }>((a, b) => admin.from("invoices").select("id, job_id, issued_at").eq("kind", "tax_invoice").eq("status", "issued").is("deposit_for_quotation_id", null).order("id").range(a, b));
  for (const i of invoices) {
    if (have.has(`invoice:${i.id}`) || !onOrAfter(i.issued_at)) continue;
    put.push({ kind: "invoice", record_id: i.id, job_id: i.job_id, created_by: by });
    out.invoices++;
  }
  const pays = await pageAll<{ id: string; job_id: string | null; is_deposit: boolean; method: string; cheque_status: string | null; received_at: string; cleared_at: string | null }>((a, b) => admin.from("payments").select("id, job_id, is_deposit, method, cheque_status, received_at, cleared_at").eq("status", "recorded").order("id").range(a, b));
  for (const p of pays) {
    if (p.method === "cheque" && p.cheque_status !== "cleared") continue;
    if (!onOrAfter(p.method === "cheque" ? (p.cleared_at ?? p.received_at) : p.received_at)) continue;
    const kind: ZohoKind = p.is_deposit ? "deposit" : "payment";
    if (have.has(`${kind}:${p.id}`)) continue;
    put.push({ kind, record_id: p.id, job_id: p.job_id, created_by: by });
    if (p.is_deposit) out.deposits++;
    else out.payments++;
  }
  // Phase 2: credit notes, vendors, supplier bills and payments, paid commissions, paid recovery months.
  const cns = await pageAll<{ id: string; job_id: string | null; issued_at: string }>((a, b) => admin.from("invoices").select("id, job_id, issued_at").eq("kind", "credit_note").eq("status", "issued").order("id").range(a, b));
  for (const c of cns) {
    if (have.has(`creditnote:${c.id}`) || !onOrAfter(c.issued_at)) continue;
    put.push({ kind: "creditnote", record_id: c.id, job_id: c.job_id, created_by: by });
    out.creditnotes++;
  }
  const vendors = since ? [] : await pageAll<{ id: string }>((a, b) => admin.from("suppliers").select("id").eq("is_active", true).order("id").range(a, b));
  for (const s of vendors) {
    if (have.has(`vendor:${s.id}`)) continue;
    put.push({ kind: "vendor", record_id: s.id, job_id: null, created_by: by });
    out.vendors++;
  }
  const pos = await pageAll<{ id: string; job_id: string | null; supplier_paid_at: string | null; supplier_invoice_date: string | null }>((a, b) =>
    admin.from("purchase_orders").select("id, job_id, supplier_paid_at, supplier_invoice_date").neq("kind", "main").not("supplier_name", "ilike", "our stock").eq("supplier_invoice_status", "received").not("supplier_invoice_number", "is", null).not("supplier_invoice_date", "is", null).eq("is_active", true).order("id").range(a, b),
  );
  for (const po of pos) {
    if (!have.has(`bill:${po.id}`) && onOrAfter(po.supplier_invoice_date, true)) {
      put.push({ kind: "bill", record_id: po.id, job_id: po.job_id, created_by: by });
      out.bills++;
    }
    if (po.supplier_paid_at && !have.has(`billpayment:${po.id}`) && onOrAfter(po.supplier_paid_at)) {
      put.push({ kind: "billpayment", record_id: po.id, job_id: po.job_id, created_by: by });
      out.billpayments++;
    }
  }
  const vouchers = await pageAll<{ id: string; paid_on: string | null }>((a, b) => admin.from("commission_payments").select("id, paid_on").eq("is_active", true).order("id").range(a, b));
  for (const v of vouchers) {
    if (have.has(`commission:${v.id}`) || !onOrAfter(v.paid_on, true)) continue;
    put.push({ kind: "commission", record_id: v.id, job_id: null, created_by: by });
    out.commissions++;
  }
  const payouts = await pageAll<{ id: string; paid_at: string | null }>((a, b) => admin.from("recovery_payouts").select("id, paid_at").order("id").range(a, b));
  for (const r of payouts) {
    if (have.has(`recovery:${r.id}`) || !onOrAfter(r.paid_at)) continue;
    put.push({ kind: "recovery", record_id: r.id, job_id: null, created_by: by });
    out.recoveries++;
  }
  // Phase 3: parts returned TO THE SUPPLIER (disposition; "back with Parts" alone is not a credit) and customer refunds.
  const returned = await pageAll<{ id: string; job_id: string | null; disposition_at: string | null }>((a, b) => admin.from("part_items").select("id, job_id, disposition_at").eq("is_active", true).eq("disposition", "returned").order("id").range(a, b));
  for (const pt of returned) {
    if (have.has(`vendorcredit:${pt.id}`) || !onOrAfter(pt.disposition_at)) continue;
    put.push({ kind: "vendorcredit", record_id: pt.id, job_id: pt.job_id, created_by: by });
    out.vendorcredits++;
  }
  const refunds = await pageAll<{ id: string; job_id: string | null; refund_paid_at: string }>((a, b) => admin.from("invoices").select("id, job_id, refund_paid_at").eq("kind", "credit_note").not("refund_paid_at", "is", null).order("id").range(a, b));
  for (const rf of refunds) {
    if (have.has(`cnrefund:${rf.id}`) || !onOrAfter(rf.refund_paid_at)) continue;
    put.push({ kind: "cnrefund", record_id: rf.id, job_id: rf.job_id, created_by: by });
    out.cnrefunds++;
  }
  for (let i = 0; i < put.length; i += 200) {
    // ignoreDuplicates: a row enqueued by a hook mid-backfill never aborts the rest.
    const { error } = await admin.from("zoho_outbox").upsert(put.slice(i, i + 200), { onConflict: "kind,record_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return out;
}
