import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError } from "./app-errors";
import { INVOICE_SELECT, PAYMENT_SELECT, invoiceBalance, toInvoice, toPayment } from "./invoice-data";
import { formatPlate } from "./types";
import { notifyRoles, notifyStaff } from "./notifications";
import type { Settings } from "./settings";
import { CHEQUE_TAX_SETTING, EARLY_TAX_ASKED, EARLY_TAX_DECIDED, chequeTaxWhenOf, completedAtOf, earlyTaxStateOf, taxDueOf, type ChequeTaxWhen, type TaxDue } from "./tax-invoice-due-rules";

/*
 * THE tax invoice still missing on a completed job (18 November 2026, J-00493): the list (invoice page, accounts
 * dashboard, the hourly reminder), "Issue tax invoice now" with the owner's approval, and the cheque setting.
 * A tax invoice is only ever made by convertProformaIfPaid from the job's own proforma: never changed afterwards,
 * corrected only by credit note.
 */

const dubaiToday = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Who = { id: string; display_name: string; role_id: string };

export type MissingTax = {
  jobId: string;
  jobNumber: string;
  plate: string;
  customer: string;
  isOpen: boolean;
  completedAt: string;
  due: TaxDue;
  proforma: { id: string; number: string; total: number; expectedMethod: string | null };
  paid: number;
  pending: number;
  balance: number;
  /** paid = issue at once (it was missed); covered = a cheque/transfer still clearing covers it (owner approves). */
  state: "paid" | "covered" | "due";
  pendingReceipts: { number: string; method: string; chequeNumber: string | null; amount: number }[];
  asked: { at: string; by: string | null; byId: string | null; note: string } | null;
};

/** Completed jobs whose proforma has not become a tax invoice yet, oldest completion first. */
export async function missingTaxInvoices(opts: { jobIds?: string[] } = {}): Promise<MissingTax[]> {
  const admin = createAdminClient();
  let q = admin.from("invoices").select(`${INVOICE_SELECT}, expected_payment_method`).eq("kind", "proforma").eq("status", "issued").eq("is_active", true).is("converted_to", null).is("deposit_for_quotation_id", null).not("job_id", "is", null).limit(1000);
  if (opts.jobIds?.length) q = q.in("job_id", opts.jobIds);
  const { data: proRaw, error } = await q;
  if (error) {
    await logAppError("tax-invoice-due: proformas", error);
    return [];
  }
  const pros = ((proRaw ?? []) as Record<string, unknown>[]).map((r) => ({ inv: toInvoice(r), expected: (r.expected_payment_method as string | null) ?? null }));
  const jobIds = Array.from(new Set(pros.map((p) => p.inv.job_id).filter((x): x is string => !!x)));
  if (!jobIds.length) return [];
  const [{ data: taxRows }, { data: jobRows }, { data: evRows }, { data: payRows }] = await Promise.all([
    admin.from("invoices").select("job_id").eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null).in("job_id", jobIds),
    admin.from("jobs").select("id, job_number, is_open, status, ready_to_invoice_at, customer_id, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").in("id", jobIds),
    admin.from("job_events").select("job_id, event_type, to_status, note, created_at, created_by").in("job_id", jobIds).or(`to_status.in.(ready,pending_payment,in_delivery),event_type.in.(${EARLY_TAX_ASKED},${EARLY_TAX_DECIDED})`).order("created_at"),
    admin.from("payments").select(PAYMENT_SELECT).in("invoice_id", pros.map((p) => p.inv.id)).eq("is_active", true),
  ]);
  const taxed = new Set(((taxRows ?? []) as { job_id: string }[]).map((r) => r.job_id));
  const jobs = new Map(((jobRows ?? []) as unknown as { id: string; job_number: string; is_open: boolean; status: string; ready_to_invoice_at: string | null; customer_id: string | null; vehicle: Parameters<typeof formatPlate>[0] | null }[]).map((j) => [j.id, j]));
  const events = (evRows ?? []) as { job_id: string; event_type: string; to_status: string | null; note: string | null; created_at: string; created_by: string | null }[];
  const pays = ((payRows ?? []) as Record<string, unknown>[]).map(toPayment);
  const custIds = Array.from(new Set(Array.from(jobs.values()).map((j) => j.customer_id).filter((x): x is string => !!x)));
  const staffIds = Array.from(new Set(events.filter((e) => e.event_type === EARLY_TAX_ASKED).map((e) => e.created_by).filter((x): x is string => !!x)));
  const [{ data: custRows }, { data: staffRows }] = await Promise.all([
    custIds.length ? admin.from("customers").select("id, full_name, company_name").in("id", custIds) : Promise.resolve({ data: [] }),
    staffIds.length ? admin.from("staff").select("id, display_name").in("id", staffIds) : Promise.resolve({ data: [] }),
  ]);
  const custName = new Map(((custRows ?? []) as { id: string; full_name: string | null; company_name: string | null }[]).map((c) => [c.id, c.company_name || c.full_name || ""]));
  const staffName = new Map(((staffRows ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const today = dubaiToday();
  const out: MissingTax[] = [];
  for (const { inv, expected } of pros) {
    const jobId = inv.job_id as string;
    const job = jobs.get(jobId);
    if (!job || taxed.has(jobId) || job.status === "cancelled") continue;
    const evs = events.filter((e) => e.job_id === jobId);
    const completedAt = completedAtOf([job.ready_to_invoice_at, inv.issued_at, ...evs.filter((e) => e.to_status && ["ready", "pending_payment", "in_delivery"].includes(e.to_status)).map((e) => e.created_at)]);
    if (!completedAt) continue;
    const mine = pays.filter((p) => p.invoice_id === inv.id);
    const bal = invoiceBalance(inv, mine);
    const lastAsk = evs.filter((e) => e.event_type === EARLY_TAX_ASKED).at(-1) ?? null;
    const lastDecision = evs.filter((e) => e.event_type === EARLY_TAX_DECIDED).at(-1) ?? null;
    const open = lastAsk && (!lastDecision || lastDecision.created_at < lastAsk.created_at) ? lastAsk : null;
    out.push({
      jobId,
      jobNumber: job.job_number,
      plate: job.vehicle ? formatPlate(job.vehicle) : "",
      customer: (job.customer_id && custName.get(job.customer_id)) || "",
      isOpen: job.is_open,
      completedAt,
      due: taxDueOf(completedAt, today),
      proforma: { id: inv.id, number: inv.number, total: inv.total_aed, expectedMethod: expected },
      paid: bal.paid,
      pending: bal.pendingAmount,
      balance: bal.balance,
      state: earlyTaxStateOf({ balance: bal.balance, pending: bal.pendingAmount }),
      pendingReceipts: mine.filter((p) => p.status === "recorded" && ["cheque", "transfer"].includes(p.method) && p.cheque_status === "pending").map((p) => ({ number: p.number, method: p.method, chequeNumber: p.cheque_number ?? null, amount: p.amount_aed })),
      asked: open ? { at: open.created_at, by: open.created_by ? (staffName.get(open.created_by) ?? null) : null, byId: open.created_by, note: open.note ?? "" } : null,
    });
  }
  return out.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}

/** The cheque words of the waiting money ("cheque 018315 (RCT-00097)"). */
function waitingWords(m: MissingTax): string {
  return m.pendingReceipts.map((p) => `${p.method === "cheque" ? `cheque ${p.chequeNumber ?? ""}`.trim() : "transfer"} (${p.number})`).join(", ") || "the payment waiting for the bank";
}

async function issueNow(m: MissingTax, by: Who, settings: Settings, reason: string): Promise<{ error?: string; words?: string }> {
  const { convertProformaIfPaid } = await import("./invoice-flow");
  try {
    const tax = await convertProformaIfPaid(m.jobId, by.id, settings, m.state === "paid" ? {} : { force: { reason } });
    if (!tax) return { error: "The tax invoice was not made: reload the page (it may already exist)." };
    await createAdminClient().from("job_events").insert({ job_id: m.jobId, event_type: "tax_invoice_early", note: `${tax.number} issued from ${m.proforma.number}: ${reason}`, created_by: by.id });
    return { words: `${tax.number} issued from ${m.proforma.number}.` };
  } catch (e) {
    await logAppError("tax-invoice-due: issue", e, { jobId: m.jobId, staffId: by.id });
    return { error: "Couldn't make the tax invoice – nothing was changed. Try again or tell the owner." };
  }
}

/**
 * "Issue tax invoice now" (accounts and the owner). Paid in full: issued at once (it was missed). Covered by a cheque
 * or transfer still clearing: the owner's approval (the Approvals page; the auto-approve switch applies when the owner
 * ticked "Tax invoice before the cheque clears"); the owner himself issues it at once.
 */
export async function askEarlyTaxInvoice(jobId: string, note: string, by: Who, settings: Settings): Promise<{ error?: string; words?: string }> {
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only accounts or the owner issue a tax invoice." };
  const m = (await missingTaxInvoices({ jobIds: [jobId] }))[0];
  if (!m) return { error: "This job already has its tax invoice, or has no proforma yet." };
  if (m.state === "paid") return issueNow(m, by, settings, "Paid in full: the tax invoice had not been made");
  if (m.state === "due") return { error: `${money(m.balance - m.pending)} is still due and not covered by a cheque or transfer. Record the payment first.` };
  const reason = `${waitingWords(m)} waiting to clear covers ${money(m.balance)}${note.trim() ? ` · ${note.trim().slice(0, 300)}` : ""}`;
  if (by.role_id === "owner") return issueNow(m, by, settings, `Issued before the cheque cleared: ${reason}`);
  if (m.asked) return { words: `Already asked ${m.asked.by ? `by ${m.asked.by} ` : ""}– waiting for the owner.` };
  const { autoNow } = await import("./auto-approve");
  const { typeAllows, AUTO_WORDS, AUTO_EVENT, autoLogNote } = await import("./auto-approve-rules");
  const auto = await autoNow();
  if (auto.active && typeAllows(auto.cfg, "early_tax_cheque", m.balance)) {
    const r = await issueNow(m, by, settings, `${AUTO_WORDS}: issued before the cheque cleared: ${reason}`);
    if (!r.error) await createAdminClient().from("job_events").insert({ job_id: m.jobId, event_type: AUTO_EVENT, note: autoLogNote(`tax invoice before the cheque cleared – ${m.jobNumber} ${m.proforma.number}`, by.display_name, 0), created_by: by.id });
    return r.error ? r : { words: `${r.words} ${AUTO_WORDS}.` };
  }
  const admin = createAdminClient();
  const { error } = await admin.from("job_events").insert({ job_id: jobId, event_type: EARLY_TAX_ASKED, note: reason, created_by: by.id });
  if (error) {
    await logAppError("tax-invoice-due: ask", error, { jobId, staffId: by.id });
    return { error: "Couldn't send the request – nothing was changed. Try again." };
  }
  await notifyRoles(["owner"], { type: "early_tax_invoice", title: `Tax invoice before the cheque clears? · ${m.jobNumber}`, body: `${by.display_name} asks: ${m.proforma.number} ${money(m.proforma.total)}, ${reason}. ${m.due.words}.`, jobId, href: `/approvals#early_tax:${jobId}` });
  return { words: "Sent to the owner for approval. You are told when he decides." };
}

/** The owner decides an early tax invoice. */
export async function decideEarlyTax(jobId: string, approve: boolean, note: string, by: Who, settings: Settings): Promise<{ ok?: boolean; error?: string; message?: string }> {
  if (by.role_id !== "owner") return { error: "Only the owner decides this." };
  const m = (await missingTaxInvoices({ jobIds: [jobId] }))[0];
  if (!m?.asked) return { error: "Already decided, or the tax invoice already exists." };
  const admin = createAdminClient();
  if (approve) {
    const r = await issueNow(m, by, settings, `Issued before the cheque cleared, approved by ${by.display_name}: ${m.asked.note}${note ? ` · ${note}` : ""}`);
    if (r.error) return { error: r.error };
    await admin.from("job_events").insert({ job_id: jobId, event_type: EARLY_TAX_DECIDED, to_status: "approved", note: `Approved by ${by.display_name}${note ? `: ${note}` : ""}`, created_by: by.id });
    if (m.asked.byId) await notifyStaff([m.asked.byId], { type: "early_tax_invoice", title: `Tax invoice issued · ${m.jobNumber}`, body: r.words ?? "", jobId, href: `/jobs/${jobId}/invoice` });
    return { ok: true, message: r.words };
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: EARLY_TAX_DECIDED, to_status: "refused", note: `Refused by ${by.display_name}: ${note}`, created_by: by.id });
  if (m.asked.byId) await notifyStaff([m.asked.byId], { type: "early_tax_invoice", title: `Tax invoice NOT issued early · ${m.jobNumber}`, body: `${by.display_name}: ${note}. It is issued when the cheque clears.`, jobId, href: `/jobs/${jobId}/invoice` });
  return { ok: true, message: "Refused: the tax invoice follows when the cheque clears." };
}

/**
 * The cheque setting (Settings: "For cheque payments, issue the tax invoice …"), called after a payment is recorded
 * on a proforma ("received") and when the proforma is made at completion ("completed"). "cleared" (the default) does
 * nothing here: the tax invoice follows the clearing as before.
 */
export async function chequeTaxInvoiceNow(jobId: string, moment: "received" | "completed", byId: string | null, settings: Settings): Promise<void> {
  const when: ChequeTaxWhen = chequeTaxWhenOf(settings[CHEQUE_TAX_SETTING as keyof Settings]);
  if (when === "cleared") return;
  if (when === "received" && moment !== "received") return;
  const m = (await missingTaxInvoices({ jobIds: [jobId] }))[0];
  if (!m) return;
  const chequeThere = m.pendingReceipts.some((p) => p.method === "cheque");
  const chequeExpected = m.proforma.expectedMethod === "cheque";
  let reason: string | null = null;
  if (when === "received" && m.state === "covered" && chequeThere) reason = `Cheque received: tax invoice issued when the cheque was received (Settings) – ${waitingWords(m)}`;
  if (when === "completed" && (chequeThere || chequeExpected)) reason = `Job completed: tax invoice issued at completion for a cheque payment (Settings)${chequeThere ? ` – ${waitingWords(m)}` : ""}`;
  if (!reason) return;
  const { convertProformaIfPaid } = await import("./invoice-flow");
  try {
    const tax = await convertProformaIfPaid(jobId, byId, settings, { force: { reason } });
    if (tax) await createAdminClient().from("job_events").insert({ job_id: jobId, event_type: "tax_invoice_early", note: `${tax.number} issued from ${m.proforma.number}: ${reason}`, created_by: byId });
  } catch (e) {
    await logAppError("tax-invoice-due: cheque setting", e, { jobId, staffId: byId });
  }
}

/** Hourly: a completed job with no tax invoice after 10 days tells accounts and the owner once ("TAX INVOICE DUE BY …"). */
export async function taxInvoiceDueHourly(): Promise<number> {
  const list = (await missingTaxInvoices()).filter((m) => m.due.warn);
  if (!list.length) return 0;
  const admin = createAdminClient();
  const { data: told } = await admin.from("notifications").select("job_id").eq("type", "tax_invoice_due").in("job_id", list.map((m) => m.jobId));
  const done = new Set(((told ?? []) as { job_id: string | null }[]).map((t) => t.job_id));
  let n = 0;
  for (const m of list) {
    if (done.has(m.jobId)) continue;
    await notifyRoles(["owner", "accounts"], { type: "tax_invoice_due", title: `${m.due.words} · ${m.jobNumber}`, body: `${m.plate}${m.customer ? ` · ${m.customer}` : ""}: completed ${m.due.daysSince} days ago, ${m.proforma.number} ${money(m.proforma.total)} is still a proforma${m.state === "covered" ? ` (${waitingWords(m)} waiting to clear)` : m.state === "paid" ? " (paid in full)" : ""}. Issue tax invoice now on the invoice page.`, jobId: m.jobId, href: `/jobs/${m.jobId}/invoice#tax-due` });
    n++;
  }
  return n;
}

/** What the tax-invoice-due card shows, or null when it has nothing to say yet (not warned, nothing to issue). */
export function taxDueViewOf(m: MissingTax | undefined | null) {
  if (!m) return null;
  if (!(m.due.warn || m.state === "covered" || m.state === "paid")) return null;
  return { jobNumber: m.jobNumber, proformaNumber: m.proforma.number, words: m.due.words, daysSince: m.due.daysSince, warn: m.due.warn, late: m.due.late, state: m.state, waiting: waitingWords(m).replace(/^./, (c) => c.toUpperCase()), dueAmount: money(Math.max(0, m.balance - m.pending)), asked: m.asked ? { by: m.asked.by, at: m.asked.at } : null };
}
