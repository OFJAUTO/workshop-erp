import "server-only";
import { chargeNet, chargeProblem, chargeTitle, chargeTotals, type ChargeInput, type ChargeLineRow } from "./charge-rules";
import { chargeCostsOnce, chargeItems, rootLineOf, recoveryAlready, recoveryAlreadyWords, recoveryWords, type ChargeCostRow, type ChargeCosts, type ChargeItem, type ChargeQuoteVersion, type ChargeTrip } from "./charge-items";
import { LINE_SELECT, toLine } from "./quote-data";
import { INVOICE_SELECT, PAYMENT_SELECT, invoiceBalance, nextDocumentNumber, toInvoice, toPayment, type InvoiceRow } from "./invoice-data";
import { newToken } from "./media";
import { jobAdvisorIds, notifyRoles, notifyStaff } from "./notifications";
import { quoteTargetFor } from "./quote-versions";
import { refreshQuoteTotals } from "./quote-data";
import { markupFromSell } from "./quotes";
import { flagBelowCost } from "./below-cost";
import { BELOW_COST_SELECT, belowCostReady, schemaReady } from "./schema-ready";
import type { Settings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { pageAll, pageAllIn } from "./page-all";
import { capsText } from "./text-case";
import { formatPlate } from "./types";
import { tryEnqueueZoho } from "./zoho-sync";

/** Migration 20261202150000_charges: charge lines (early charges on a job, pending charges with no gate-in). */
export const chargesReady = () => schemaReady("charge_lines", "id, job_id, entry_id, kind, cost_aed, charge_aed, agreed_at, quotation_line_id, invoice_id");

const LINE_COLS = "id, job_id, entry_id, kind, description, provider, recovery_type, trips, litres, cost_aed, supplier_trn, bill_path, charge_aed, free, free_status, service_date, agreed_at, quotation_line_id, invoice_id, created_at, created_by, is_active";
type Actor = { id: string; display_name: string; role_id: string };
const r2 = (n: number) => Math.round(n * 100) / 100;
const vatOf = (settings: Settings) => Number((settings as unknown as Record<string, unknown>).vat_percent) || 5;
const money = (n: number) => `AED ${r2(n).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

const toRow = (r: Record<string, unknown>): ChargeLineRow => ({
  ...(r as unknown as ChargeLineRow),
  cost_aed: Number(r.cost_aed) || 0,
  charge_aed: Number(r.charge_aed) || 0,
  litres: r.litres === null || r.litres === undefined ? null : Number(r.litres),
  trips: r.trips === null || r.trips === undefined ? null : Number(r.trips),
});

/**
 * Migration 20261203150000_quote_charge_costs (3 November 2026, section 8): the real cost of a charge typed on a
 * quotation (charge_lines with origin 'quotation'). Before it the quotation's charges are listed and their bills attach,
 * but the cost box waits.
 */
export const quoteChargeCostsReady = () => schemaReady("charge_lines", "origin");

/** The charge lines of a job or of a pending-charge entry (active ones; never the cost rows of quotation charges). */
export async function loadCharges(where: { jobId?: string; entryId?: string }): Promise<ChargeLineRow[]> {
  if (!(await chargesReady())) return [];
  let q = createAdminClient().from("charge_lines").select(LINE_COLS).eq("is_active", true).order("created_at");
  if (await quoteChargeCostsReady()) q = q.eq("origin", "charge");
  if (where.jobId) q = q.eq("job_id", where.jobId);
  if (where.entryId) q = q.eq("entry_id", where.entryId);
  const { data } = await q;
  return ((data ?? []) as Record<string, unknown>[]).map(toRow);
}

/** The recovery type's words from Settings ("Full down"), for the line's title. */
export function recoveryLabel(settings: Settings, key: string | null | undefined): string | null {
  const t = ((settings.recovery_types ?? []) as { key: string; label: string }[]).find((x) => x.key === key);
  return t?.label ?? null;
}

/** One line ready to save: its title in capitals, the trips folded into the recovery words ("full down, two ways"). */
function lineRecord(c: ChargeInput, settings: Settings) {
  const label = c.kind === "recovery" ? [recoveryLabel(settings, c.recovery_type) ?? c.recovery_type ?? "", c.trips && c.trips > 1 ? (c.trips === 2 ? "two ways" : `${c.trips} trips`) : c.trips === 1 ? "one way" : ""].filter(Boolean).join(", ").toLowerCase() : null;
  return {
    kind: c.kind,
    description: capsText(chargeTitle(c, label)),
    provider: c.provider?.trim() || null,
    recovery_type: c.kind === "recovery" ? c.recovery_type ?? null : null,
    trips: c.kind === "recovery" ? Math.max(1, Math.round(Number(c.trips) || 1)) : null,
    litres: c.kind === "fuel" && Number(c.litres) > 0 ? r2(Number(c.litres)) : null,
    cost_aed: r2(Number(c.cost_aed) || 0),
    supplier_trn: c.supplier_trn?.trim() || null,
    charge_aed: c.free ? 0 : r2(Number(c.charge_aed) || 0),
    free: !!c.free,
    service_date: c.service_date || null,
  };
}

/**
 * Charges added on a job (any time, by the owner, an advisor or accounts) or on a pending-charge entry. A free one
 * follows the complimentary rule (the owner approves it, his own are approved). A cost above the charge tells the
 * owner. On a job whose check-in is already approved the lines go into the quotation for approval, never silently
 * onto the invoice; before the approval they are listed on the vehicle check-in.
 */
export async function addCharges(home: { jobId?: string; entryId?: string }, inputs: ChargeInput[], staff: Actor, settings: Settings): Promise<{ ids?: string[]; error?: string; quotation?: string | null }> {
  if (!(await chargesReady())) return { error: "Charges need the database update first (waiting for apply)." };
  if (!inputs.length) return { error: "Add at least one charge." };
  for (const c of inputs) {
    const p = chargeProblem(c);
    if (p) return { error: p };
  }
  const admin = createAdminClient();
  type JobLite = { id: string; job_number: string; first_approval_at: string | null; is_open: boolean };
  let job: JobLite | null = null;
  if (home.jobId) {
    const { data } = await admin.from("jobs").select("id, job_number, first_approval_at, is_open").eq("id", home.jobId).maybeSingle();
    if (!data) return { error: "Job not found." };
    job = data as unknown as JobLite;
  }
  // 8.2 (3 November 2026): a recovery while one is already on the car - on a quotation or on the job card - asks once.
  // The screen asks with the words and a tick; this is the same check on the server (someone may have added one meanwhile).
  let alreadyNote = "";
  if (job && inputs.some((c) => c.kind === "recovery")) {
    const already = recoveryAlready((await loadJobChargeItems(job.id)).items);
    if (already.length && inputs.some((c) => c.kind === "recovery" && !c.different_trip)) return { error: `${recoveryAlreadyWords(already)} Tick "Yes, it is a different trip" to add it, or leave it out.` };
    if (already.length) alreadyNote = ` (a different trip from ${already.map(recoveryWords).join("; ")}, confirmed by ${staff.display_name})`;
  }
  const owner = staff.role_id === "owner";
  const rows = inputs.map((c) => ({ ...lineRecord(c, settings), job_id: home.jobId ?? null, entry_id: home.entryId ?? null, free_status: c.free ? (owner ? "approved" : "pending_owner") : null, created_by: staff.id, updated_by: staff.id }));
  const { data: made, error } = await admin.from("charge_lines").insert(rows).select(LINE_COLS);
  if (error || !made) return { error: "Couldn't save the charges. Try again." };
  const lines = (made as Record<string, unknown>[]).map(toRow);
  const where = job ? job.job_number : "a pending charge";
  if (job) await admin.from("job_events").insert({ job_id: job.id, event_type: "charge_added", note: `${lines.map((l) => `${l.description}: cost ${money(l.cost_aed)}, charge ${l.free ? "free" : money(l.charge_aed)}${l.provider ? ` (${l.provider})` : ""}`).join("; ")} added by ${staff.display_name}${alreadyNote}`, created_by: staff.id });
  const above = lines.filter((l) => !l.free && l.cost_aed > l.charge_aed + 0.005);
  if (above.length && !owner) await notifyRoles(["owner"], { type: "owner_approval_needed", title: `Charge below its cost · ${where}`, body: above.map((l) => `${l.description}: cost ${money(l.cost_aed)}, charged ${money(l.charge_aed)}`).join("; "), jobId: job?.id ?? null, href: job ? `/jobs/${job.id}#charges` : "/pending-charges" });
  const free = lines.filter((l) => l.free && l.free_status === "pending_owner");
  if (free.length) await notifyRoles(["owner"], { type: "owner_approval_needed", title: `Free charge to approve · ${where}`, body: `${free.map((l) => `${l.description} (cost ${money(l.cost_aed)})`).join("; ")} – ${staff.display_name} asks for it free of charge.`, jobId: job?.id ?? null, href: job ? `/jobs/${job.id}#charges` : "/pending-charges" });
  let quotation: string | null = null;
  if (job?.first_approval_at) quotation = await pushIntoQuotation(job.id, lines, staff);
  return { ids: lines.map((l) => l.id), quotation };
}

/** After the check-in approval a charge goes into the quotation (the open one, or the next version through the usual rule). */
export async function pushIntoQuotation(jobId: string, lines: ChargeLineRow[], staff: Actor): Promise<string | null> {
  const target = await quoteTargetFor(jobId, staff.id, `${staff.display_name} added ${lines.map((l) => l.description).join(", ")}`);
  if (!target) return null;
  return (await insertChargeLines(target.id, lines, staff)).label;
}

/** The quotation line an early charge goes in as (ONE rule): what it costs us and what the customer pays, exactly. */
export function chargeQuoteLine(l: ChargeLineRow): Record<string, unknown> {
  const recovery = l.kind === "recovery";
  const qty = recovery ? Math.max(1, l.trips ?? 1) : 1;
  const unitCost = r2((Number(l.cost_aed) || 0) / qty);
  const unitSell = r2(chargeNet(l) / qty);
  // THE price rule prices an Other line with a cost as cost + markup (quotes.ts), so the typed charge goes in as the
  // markup that lands exactly on it - never the cost alone (2 November 2026: a fuel charge sold at its cost). An
  // Other line with no cost is a plain price.
  const priced = recovery ? { unit_cost: unitCost, unit_price: unitSell } : unitCost > 0 ? { unit_cost: unitCost, unit_price: unitSell, markup_mode: "percent", ...markupFromSell({ unit_cost: unitCost, markup_percent: null, markup_mode: "percent" }, unitSell) } : { unit_cost: null, unit_price: unitSell };
  return { line_type: recovery ? "recovery" : "other", title: l.description, source_type: "manual", quantity: qty, ...priced, ...(recovery ? { recovery_type: l.recovery_type, recovery_trips: qty, recovery_paid_by: "customer" } : {}), ...(l.free ? { price_display: "complimentary" } : {}) };
}

/**
 * Early charges added after the check-in approval that are still on no quotation: the quotation was approved, so they
 * wait for the owner to allow a revised version (ChargesCard: "Waiting for the revised quotation").
 */
export async function chargesWaitingForRevision(jobId: string): Promise<ChargeLineRow[]> {
  if (!(await chargesReady())) return [];
  const { data: job } = await createAdminClient().from("jobs").select("first_approval_at").eq("id", jobId).maybeSingle();
  if (!job?.first_approval_at) return [];
  return (await loadCharges({ jobId })).filter((l) => !l.agreed_at && !l.quotation_line_id && !l.invoice_id && l.free_status !== "refused");
}

/** The waiting early charges join a new version of the quotation (the owner allowed the revision): one line each. */
export async function pushWaitingCharges(jobId: string, quotationId: string, staff: { id: string; display_name: string }): Promise<string[]> {
  const waiting = await chargesWaitingForRevision(jobId);
  if (!waiting.length) return [];
  // The new version judges below cost itself (the owner's decision, or its own notice): no second notice from here.
  return (await insertChargeLines(quotationId, waiting, { ...staff, role_id: "" }, { quiet: true })).made;
}

async function insertChargeLines(targetId: string, lines: ChargeLineRow[], staff: Actor, opts: { quiet?: boolean } = {}): Promise<{ label: string | null; made: string[] }> {
  const admin = createAdminClient();
  const target = { id: targetId };
  const { data: last } = await admin.from("quotation_lines").select("position").eq("quotation_id", target.id).order("position", { ascending: false }).limit(1).maybeSingle();
  let pos = (Number(last?.position) || 0) + 1;
  const made: string[] = [];
  for (const l of lines) {
    const { data: ql } = await admin
      .from("quotation_lines")
      .insert({ quotation_id: target.id, position: pos++, ...chargeQuoteLine(l), created_by: staff.id, updated_by: staff.id })
      .select("id")
      .single();
    if (ql) {
      made.push(ql.id);
      await admin.from("charge_lines").update({ quotation_line_id: ql.id, updated_by: staff.id }).eq("id", l.id);
    }
  }
  const { getSettings } = await import("./settings");
  await refreshQuoteTotals(target.id, await getSettings(), staff.id);
  // A charge that costs more than it is charged at is a line below cost: written down, it waits for the owner.
  if (!opts.quiet) await flagBelowCost(target.id, made, staff.id, "an early charge costs more than its price");
  const { data: q } = await admin.from("quotations").select("number, version").eq("id", target.id).maybeSingle();
  return { label: q ? `${q.number} v${q.version}` : null, made };
}

/** The charges listed on the vehicle check-in (added before the approval): not agreed yet, not on a quotation, not invoiced. */
export async function checkInCharges(jobId: string): Promise<ChargeLineRow[]> {
  return (await loadCharges({ jobId })).filter((l) => !l.agreed_at && !l.quotation_line_id && !l.invoice_id && l.free_status !== "pending_owner" && l.free_status !== "refused");
}

/** The customer approved the check-in: the charges it listed are agreed (kept in the approval's snapshot). */
export async function agreeChargesOnApproval(jobId: string, approvalRequestId: string, settings: Settings): Promise<number> {
  if (!(await chargesReady())) return 0;
  const listed = await checkInCharges(jobId);
  if (!listed.length) return 0;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("charge_lines").update({ agreed_at: now, approval_request_id: approvalRequestId }).in("id", listed.map((l) => l.id));
  const vat = vatOf(settings);
  await admin.from("approval_requests").update({ charges_snapshot: listed.map((l) => ({ id: l.id, description: l.description, charge_aed: chargeNet(l), free: l.free, vat_percent: vat })) }).eq("id", approvalRequestId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "charges_agreed", note: `The customer agreed ${listed.length} charge${listed.length === 1 ? "" : "s"} on the vehicle check-in: ${listed.map((l) => `${l.description} ${l.free ? "free" : money(chargeNet(l))} + VAT`).join("; ")}` });
  return listed.length;
}

/** THE rule: agreed on the check-in, not a quotation line, not on an invoice yet. */
const chargeToInvoiceNow = (l: ChargeLineRow) => !!l.agreed_at && !l.quotation_line_id && !l.invoice_id;

/** The agreed charges still to invoice (agreed on the check-in, not on a quotation): every one exactly once. */
export async function chargesToInvoice(jobId: string): Promise<ChargeLineRow[]> {
  return (await loadCharges({ jobId })).filter(chargeToInvoiceNow);
}

/** The same for many jobs at once (3 November 2026, the money list), in the order the lines were made. */
export async function chargesToInvoiceMany(jobIds: string[]): Promise<Map<string, ChargeLineRow[]>> {
  const out = new Map<string, ChargeLineRow[]>();
  if (!jobIds.length || !(await chargesReady())) return out;
  const admin = createAdminClient();
  const rows = await pageAllIn<Record<string, unknown>>(jobIds, (ids, a, b) => admin.from("charge_lines").select(LINE_COLS).in("job_id", ids).eq("is_active", true).order("created_at").order("id").range(a, b)).catch(() => [] as Record<string, unknown>[]);
  for (const l of rows.map(toRow).filter(chargeToInvoiceNow)) {
    if (!l.job_id) continue;
    out.set(l.job_id, [...(out.get(l.job_id) ?? []), l]);
  }
  return out;
}

/** Once on an invoice a charge is locked (corrections by credit note only). */
export async function markChargesInvoiced(ids: string[], invoiceId: string): Promise<void> {
  if (!ids.length) return;
  await createAdminClient().from("charge_lines").update({ invoice_id: invoiceId }).in("id", ids).is("invoice_id", null);
}

/* ---------------------------------------------------------------------------
   THE CAR'S CHARGES, WHEREVER THEY WERE TYPED (3 November 2026, section 8).
   --------------------------------------------------------------------------- */

/** A job's charges: THE list (charge-items.ts), its recovery trips, and THE cost rule's figures. */
export type JobCharges = { items: ChargeItem[]; trips: ChargeTrip[]; costs: ChargeCosts; costReady: boolean; /** Every quotation line (any version) of a listed charge: an invoice or hidden line carrying one is counted by the rule, never again. */ lineIds: Set<string> };
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
const COST_COLS = "id, job_id, quotation_line_id, cost_aed, provider, supplier_trn, updated_by";

/**
 * Every charge of these jobs, each once: the job-card charges, the charges on their quotations (every version read, so a
 * revision is traced back to its first line), the costs typed from the bills and the recovery trips. One batch of reads
 * for the job card, the profit and the 8.2 check alike.
 *
 * Review fixes (3 November 2026): the trips carry their company (a trip replaces only the charge of whoever did it),
 * the job's open/closed state decides whether a trip never recorded is still waited for, the owner's below-cost
 * approvals on the charge lines and the owner's own entries are read so the screen says only what really happened.
 */
export async function loadChargeItemsMany(jobIds: string[]): Promise<Map<string, JobCharges>> {
  const ids = Array.from(new Set(jobIds.filter(Boolean)));
  const out = new Map<string, JobCharges>();
  for (const id of ids) out.set(id, { items: [], trips: [], costs: chargeCostsOnce([], []), costReady: false, lineIds: new Set<string>() });
  if (!ids.length) return out;
  const ready = await chargesReady();
  const costReady = ready && (await quoteChargeCostsReady());
  const admin = createAdminClient();
  // A read that fails counts as nothing (the page still opens; the server log says why), as the invoice draft does.
  const safe = (p: Promise<Record<string, unknown>[]>) => p.catch((e) => { console.error("charges: a read failed", e); return [] as Record<string, unknown>[]; });
  const [rowsRaw, costRaw, versionRaw, tripRaw, jobRaw, ownerRaw] = await Promise.all([
    ready ? safe(pageAllIn<Record<string, unknown>>(ids, (p, a, b) => (costReady ? admin.from("charge_lines").select(LINE_COLS).in("job_id", p).eq("is_active", true).eq("origin", "charge") : admin.from("charge_lines").select(LINE_COLS).in("job_id", p).eq("is_active", true)).order("created_at").order("id").range(a, b) as unknown as Page<Record<string, unknown>>)) : Promise.resolve([] as Record<string, unknown>[]),
    costReady ? safe(pageAllIn<Record<string, unknown>>(ids, (p, a, b) => admin.from("charge_lines").select(COST_COLS).in("job_id", p).eq("is_active", true).eq("origin", "quotation").order("id").range(a, b) as unknown as Page<Record<string, unknown>>)) : Promise.resolve([] as Record<string, unknown>[]),
    safe(pageAllIn<Record<string, unknown>>(ids, (p, a, b) => admin.from("quotations").select("id, job_id, number, version, status").in("job_id", p).eq("kind", "quotation").eq("is_active", true).is("deleted_at", null).neq("status", "cancelled").order("id").range(a, b) as unknown as Page<Record<string, unknown>>)),
    safe(pageAllIn<Record<string, unknown>>(ids, (p, a, b) => admin.from("recovery_trips").select("id, job_id, price_aed, company").in("job_id", p).eq("is_active", true).order("id").range(a, b) as unknown as Page<Record<string, unknown>>)),
    safe(pageAllIn<Record<string, unknown>>(ids, (p, a, b) => admin.from("jobs").select("id, is_open").in("id", p).order("id").range(a, b) as unknown as Page<Record<string, unknown>>)),
    safe(pageAll<Record<string, unknown>>((a, b) => admin.from("staff").select("id").eq("role_id", "owner").order("id").range(a, b) as unknown as Page<Record<string, unknown>>)),
  ]);
  const versions = versionRaw.map((v) => ({ id: String(v.id), job_id: String(v.job_id), number: String(v.number), version: Number(v.version) || 1, status: String(v.status) }));
  const jobOfQuote = new Map(versions.map((v) => [v.id, v.job_id]));
  const openOf = new Map(jobRaw.map((j) => [String(j.id), j.is_open !== false]));
  const owners = ownerRaw.map((o) => String(o.id));
  const ownerSet = new Set(owners);
  const lineRaw = versions.length ? await safe(pageAllIn<Record<string, unknown>>(versions.map((v) => v.id), (p, a, b) => admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", p).in("line_type", ["recovery", "other"]).order("id").range(a, b) as unknown as Page<Record<string, unknown>>)) : [];
  // The owner's below-cost approvals on these lines (2 November 2026), once the columns exist.
  const belowRaw = lineRaw.length && (await belowCostReady()) ? await safe(pageAllIn<Record<string, unknown>>(lineRaw.map((l) => String(l.id)), (p, a, b) => admin.from("quotation_lines").select(BELOW_COST_SELECT).in("id", p).not("below_cost_at", "is", null).order("id").range(a, b) as unknown as Page<Record<string, unknown>>)) : [];
  const belowOf = new Map(belowRaw.map((r) => [String(r.id), r]));
  const lines = lineRaw.map(toLine).map((l) => {
    const b = belowOf.get(l.id);
    return b ? { ...l, below_cost_reason: (b.below_cost_reason as string | null) ?? null, below_cost_at: (b.below_cost_at as string | null) ?? null, below_cost_sell_aed: b.below_cost_sell_aed === null || b.below_cost_sell_aed === undefined ? null : Number(b.below_cost_sell_aed), below_cost_cost_aed: b.below_cost_cost_aed === null || b.below_cost_cost_aed === undefined ? null : Number(b.below_cost_cost_aed) } : l;
  });
  for (const id of ids) {
    const rows = rowsRaw.filter((r) => r.job_id === id).map(toRow);
    const costRows: ChargeCostRow[] = costRaw.filter((r) => r.job_id === id).map((r) => ({ id: String(r.id), quotation_line_id: String(r.quotation_line_id), cost_aed: Number(r.cost_aed) || 0, provider: (r.provider as string | null) ?? null, supplier_trn: (r.supplier_trn as string | null) ?? null, by_owner: ownerSet.has(String(r.updated_by ?? "")) }));
    const vs: ChargeQuoteVersion[] = versions.filter((v) => v.job_id === id).map(({ id: vid, number, version, status }) => ({ id: vid, number, version, status }));
    const ls = lines.filter((l) => jobOfQuote.get(l.quotation_id) === id);
    const trips: ChargeTrip[] = tripRaw.filter((t) => t.job_id === id).map((t) => ({ id: String(t.id), price_aed: t.price_aed === null || t.price_aed === undefined ? null : Number(t.price_aed), company: (t.company as string | null) ?? null }));
    const items = chargeItems({ rows, costRows, versions: vs, lines: ls, owners });
    const parentOf = new Map(ls.map((l) => [l.id, l.revised_from_line_id ?? null]));
    const roots = new Set(items.map((i) => i.rootLineId).filter((x): x is string => !!x));
    const lineIds = new Set(ls.filter((l) => roots.has(rootLineOf(l.id, parentOf))).map((l) => l.id));
    out.set(id, { items, trips, costs: chargeCostsOnce(items, trips, { open: openOf.get(id) ?? true }), costReady, lineIds });
  }
  return out;
}

/** One job's charges (the job card, the 8.2 check). */
export async function loadJobChargeItems(jobId: string): Promise<JobCharges> {
  return (await loadChargeItemsMany([jobId])).get(jobId) ?? { items: [], trips: [], costs: chargeCostsOnce([], []), costReady: false, lineIds: new Set<string>() };
}

/** 8.2 from the quotation side: the recoveries already on the car, except on the quotation `exceptNumber` (its own editor). */
export async function recoveryElsewhere(jobId: string | null | undefined, exceptNumber: string | null): Promise<string[]> {
  if (!jobId) return [];
  return recoveryAlready((await loadJobChargeItems(jobId)).items, { exceptNumber }).map(recoveryWords);
}

const MAY_COST = ["owner", "service_advisor", "accounts"];

/**
 * The REAL cost of a charge typed on a quotation (from the supplier's bill) and its supplier, typed on the job card by the
 * owner, an advisor or accounts. Kept on the charge side (the quotation line is locked and keeps its quoted estimate): one
 * row per charge, keyed to the line's first version, so it follows every revision. An empty cost goes back to the estimate.
 * A recovery on a car with recovery trips is costed from the trips - its bill is attached for the paper only.
 */
export async function saveQuoteChargeCost(jobId: string, lineId: string, input: { cost: string; provider: string; trn: string }, staff: Actor): Promise<{ error?: string; message?: string }> {
  if (!MAY_COST.includes(staff.role_id)) return { error: "Only the owner, an advisor or accounts type the cost of a charge." };
  if (!(await chargesReady()) || !(await quoteChargeCostsReady())) return { error: "Typing the cost of a quotation's charge needs the database update first (waiting for apply). The bill can be attached already." };
  const { items, costs } = await loadJobChargeItems(jobId);
  const item = items.find((i) => i.source === "quotation" && (i.rootLineId === lineId || i.id === lineId));
  if (!item || !item.rootLineId) return { error: "That charge is no longer on a quotation of this car. Refresh the page." };
  // Only a recovery whose own trips are on the Recovery page (our trucks, or that same company) is costed from them; an
  // outside company's tow with no trip of its own keeps the cost from its bill (review fix, 3 November 2026).
  if (item.kind === "recovery" && costs.tripKeys.includes(item.key)) return { error: "This recovery is costed from its trips (the drivers' and companies' prices on the Recovery page). Attach the bill for the paper only." };
  const admin = createAdminClient();
  // Money as the screens print it: "1,250.00" is thousands, "2,5" is 2.5 (the NumericInput rule).
  const typed = String(input.cost ?? "").trim();
  const raw = /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(typed) ? typed.replace(/,/g, "") : typed.replace(",", ".");
  const provider = String(input.provider ?? "").trim().slice(0, 200) || null;
  const trn = String(input.trn ?? "").replace(/\s+/g, "").slice(0, 30) || null;
  const label = `${item.description || "Charge"} (${item.where?.number ?? "quotation"})`;
  if (!raw) {
    if (!item.costRowId) return { error: "Type the cost from the supplier's bill (AED, before VAT)." };
    await admin.from("charge_lines").update({ is_active: false, updated_by: staff.id }).eq("id", item.costRowId).eq("origin", "quotation");
    await admin.from("job_events").insert({ job_id: jobId, event_type: "charge_cost", note: `${label}: the typed cost was taken off by ${staff.display_name} – the quoted estimate ${money(item.quotedCost ?? 0)} counts again`, created_by: staff.id });
    return { message: `Cost taken off – the quoted estimate ${money(item.quotedCost ?? 0)} counts again.` };
  }
  const cost = Number(raw);
  if (!Number.isFinite(cost) || cost < 0) return { error: "The cost must be a number (0 or more), before VAT." };
  if (cost > 10_000_000) return { error: "That cost is too large. Check the figure." };
  const fields = { cost_aed: r2(cost), provider, supplier_trn: trn, charge_aed: r2(item.charge), free: item.free || item.hidden, updated_by: staff.id };
  let saved = false;
  if (item.costRowId) saved = !(await admin.from("charge_lines").update(fields).eq("id", item.costRowId).eq("origin", "quotation")).error;
  else {
    const { error } = await admin.from("charge_lines").insert({ ...fields, job_id: jobId, origin: "quotation", quotation_line_id: item.rootLineId, kind: item.kind, description: capsText(item.description || "Charge"), created_by: staff.id });
    saved = !error;
    // Two people saving at once: the one cost row (unique per line) takes the later figure.
    if (error) {
      const { data: had } = await admin.from("charge_lines").select("id").eq("quotation_line_id", item.rootLineId).eq("origin", "quotation").eq("is_active", true).maybeSingle();
      if (had) saved = !(await admin.from("charge_lines").update(fields).eq("id", had.id)).error;
    }
  }
  if (!saved) return { error: "Couldn't save the cost – nothing was changed. Try again." };
  await admin.from("job_events").insert({ job_id: jobId, event_type: "charge_cost", note: `${label}: cost ${money(cost)} from the bill${provider ? ` (${provider})` : ""} typed by ${staff.display_name}${item.quotedCost !== null ? ` – quoted estimate ${money(item.quotedCost)}` : ""}`, created_by: staff.id });
  if (staff.role_id !== "owner" && !item.hidden && !item.free && cost > item.charge + 0.005) {
    const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
    await notifyRoles(["owner"], { type: "owner_approval_needed", title: `Charge below its cost · ${job?.job_number ?? "a car"}`, body: `${label}: cost ${money(cost)} from the bill, charged ${money(item.charge)}.`, jobId, href: `/jobs/${jobId}#charges` });
  }
  return { message: `Cost ${money(cost)} saved ✓ – it counts in the job's profit instead of the quoted estimate.` };
}

/* ---------------------------------------------------------------------------
   PENDING CHARGES: no gate-in, their own proforma until paid.
   --------------------------------------------------------------------------- */

export type ChargeEntry = { id: string; customer_id: string; vehicle_id: string | null; job_id: string | null; service_date: string; note: string | null; proforma_id: string | null; tax_invoice_id: string | null; status: "pending" | "paid" | "cancelled"; cancel_reason: string | null; created_at: string; created_by: string | null };
const ENTRY_COLS = "id, customer_id, vehicle_id, job_id, service_date, note, proforma_id, tax_invoice_id, status, cancel_reason, created_at, created_by";

/**
 * A pending charge: the customer, the car (or none), the job it came from (optional), the service date and its lines.
 * Saving makes its own PROFORMA (never on another job's bill), with the link the advisor sends.
 */
export async function createChargeEntry(input: { customerId: string; vehicleId: string | null; jobId: string | null; serviceDate: string; note: string | null; lines: ChargeInput[] }, staff: Actor, settings: Settings): Promise<{ id?: string; proforma?: InvoiceRow; error?: string }> {
  if (!(await chargesReady())) return { error: "Pending charges need the database update first (waiting for apply)." };
  const admin = createAdminClient();
  for (const c of input.lines) { const p = chargeProblem(c); if (p) return { error: p }; }
  if (!input.lines.length) return { error: "Add at least one charge." };
  const { data: entry, error } = await admin.from("charge_entries").insert({ customer_id: input.customerId, vehicle_id: input.vehicleId, job_id: input.jobId, service_date: input.serviceDate, note: input.note, created_by: staff.id, updated_by: staff.id }).select(ENTRY_COLS).single();
  if (error || !entry) return { error: "Couldn't save the pending charge. Try again." };
  const added = await addCharges({ entryId: entry.id as string }, input.lines.map((l) => ({ ...l, service_date: l.service_date ?? input.serviceDate })), staff, settings);
  if (added.error) return { error: added.error };
  const proforma = await entryProforma(entry.id as string, staff, settings);
  return { id: entry.id as string, proforma: proforma ?? undefined };
}

/** The entry's PROFORMA (made once): its lines with VAT, "This is not a tax invoice", no job's bill touched. */
async function entryProforma(entryId: string, staff: Actor, settings: Settings): Promise<InvoiceRow | null> {
  const admin = createAdminClient();
  const { data: e } = await admin.from("charge_entries").select(ENTRY_COLS).eq("id", entryId).maybeSingle();
  if (!e) return null;
  if (e.proforma_id) {
    const { data: inv } = await admin.from("invoices").select(INVOICE_SELECT).eq("id", e.proforma_id).maybeSingle();
    return inv ? toInvoice(inv as Record<string, unknown>) : null;
  }
  const lines = await loadCharges({ entryId });
  const vat = vatOf(settings);
  const t = chargeTotals(lines, vat);
  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone, email, trn").eq("id", e.customer_id).maybeSingle(),
    e.vehicle_id ? admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", e.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const v = vehicle as unknown as (Parameters<typeof formatPlate>[0] & { variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null }) | null;
  const number = await nextDocumentNumber("proforma", settings);
  const { data: inv, error } = await admin
    .from("invoices")
    .insert({
      number, kind: "proforma", job_id: null, customer_id: e.customer_id, vehicle_id: e.vehicle_id, token: newToken(), labour_mode: "itemised",
      subtotal_aed: t.net, discount_aed: 0, taxable_aed: t.net, vat_aed: t.vat, total_aed: t.total, agreed_total_aed: null, warranty_credit_aed: 0,
      issue_reason: "Pending charges", notes: "This is not a tax invoice. The tax invoice is issued when it is paid.", prepared_by: staff.id, issued_by: staff.id, customer_snapshot: customer ?? null,
      vehicle_snapshot: v ? { title: [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" "), variant: v.variant, plate: formatPlate(v), vin: v.vin } : null,
      created_by: staff.id, updated_by: staff.id,
    })
    .select(INVOICE_SELECT)
    .single();
  if (error || !inv) return null;
  const { error: lineErr } = await admin.from("invoice_lines").insert(lines.map((l, i) => {
    const net = chargeNet(l);
    const lineVat = r2((net * vat) / 100);
    return { invoice_id: inv.id, position: i, section: "services", description: l.description, details: l.provider && l.kind !== "recovery" ? null : null, part_number: null, quantity: 1, unit_price: net, amount_aed: net, vat_aed: lineVat, total_aed: r2(net + lineVat), cost_aed: l.cost_aed, quotation_line_id: null, part_item_id: null, price_display: l.free ? "complimentary" : "normal", created_by: staff.id, updated_by: staff.id };
  }));
  if (lineErr) {
    await admin.from("invoices").update({ is_active: false, status: "cancelled", updated_by: staff.id }).eq("id", inv.id);
    return null;
  }
  await admin.from("charge_entries").update({ proforma_id: inv.id, updated_by: staff.id }).eq("id", entryId);
  await markChargesInvoiced(lines.map((l) => l.id), inv.id as string);
  return toInvoice(inv as Record<string, unknown>);
}

/** The pending-charge entry behind a proforma or tax invoice, if any. */
export async function entryOfInvoice(invoiceId: string): Promise<ChargeEntry | null> {
  if (!(await chargesReady())) return null;
  const { data } = await createAdminClient().from("charge_entries").select(ENTRY_COLS).or(`proforma_id.eq.${invoiceId},tax_invoice_id.eq.${invoiceId}`).maybeSingle();
  return (data as ChargeEntry | null) ?? null;
}

/**
 * Paid in full (or "Issue tax invoice" by accounts, with a reason): the TAX INVOICE is issued from the proforma, own
 * number, the payments moved onto it (the balance 0 when paid), and it joins the Zoho outbox.
 */
export async function convertEntryIfPaid(entryId: string, by: Actor | null, settings: Settings, force?: { reason: string }): Promise<InvoiceRow | null> {
  const admin = createAdminClient();
  const { data: e } = await admin.from("charge_entries").select(ENTRY_COLS).eq("id", entryId).maybeSingle();
  if (!e || !e.proforma_id || e.tax_invoice_id || e.status === "cancelled") return null;
  const { data: proRaw } = await admin.from("invoices").select(INVOICE_SELECT).eq("id", e.proforma_id).maybeSingle();
  if (!proRaw) return null;
  const pro = toInvoice(proRaw as Record<string, unknown>);
  const { data: pays } = await admin.from("payments").select(PAYMENT_SELECT).eq("invoice_id", pro.id).eq("is_active", true);
  const bal = invoiceBalance(pro, ((pays ?? []) as Record<string, unknown>[]).map(toPayment));
  if (bal.balance > 0.005 && !force) return null;
  const number = await nextDocumentNumber("tax_invoice", settings);
  const { data: tax, error } = await admin
    .from("invoices")
    .insert({ number, kind: "tax_invoice", job_id: null, customer_id: pro.customer_id, vehicle_id: pro.vehicle_id, token: newToken(), labour_mode: pro.labour_mode, subtotal_aed: pro.subtotal_aed, discount_aed: pro.discount_aed, taxable_aed: pro.taxable_aed, vat_aed: pro.vat_aed, total_aed: pro.total_aed, agreed_total_aed: pro.agreed_total_aed, warranty_credit_aed: pro.warranty_credit_aed, prepared_by: pro.prepared_by, issued_by: by?.id ?? null, notes: null, customer_snapshot: pro.customer_snapshot, vehicle_snapshot: pro.vehicle_snapshot, converted_from: pro.id, issue_reason: force?.reason ?? "Pending charges paid", created_by: by?.id ?? null, updated_by: by?.id ?? null })
    .select(INVOICE_SELECT)
    .single();
  if (error || !tax) return null;
  const { data: lines } = await admin.from("invoice_lines").select("*").eq("invoice_id", pro.id).eq("is_active", true).order("position");
  if ((lines ?? []).length) await admin.from("invoice_lines").insert(((lines ?? []) as Record<string, unknown>[]).map((l) => { const c = { ...l }; delete c.id; delete c.created_at; delete c.updated_at; return { ...c, invoice_id: tax.id, created_by: by?.id ?? null, updated_by: by?.id ?? null }; }));
  await admin.from("payments").update({ invoice_id: tax.id, updated_by: by?.id ?? null }).eq("invoice_id", pro.id);
  await admin.from("invoices").update({ converted_to: tax.id, updated_by: by?.id ?? null }).eq("id", pro.id);
  await admin.from("charge_entries").update({ tax_invoice_id: tax.id, status: bal.balance <= 0.005 ? "paid" : "pending", updated_by: by?.id ?? null }).eq("id", entryId);
  await admin.from("charge_lines").update({ invoice_id: tax.id }).eq("entry_id", entryId).eq("is_active", true);
  await tryEnqueueZoho("invoice", String(tax.id), null, by?.id ?? null);
  const note = force ? `${number} issued by ${by?.display_name ?? "accounts"} before full payment (${money(bal.balance)} due): ${force.reason}` : `${number} issued: pending charge ${pro.number} paid in full`;
  await admin.from("audit_log").insert({ table_name: "charge_entries", record_id: entryId, action: "UPDATE", new_data: { note }, changed_by: by?.id ?? null }).then(() => null, () => null);
  await notifyRoles(["accounts"], { type: "invoice_issued", title: `Tax invoice ${number} · pending charge`, body: `${note}.`, href: `/pending-charges?open=${entryId}` });
  return toInvoice(tax as unknown as Record<string, unknown>);
}

/** A payment landed on an invoice with no job: when it is a pending charge's proforma, it may now be paid in full. */
export async function afterPendingChargePayment(invoiceId: string, by: Actor | null, settings: Settings): Promise<void> {
  const e = await entryOfInvoice(invoiceId);
  if (e && e.proforma_id === invoiceId) await convertEntryIfPaid(e.id, by, settings);
}

/** Cancelled only with a reason (logged); its proforma is cancelled with it. Never once a tax invoice exists. */
export async function cancelChargeEntry(entryId: string, reason: string, staff: Actor): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: e } = await admin.from("charge_entries").select(ENTRY_COLS).eq("id", entryId).maybeSingle();
  if (!e) return { error: "Not found." };
  if (e.tax_invoice_id) return { error: "A tax invoice was issued: correct it with a credit note instead." };
  const { count } = e.proforma_id ? await admin.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", e.proforma_id).eq("is_active", true).neq("status", "voided") : { count: 0 };
  if ((count ?? 0) > 0) return { error: "Money was already paid on it: refund or move the payment first." };
  await admin.from("charge_entries").update({ status: "cancelled", cancel_reason: reason, cancelled_at: new Date().toISOString(), cancelled_by: staff.id, updated_by: staff.id }).eq("id", entryId);
  if (e.proforma_id) await admin.from("invoices").update({ status: "cancelled", issue_reason: `Pending charge cancelled: ${reason}`, updated_by: staff.id }).eq("id", e.proforma_id);
  await admin.from("charge_lines").update({ is_active: false, updated_by: staff.id }).eq("entry_id", entryId);
  return {};
}

export type EntryView = ChargeEntry & { customer: string; phone: string | null; car: string | null; plate: string | null; jobNumber: string | null; lines: ChargeLineRow[]; total: number; cost: number; paid: number; balance: number; proformaNumber: string | null; proformaToken: string | null; taxNumber: string | null; what: string; provider: string | null };

/** Every pending charge with its figures, newest first (the list, the badge, the reminders, the follow-up notes). */
export async function loadChargeEntries(filter: { customerId?: string; vehicleId?: string; status?: string } = {}): Promise<EntryView[]> {
  if (!(await chargesReady())) return [];
  const admin = createAdminClient();
  let q = admin.from("charge_entries").select(ENTRY_COLS).eq("is_active", true).order("created_at", { ascending: false }).limit(500);
  if (filter.customerId) q = q.eq("customer_id", filter.customerId);
  if (filter.vehicleId) q = q.eq("vehicle_id", filter.vehicleId);
  if (filter.status) q = q.eq("status", filter.status);
  const { data } = await q;
  const entries = (data ?? []) as ChargeEntry[];
  if (!entries.length) return [];
  const ids = entries.map((e) => e.id);
  const invIds = entries.flatMap((e) => [e.proforma_id, e.tax_invoice_id]).filter((x): x is string => !!x);
  const [{ data: lineRows }, { data: custs }, { data: cars }, { data: jobs }, { data: invs }, { data: pays }] = await Promise.all([
    admin.from("charge_lines").select(LINE_COLS).in("entry_id", ids),
    admin.from("customers").select("id, full_name, company_name, phone").in("id", Array.from(new Set(entries.map((e) => e.customer_id)))),
    admin.from("vehicles").select("id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)").in("id", entries.map((e) => e.vehicle_id).filter((x): x is string => !!x)),
    admin.from("jobs").select("id, job_number").in("id", entries.map((e) => e.job_id).filter((x): x is string => !!x)),
    invIds.length ? admin.from("invoices").select("id, number, token, total_aed, kind, status") .in("id", invIds) : Promise.resolve({ data: [] }),
    invIds.length ? admin.from("payments").select("invoice_id, amount_aed, status, method, cheque_status, is_active").in("invoice_id", invIds) : Promise.resolve({ data: [] }),
  ]);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toRow);
  const custOf = new Map((custs ?? []).map((c) => [c.id as string, c]));
  type Car = Parameters<typeof formatPlate>[0] & { id: string; make: { name: string } | null; model: { name: string } | null };
  const carOf = new Map(((cars ?? []) as unknown as Car[]).map((c) => [c.id, c]));
  const jobOf = new Map((jobs ?? []).map((j) => [j.id as string, j.job_number as string]));
  const invOf = new Map(((invs ?? []) as { id: string; number: string; token: string; total_aed: number | string }[]).map((i) => [i.id, i]));
  return entries.map((e) => {
    const mine = lines.filter((l) => l.entry_id === e.id && (l.is_active || e.status === "cancelled"));
    const c = custOf.get(e.customer_id) as { full_name: string; company_name: string | null; phone: string | null } | undefined;
    const car = e.vehicle_id ? carOf.get(e.vehicle_id) : null;
    const live = e.tax_invoice_id ?? e.proforma_id;
    const paid = r2(((pays ?? []) as { invoice_id: string; amount_aed: number | string; status: string; method: string; cheque_status: string | null; is_active: boolean }[]).filter((p) => p.invoice_id === live && p.is_active && p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared")).reduce((a, p) => a + Number(p.amount_aed), 0));
    const total = live ? Number(invOf.get(live)?.total_aed ?? 0) : chargeTotals(mine).total;
    return {
      ...e,
      customer: c?.company_name ?? c?.full_name ?? "Customer",
      phone: c?.phone ?? null,
      car: car ? [car.make?.name, car.model?.name].filter(Boolean).join(" ") : null,
      plate: car ? formatPlate(car) : null,
      jobNumber: e.job_id ? jobOf.get(e.job_id) ?? null : null,
      lines: mine,
      total: r2(total),
      cost: chargeTotals(mine).cost,
      paid,
      balance: r2(Math.max(0, total - paid)),
      proformaNumber: e.proforma_id ? invOf.get(e.proforma_id)?.number ?? null : null,
      proformaToken: e.proforma_id ? invOf.get(e.proforma_id)?.token ?? null : null,
      taxNumber: e.tax_invoice_id ? invOf.get(e.tax_invoice_id)?.number ?? null : null,
      what: mine.map((l) => l.description).join(", "),
      provider: mine.find((l) => l.provider)?.provider ?? null,
    };
  });
}

/** "Pending charge: AED 630.00 (recovery 12 Oct) – collect it" for a customer (and their car). */
export async function pendingChargesFor(customerId: string | null | undefined): Promise<{ total: number; what: string; date: string | null; id: string }[]> {
  if (!customerId) return [];
  const rows = await loadChargeEntries({ customerId, status: "pending" });
  return rows.map((r) => ({ id: r.id, total: r.balance, what: r.lines[0]?.kind ?? "charge", date: r.service_date }));
}

/** Tell the advisors of a job what was added (used by the job card's charge form). */
export async function tellAdvisorsOfCharge(jobId: string, words: string): Promise<void> {
  await notifyStaff(await jobAdvisorIds(jobId), { type: "charge_added", title: words, body: "", jobId, href: `/jobs/${jobId}#charges` });
}
