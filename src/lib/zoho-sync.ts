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

/** Zoho account NAMES (not ids): the same mapping reads in OFJ TEST today and in the REAL book at go-live. */
export type ZohoAccountMap = {
  income: Partial<Record<IncomeKey, string>>;
  depositTo: Partial<Record<MethodKey, string>>;
  bankCharges?: string;
  advances?: string;
};

/** The pre-fill when the live chart has no better match; also what "Create the suggested accounts" makes in OFJ TEST. */
export const SUGGESTED_MAP: { income: Record<IncomeKey, string>; depositTo: Record<MethodKey, string>; bankCharges: string; advances: string } = {
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
  bankCharges: "Bank Fees and Charges",
  advances: "Customer advances",
};

export function readZohoMap(settings: Settings): ZohoAccountMap {
  const raw = (settings.zoho_account_map ?? {}) as ZohoAccountMap;
  return { income: raw.income ?? {}, depositTo: raw.depositTo ?? {}, bankCharges: raw.bankCharges, advances: raw.advances };
}

/** Where writes go: OFJ TEST until the owner declares go-live (zohoFetch refuses REAL anyway while the switch is off). */
export async function zohoWriteOrg(): Promise<string | null> {
  const settings = await getSettings();
  if (settings.zoho_live_enabled === true) return ZOHO_REAL_ORG_ID;
  return zohoTestOrgId();
}

type Resolved = { income: Record<IncomeKey, string>; depositTo: Record<MethodKey, string>; taxId: string };

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
  const resolve = async (name: string | undefined, label: string, kind: "income" | "cash" | "bank"): Promise<string> => {
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
  return { income, depositTo, taxId: tax.tax_id };
}

/* ------------------------------------------------------- the outbox ------------------------------------------------------- */

export type ZohoKind = "contact" | "deposit" | "invoice" | "payment";
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
  const admin = createAdminClient();
  const { data: ex } = await admin.from("zoho_outbox").select("id, status").eq("kind", kind).eq("record_id", recordId).maybeSingle();
  if (!ex) {
    await admin.from("zoho_outbox").insert({ kind, record_id: recordId, job_id: jobId, created_by: by });
    return;
  }
  if (ex.status === "failed") await admin.from("zoho_outbox").update({ status: "pending", last_error: null, updated_at: new Date().toISOString() }).eq("id", ex.id);
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
    const { data: ex } = await admin.from("zoho_outbox").select("id").eq("kind", kind).eq("record_id", recordId).maybeSingle();
    if (ex) await admin.from("zoho_outbox").update({ status: "failed", last_error: reason, updated_at: new Date().toISOString() }).eq("id", ex.id);
    else await admin.from("zoho_outbox").insert({ kind, record_id: recordId, status: "failed", last_error: reason });
  } catch (e) {
    await logAppError("zoho_flag", e, { detail: { kind, recordId } });
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
  const section = kind === "invoice" ? "invoices" : kind === "contact" ? "contacts" : "paymentsreceived";
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
  if (!zid) {
    const digits = (c.phone ?? "").replace(/\D/g, "").slice(-9);
    if (digits.length >= 7) {
      const j = await zohoFetch<{ contacts?: ZohoContact[] }>(`/contacts?phone_contains=${encodeURIComponent(digits)}`, { org });
      zid = j.contacts?.[0]?.contact_id ?? null;
    }
    const name = (c.company_name?.trim() || c.full_name).trim();
    if (!zid) {
      const j = await zohoFetch<{ contacts?: ZohoContact[] }>(`/contacts?contact_name=${encodeURIComponent(name)}`, { org });
      zid = j.contacts?.find((x) => x.contact_name.trim().toLowerCase() === name.toLowerCase())?.contact_id ?? null;
    }
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
        // A contact with the same display name exists: the customer number makes ours unmistakable.
        if (e instanceof ZohoError && /exist/i.test(e.message)) {
          const j = await zohoFetch<{ contact?: ZohoContact }>("/contacts", { org, method: "POST", body: body(`${name} · ${c.customer_number}`) });
          zid = j.contact?.contact_id ?? null;
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

type ZohoInvoice = { invoice_id: string; invoice_number: string; status: string; sub_total: number; tax_total: number; total: number; balance: number; reference_number?: string };

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

async function applyToZohoInvoice(org: string, zohoInvoiceId: string, pays: { zohoId: string; amount: number }[]): Promise<number> {
  if (!pays.length) return 0;
  const already = await zohoAppliedPayments(org, zohoInvoiceId);
  const inv = await zohoInvoiceById(org, zohoInvoiceId);
  let remaining = inv?.balance ?? 0;
  const invoice_payments: { payment_id: string; amount_applied: number }[] = [];
  for (const p of pays) {
    if (already.has(p.zohoId) || remaining <= 0.005) continue;
    // Only the payment's UNUSED part can go on: a deposit already applied elsewhere has nothing left to give.
    const unused = await paymentUnused(org, p.zohoId);
    const take = round2(Math.min(p.amount, unused, remaining));
    if (take <= 0) continue;
    invoice_payments.push({ payment_id: p.zohoId, amount_applied: take });
    remaining = round2(remaining - take);
  }
  if (invoice_payments.length) await zohoFetch(`/invoices/${zohoInvoiceId}/credits`, { org, method: "POST", body: { invoice_payments } });
  return invoice_payments.length;
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
  const buildItems = (roundoffAed: number) => {
    const items: Record<string, unknown>[] = lines.map((l, i) => {
      const q = l.quotation_line_id ? qMap.get(l.quotation_line_id) : undefined;
      const comp = l.price_display === "complimentary" || l.price_display === "included" || l.amount_aed === 0;
      const qty = l.quantity > 0 ? l.quantity : 1;
      const rate = comp ? 0 : l.quantity > 0 ? l.unit_price : l.amount_aed;
      const discount = comp ? 0 : Math.max(0, round2(rate * qty - l.amount_aed));
      const word = l.price_display === "included" ? "Included" : "Complimentary";
      return {
        name: cut(l.description, 100),
        description: cut([comp ? word : null, l.details].filter(Boolean).join(" · "), 2000),
        quantity: qty,
        rate,
        ...(discount > 0 ? { discount } : {}),
        tax_id: accounts.taxId,
        account_id: accounts.income[incomeKeyOf(l, q, job?.department ?? null)],
        item_order: i + 1,
      };
    });
    if (roundoffAed !== 0) items.push({ name: "Round-off", quantity: 1, rate: roundoffAed, tax_id: accounts.taxId, account_id: accounts.income.other, item_order: items.length + 1 });
    return items;
  };
  const discountTotal = round2(inv.discount_aed + inv.warranty_credit_aed);
  const body = (roundoffAed: number) => ({
    customer_id: "", // filled below
    invoice_number: inv.number,
    date: dubaiDate(inv.issued_at),
    reference_number: job?.job_number ?? inv.number,
    place_of_supply: "DU",
    ...(snap.trn ? { is_reverse_charge_applied: false } : {}),
    line_items: buildItems(roundoffAed),
    ...(discountTotal > 0 ? { discount: discountTotal, discount_type: "entity_level", is_discount_before_tax: true } : {}),
    ...(inv.discount_note || inv.notes ? { notes: cut([inv.discount_note, inv.notes].filter(Boolean).join("\n"), 2000) } : {}),
  });

  const contactId = await ensureContact(org, inv.customer_id);
  const matches = (z: ZohoInvoice) => near(z.total, inv.total_aed) && near(z.tax_total, inv.vat_aed);

  // Never twice: stored id, else the same number already in Zoho (adopted only when it is OURS), else create.
  let z: ZohoInvoice | null = inv.zoho_invoice_id ? await zohoInvoiceById(org, inv.zoho_invoice_id) : null;
  if (!z) {
    const byNumber = await zohoInvoiceByNumber(org, inv.number);
    // The list row misses tax_total, so the found invoice is read in full before any judgement on its figures.
    const full = byNumber ? await zohoInvoiceById(org, byNumber.invoice_id) : null;
    // Our own earlier post (figures match, or a half-finished run on the same job) is adopted and corrected below.
    // Anything else with our number is NEVER overwritten: the row fails in plain words instead.
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

  // Totals to the fils: one corrective pass on the Round-off line, then FAILED with both figures.
  if (!matches(z)) {
    const fix = round2(roundoff + (inv.taxable_aed - round2(z.total - z.tax_total)));
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
  const appliedNow = await applyToZohoInvoice(
    org,
    z.invoice_id,
    synced.map((p) => ({ zohoId: String((p as PaymentRow & { zoho_payment_id?: string | null }).zoho_payment_id), amount: p.amount_aed })),
  );
  const after = (await zohoInvoiceById(org, z.invoice_id)) ?? z;
  const appliedSum = round2(synced.reduce((a, p) => a + p.amount_aed, 0));
  const expectedBalance = Math.max(0, round2(inv.total_aed - appliedSum));
  if (!near(after.balance, expectedBalance)) {
    throw new ZohoError(`The balance differs for ${inv.number}: Zoho says ${after.balance.toFixed(2)}, the ERP expects ${expectedBalance.toFixed(2)} after the payments posted so far.`);
  }
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
  let applied = 0;
  if (zohoInvoiceId) applied = await applyToZohoInvoice(org, zohoInvoiceId, [{ zohoId: zid, amount: p.amount_aed }]);
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

/* ------------------------------------------------------- the worker ------------------------------------------------------- */

export type DrainReport = { pushed: number; failed: number; waiting: number; skipped?: string };

const KIND_ORDER: Record<ZohoKind, number> = { contact: 0, deposit: 1, invoice: 2, payment: 3 };

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
  const { data } = await admin.from("zoho_outbox").select("id, kind, record_id, attempts, enqueued_at").eq("status", "pending").order("enqueued_at").limit(limit);
  const rows = (data ?? []) as Pick<OutboxRow, "id" | "kind" | "record_id" | "attempts" | "enqueued_at">[];
  const report: DrainReport = { pushed: 0, failed: 0, waiting: 0 };
  if (!rows.length) return report;
  rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.enqueued_at.localeCompare(b.enqueued_at));
  let accounts: Resolved | null = null;
  let accountsError: string | null = null;
  for (const row of rows) {
    // The claim: two drains at once (the cron and a Sync now) never run the same row twice.
    const { data: claimed } = await admin.from("zoho_outbox").update({ attempts: row.attempts + 1, updated_at: new Date().toISOString() }).eq("id", row.id).eq("attempts", row.attempts).select("id");
    if (!claimed?.length) continue;
    try {
      let out: HandlerOut;
      if (row.kind === "contact") out = { zohoId: await ensureContact(org, row.record_id) };
      else {
        if (!accounts && !accountsError) {
          try {
            accounts = await resolveZohoAccounts(org, readZohoMap(await getSettings()));
          } catch (e) {
            accountsError = e instanceof Error ? e.message : String(e);
          }
        }
        if (!accounts) throw new ZohoError(accountsError ?? "The account mapping could not be read.");
        out = row.kind === "invoice" ? await syncInvoiceRow(org, accounts, row.record_id) : await syncPaymentRow(org, accounts, row.record_id);
      }
      if (out.wait) {
        await admin.from("zoho_outbox").update({ last_error: out.wait, updated_at: new Date().toISOString() }).eq("id", row.id);
        report.waiting++;
      } else {
        await admin.from("zoho_outbox").update({ status: "synced", synced_at: new Date().toISOString(), zoho_id: out.zohoId ?? null, zoho_result: out.result ?? null, last_error: null, updated_at: new Date().toISOString() }).eq("id", row.id);
        report.pushed++;
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await admin.from("zoho_outbox").update({ status: "failed", last_error: msg, updated_at: new Date().toISOString() }).eq("id", row.id);
      report.failed++;
      await logAppError("zoho_sync", e, { detail: { kind: row.kind, record: row.record_id } });
    }
  }
  return report;
}

/** The owner's backfill: every customer, recorded deposit, issued tax invoice and recorded payment joins the queue. */
export async function enqueueBackfill(by: string | null): Promise<{ contacts: number; deposits: number; invoices: number; payments: number }> {
  const admin = createAdminClient();
  const out = { contacts: 0, deposits: 0, invoices: 0, payments: 0 };
  const { data: existing } = await admin.from("zoho_outbox").select("kind, record_id");
  const have = new Set((existing ?? []).map((r) => `${r.kind}:${r.record_id}`));
  const put: { kind: ZohoKind; record_id: string; job_id: string | null; created_by: string | null }[] = [];
  const { data: customers } = await admin.from("customers").select("id").eq("is_active", true);
  for (const c of customers ?? []) {
    if (have.has(`contact:${c.id}`)) continue;
    put.push({ kind: "contact", record_id: c.id, job_id: null, created_by: by });
    out.contacts++;
  }
  const { data: invoices } = await admin.from("invoices").select("id, job_id").eq("kind", "tax_invoice").eq("status", "issued").is("deposit_for_quotation_id", null);
  for (const i of invoices ?? []) {
    if (have.has(`invoice:${i.id}`)) continue;
    put.push({ kind: "invoice", record_id: i.id, job_id: i.job_id, created_by: by });
    out.invoices++;
  }
  const { data: pays } = await admin.from("payments").select("id, job_id, is_deposit, method, cheque_status, status").eq("status", "recorded");
  for (const p of pays ?? []) {
    if (p.method === "cheque" && p.cheque_status !== "cleared") continue;
    const kind: ZohoKind = p.is_deposit ? "deposit" : "payment";
    if (have.has(`${kind}:${p.id}`)) continue;
    put.push({ kind, record_id: p.id, job_id: p.job_id, created_by: by });
    if (p.is_deposit) out.deposits++;
    else out.payments++;
  }
  for (let i = 0; i < put.length; i += 200) {
    const { error } = await admin.from("zoho_outbox").insert(put.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  return out;
}
