import "server-only";
import { logAppError } from "@/lib/app-errors";
import { INVOICE_LINE_SELECT, INVOICE_SELECT, PAYMENT_SELECT, toInvoice, toInvoiceLine, toPayment, type InvoiceLineRow, type InvoiceRow, type PaymentRow } from "@/lib/invoice-data";
import { round2 } from "@/lib/money";
import { getSettings, type Settings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZOHO_REAL_ORG_ID, ZohoError, listAccounts, listTaxes, zohoConfigured, zohoFetch, zohoTestOrgId } from "@/lib/zoho";

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

type Resolved = { income: Record<IncomeKey, string>; depositTo: Record<MethodKey, string>; purchases: Record<PurchaseKey, string>; expense: Record<ExpenseKey, string>; paidFrom: string; taxId: string };

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
  const purchases = {} as Record<PurchaseKey, string>;
  for (const p of PURCHASE_TYPES) purchases[p.key] = await resolve(map.purchases[p.key], p.label, "expense");
  const expense = {} as Record<ExpenseKey, string>;
  for (const e of EXPENSE_TYPES) expense[e.key] = await resolve(map.expense[e.key], e.label, "expense");
  const paidFrom = await resolve(map.paidFrom, "Paid-from account (supplier payments and expenses)", "bank");
  return { income, depositTo, purchases, expense, paidFrom, taxId: tax.tax_id };
}

/* ------------------------------------------------------- the outbox ------------------------------------------------------- */

export type ZohoKind = "contact" | "deposit" | "invoice" | "payment" | "creditnote" | "vendor" | "bill" | "billpayment" | "commission" | "recovery";
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

/** Something was ADDED to an already-synced document (a voucher proof uploaded late): the row runs once more. */
export async function reopenZoho(kind: ZohoKind, recordId: string): Promise<void> {
  try {
    await createAdminClient().from("zoho_outbox").update({ status: "pending", last_error: null, updated_at: new Date().toISOString() }).eq("kind", kind).eq("record_id", recordId);
  } catch (e) {
    await logAppError("zoho_reopen", e, { detail: { kind, recordId } });
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
    const j = await zohoFetch<{ contacts?: ZohoContact[] }>(`/contacts?contact_name=${encodeURIComponent(name)}`, { org });
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
  if (p.invoice_id) {
    const { data: invRow } = await admin.from("payments").select("invoice:invoices!payments_invoice_id_fkey(zoho_invoice_id, kind)").eq("id", p.id).maybeSingle();
    const inv = (invRow as unknown as { invoice: { zoho_invoice_id: string | null; kind: string } | null } | null)?.invoice;
    if (inv?.kind === "tax_invoice") zohoInvoiceId = inv.zoho_invoice_id;
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

type SupplierLite = { id: string; name: string; phone: string | null; email: string | null; trn: string | null; zoho_vendor_id: string | null };

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
    const j = await zohoFetch<{ contacts?: ZohoContact[] }>(`/contacts?contact_name=${encodeURIComponent(name)}&contact_type=vendor`, { org });
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
  const [{ data: parent }, { data: lineRows }, job] = await Promise.all([
    admin.from("invoices").select("id, number, job_id, zoho_invoice_id").eq("id", cn.credit_of).maybeSingle(),
    admin.from("invoice_lines").select(INVOICE_LINE_SELECT).eq("invoice_id", cn.id).eq("is_active", true).order("position"),
    cn.job_id ? admin.from("jobs").select("department").eq("id", cn.job_id).maybeSingle().then((r) => r.data as { department: string | null } | null) : Promise.resolve(null),
  ]);
  const par = parent as { id: string; number: string; job_id: string | null; zoho_invoice_id: string | null } | null;
  if (!par) throw new ZohoError(`${cn.number}: the invoice it credits no longer exists in the ERP.`);
  if (!par.zoho_invoice_id) {
    // The parent posts first; the credit note waits its turn.
    await tryEnqueueZoho("invoice", par.id, par.job_id);
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

type PoRow = {
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

async function poForZoho(poId: string): Promise<PoRow> {
  const { data } = await createAdminClient().from("purchase_orders").select(PO_ZOHO_SELECT).eq("id", poId).maybeSingle();
  if (!data) throw new ZohoError("The LPO no longer exists in the ERP.");
  const po = data as unknown as PoRow;
  po.total_cost_aed = Number(po.total_cost_aed) || 0;
  po.supplier_invoice_amount = po.supplier_invoice_amount == null ? null : Number(po.supplier_invoice_amount);
  return po;
}

/** The LPO's supplier record, by id or (legacy rows) by name. */
async function poVendor(org: string, po: PoRow): Promise<{ vendorId: string; trn: string }> {
  const admin = createAdminClient();
  let supplierId = po.supplier_id;
  if (!supplierId) {
    const { data } = await admin.from("suppliers").select("id").ilike("name", po.supplier_name).limit(1).maybeSingle();
    supplierId = (data as { id: string } | null)?.id ?? null;
    if (!supplierId) throw new ZohoError(`${po.number} has no supplier record in the ERP (only the name "${po.supplier_name}").`);
  }
  const vendorId = await ensureVendor(org, supplierId);
  const { data: s } = await admin.from("suppliers").select("trn").eq("id", supplierId).maybeSingle();
  return { vendorId, trn: ((s as { trn: string | null } | null)?.trn ?? "").replace(/\D/g, "") };
}

/** A VAT bill needs a VAT-registered vendor: once the TRN is on the supplier, the Zoho vendor follows it. */
async function vendorVatRegistered(org: string, po: PoRow, v: { vendorId: string; trn: string }): Promise<void> {
  if (v.trn.length !== 15) {
    throw new ZohoError(`${po.supplier_name} has no TRN in the ERP, and a VAT bill needs the supplier's VAT registration: enter the 15-digit TRN from their invoice on Parts > Suppliers, then press Retry.`);
  }
  // Idempotent: the vendor may have been created before the TRN was known ("VAT or Exemption cannot be applied").
  await zohoFetch(`/contacts/${v.vendorId}`, { org, method: "PUT", body: { tax_treatment: "vat_registered", tax_reg_no: v.trn } });
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
  if (po.supplier_invoice_status !== "received" || !po.supplier_invoice_number || !po.supplier_invoice_date) {
    return { wait: "Waiting for the supplier invoice to be entered on the LPO." };
  }
  const vendor = await poVendor(org, po);
  await vendorVatRegistered(org, po, vendor);
  const vendorId = vendor.vendorId;
  const [{ data: lineRows }, { data: chargeRows }] = await Promise.all([
    admin.from("purchase_order_lines").select("description, quantity, unit_cost, invoice_unit_cost, invoice_check").eq("po_id", po.id),
    admin.from("supplier_charges").select("description, amount_aed").eq("po_id", po.id).eq("is_active", true).is("removed_at", null),
  ]);
  const lines = (lineRows ?? []).map((l) => ({ description: String(l.description ?? ""), quantity: Number(l.quantity) || 0, unit: Number(l.invoice_unit_cost ?? l.unit_cost) || 0, lpoUnit: Number(l.unit_cost) || 0, check: (l.invoice_check ?? null) as string | null }));
  const charges = (chargeRows ?? []).map((c) => ({ description: String(c.description ?? ""), amount: round2(Number(c.amount_aed) || 0) }));
  const partsNet = round2(lines.reduce((a, l) => a + l.quantity * l.unit, 0));
  const chargesSum = round2(charges.reduce((a, c) => a + c.amount, 0));
  const linesTotal = round2(partsNet + chargesSum);
  // "The total must equal the invoice amount entered": when Peter typed a (before-VAT) figure that differs from
  // the lines, the ENTERED figure wins and the parts line absorbs the difference, named as per the invoice.
  const entered = po.supplier_invoice_amount;
  const useEntered = entered != null && entered > 0 && Math.abs(entered - linesTotal) > 0.05;
  const expectedNet = useEntered ? round2(entered) : linesTotal;
  const partsRate = round2(expectedNet - chargesSum);
  if (partsRate < -0.005) throw new ZohoError(`${po.number}: the invoice amount entered (${expectedNet.toFixed(2)}) is less than the courier/freight charges on it (${chargesSum.toFixed(2)}): check the figures on the LPO page.`);
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
    line_items.push({ name: cut(`Parts per ${po.number} – ${lines.length} item${lines.length === 1 ? "" : "s"}`, 100), rate: partsRate, quantity: 1, account_id: accounts.purchases.parts, tax_id: accounts.taxId });
  }
  for (const c of charges) line_items.push({ name: cut(c.description, 100), rate: c.amount, quantity: 1, account_id: accounts.purchases.courier, tax_id: accounts.taxId });
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
    const body = { vendor_id: vendorId, bill_number: po.supplier_invoice_number, date: po.supplier_invoice_date, reference_number: po.number, line_items, notes, is_inclusive_tax: false };
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
  await admin.from("purchase_orders").update({ zoho_bill_id: z.bill_id }).eq("id", po.id);

  // The scan: the first live invoice file on the LPO (stock orders have none - that is fine). Never twice: the
  // bill's own documents list says whether something is already attached.
  let attached = (z.documents?.length ?? 0) > 0;
  if (!attached) {
    const { data: files } = await admin.from("job_files").select("storage_path").eq("kind", "supplier_invoice").eq("ref_id", po.id).is("removed_at", null).order("created_at").limit(5);
    const paths = [...((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path), ...(po.supplier_invoice_path ? [po.supplier_invoice_path] : [])];
    for (const p of paths) {
      const file = await bucketFile("job-files", p);
      if (!file || !BILL_ATTACH_EXTS.has(file.ext)) continue;
      await zohoFetch(`/bills/${z.bill_id}/attachment`, { org, method: "POST", upload: { field: "attachment", filename: file.name, contentType: file.contentType, data: file.data } });
      attached = true;
      break;
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
      ...(flagged.length ? { price_flags: flagged.length } : {}),
    },
  };
}

/** The supplier marked paid: one Zoho vendor payment settling the bill in full, from the mapped paid-from account. */
async function syncBillPaymentRow(org: string, accounts: Resolved, poId: string): Promise<HandlerOut> {
  const admin = createAdminClient();
  const po = await poForZoho(poId);
  if (!po.supplier_paid_at) return { wait: "Waiting for the LPO to be marked paid." };
  if (!po.zoho_bill_id) {
    await tryEnqueueZoho("bill", po.id, po.job_id);
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
        paid_through_account_id: accounts.paidFrom,
        reference_number: po.number,
        description: cut(`${po.number}${po.supplier_paid_reference ? ` · ${po.supplier_paid_reference}` : ""}`, 200),
        bills: [{ bill_id: po.zoho_bill_id, amount_applied: amount }],
      },
    });
    zid = j.vendorpayment?.payment_id ?? null;
    if (!zid) throw new ZohoError("Zoho did not return the new vendor payment.");
  }
  await admin.from("purchase_orders").update({ zoho_billpayment_id: zid }).eq("id", po.id);
  const after = await zohoBillById(org, po.zoho_bill_id);
  if (after && after.balance > 0.005) throw new ZohoError(`${po.number} is marked paid in the ERP but the Zoho bill still shows ${after.balance.toFixed(2)} due: the accountant checks it in Zoho.`);
  return { zohoId: zid, result: { lpo: po.number, bill: po.supplier_invoice_number, amount: amount || after?.total || null, bill_balance_after: after?.balance ?? 0 } };
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
  const amount = round2(Number(v.amount_aed) || 0);
  let z = v.zoho_expense_id ? await zohoExpenseById(org, v.zoho_expense_id) : null;
  if (!z) {
    z = await createExpense(org, {
      accountId: accounts.expense.commission,
      paidThroughId: v.method === "cash" ? accounts.depositTo.cash : accounts.paidFrom,
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
  const amount = round2(Number(p.total_aed) || 0);
  const reference = cut(`RECOV ${p.month} ${p.who}`, 100);
  let z = p.zoho_expense_id ? await zohoExpenseById(org, p.zoho_expense_id) : null;
  if (!z) {
    z = await createExpense(org, {
      accountId: accounts.expense.recovery,
      paidThroughId: accounts.paidFrom,
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

const KIND_ORDER: Record<ZohoKind, number> = { contact: 0, vendor: 1, deposit: 2, invoice: 3, creditnote: 4, payment: 5, bill: 6, billpayment: 7, commission: 8, recovery: 9 };

/**
 * The five-minute worker (and the Sync now button): oldest first, contacts before deposits before invoices before
 * payments, one Zoho call at a time (zohoFetch's own queue), every row's outcome written on the row. A row that
 * cannot run yet (a cheque not cleared, an invoice not in Zoho) stays pending with the reason; a real refusal goes
 * FAILED and shows amber on the accounts' Waiting on you.
 */
export async function drainZohoOutbox(limit = 25): Promise<DrainReport> {
  if (!zohoConfigured()) return { pushed: 0, failed: 0, waiting: 0, skipped: "Zoho is not set up on this server (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET)." };
  const org = await zohoWriteOrg();
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
            : await syncPaymentRow(org, accounts, row.record_id);
        }
      }
      if (out.wait) {
        await admin.from("zoho_outbox").update({ last_error: out.wait, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", row.id);
        report.waiting++;
      } else {
        await admin.from("zoho_outbox").update({ status: "synced", synced_at: new Date().toISOString(), zoho_id: out.zohoId ?? null, zoho_result: out.result ?? null, last_error: null, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", row.id);
        report.pushed++;
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await admin.from("zoho_outbox").update({ status: "failed", last_error: msg, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", row.id);
      report.failed++;
      await logAppError("zoho_sync", e, { detail: { kind: row.kind, record: row.record_id } });
    }
  }
  return report;
}

/** Reads a whole table page by page: PostgREST caps one answer at 1,000 rows, which would blind the backfill. */
async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await fetchPage(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/** The owner's backfill: everything already in the ERP joins the queue — phase 1 money and phase 2 purchases/expenses. */
export async function enqueueBackfill(by: string | null): Promise<{ contacts: number; deposits: number; invoices: number; payments: number; creditnotes: number; vendors: number; bills: number; billpayments: number; commissions: number; recoveries: number }> {
  const admin = createAdminClient();
  const out = { contacts: 0, deposits: 0, invoices: 0, payments: 0, creditnotes: 0, vendors: 0, bills: 0, billpayments: 0, commissions: 0, recoveries: 0 };
  const existing = await pageAll<{ kind: string; record_id: string }>((a, b) => admin.from("zoho_outbox").select("kind, record_id").order("enqueued_at").range(a, b));
  const have = new Set(existing.map((r) => `${r.kind}:${r.record_id}`));
  const put: { kind: ZohoKind; record_id: string; job_id: string | null; created_by: string | null }[] = [];
  const customers = await pageAll<{ id: string }>((a, b) => admin.from("customers").select("id").eq("is_active", true).order("id").range(a, b));
  for (const c of customers) {
    if (have.has(`contact:${c.id}`)) continue;
    put.push({ kind: "contact", record_id: c.id, job_id: null, created_by: by });
    out.contacts++;
  }
  const invoices = await pageAll<{ id: string; job_id: string | null }>((a, b) => admin.from("invoices").select("id, job_id").eq("kind", "tax_invoice").eq("status", "issued").is("deposit_for_quotation_id", null).order("id").range(a, b));
  for (const i of invoices) {
    if (have.has(`invoice:${i.id}`)) continue;
    put.push({ kind: "invoice", record_id: i.id, job_id: i.job_id, created_by: by });
    out.invoices++;
  }
  const pays = await pageAll<{ id: string; job_id: string | null; is_deposit: boolean; method: string; cheque_status: string | null }>((a, b) => admin.from("payments").select("id, job_id, is_deposit, method, cheque_status").eq("status", "recorded").order("id").range(a, b));
  for (const p of pays) {
    if (p.method === "cheque" && p.cheque_status !== "cleared") continue;
    const kind: ZohoKind = p.is_deposit ? "deposit" : "payment";
    if (have.has(`${kind}:${p.id}`)) continue;
    put.push({ kind, record_id: p.id, job_id: p.job_id, created_by: by });
    if (p.is_deposit) out.deposits++;
    else out.payments++;
  }
  // Phase 2: credit notes, vendors, supplier bills and payments, paid commissions, paid recovery months.
  const cns = await pageAll<{ id: string; job_id: string | null }>((a, b) => admin.from("invoices").select("id, job_id").eq("kind", "credit_note").eq("status", "issued").order("id").range(a, b));
  for (const c of cns) {
    if (have.has(`creditnote:${c.id}`)) continue;
    put.push({ kind: "creditnote", record_id: c.id, job_id: c.job_id, created_by: by });
    out.creditnotes++;
  }
  const vendors = await pageAll<{ id: string }>((a, b) => admin.from("suppliers").select("id").eq("is_active", true).order("id").range(a, b));
  for (const s of vendors) {
    if (have.has(`vendor:${s.id}`)) continue;
    put.push({ kind: "vendor", record_id: s.id, job_id: null, created_by: by });
    out.vendors++;
  }
  const pos = await pageAll<{ id: string; job_id: string | null; supplier_paid_at: string | null }>((a, b) =>
    admin.from("purchase_orders").select("id, job_id, supplier_paid_at").neq("kind", "main").eq("supplier_invoice_status", "received").not("supplier_invoice_number", "is", null).not("supplier_invoice_date", "is", null).eq("is_active", true).order("id").range(a, b),
  );
  for (const po of pos) {
    if (!have.has(`bill:${po.id}`)) {
      put.push({ kind: "bill", record_id: po.id, job_id: po.job_id, created_by: by });
      out.bills++;
    }
    if (po.supplier_paid_at && !have.has(`billpayment:${po.id}`)) {
      put.push({ kind: "billpayment", record_id: po.id, job_id: po.job_id, created_by: by });
      out.billpayments++;
    }
  }
  const vouchers = await pageAll<{ id: string }>((a, b) => admin.from("commission_payments").select("id").eq("is_active", true).order("id").range(a, b));
  for (const v of vouchers) {
    if (have.has(`commission:${v.id}`)) continue;
    put.push({ kind: "commission", record_id: v.id, job_id: null, created_by: by });
    out.commissions++;
  }
  const payouts = await pageAll<{ id: string }>((a, b) => admin.from("recovery_payouts").select("id").order("id").range(a, b));
  for (const r of payouts) {
    if (have.has(`recovery:${r.id}`)) continue;
    put.push({ kind: "recovery", record_id: r.id, job_id: null, created_by: by });
    out.recoveries++;
  }
  for (let i = 0; i < put.length; i += 200) {
    // ignoreDuplicates: a row enqueued by a hook mid-backfill never aborts the rest.
    const { error } = await admin.from("zoho_outbox").upsert(put.slice(i, i + 200), { onConflict: "kind,record_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return out;
}
