import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { logAppError } from "./app-errors";
import { getSettings } from "./settings";
import { formatPlate } from "./types";
import { formatDate } from "./format";
import { greetingNameOf } from "./messages";
import { jobAdvisorIds, notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { LINE_SELECT, approvedQuotations, quoteToken, refreshQuoteTotals, toLine } from "./quote-data";
import { isHidden, isUnchosen, lineTotal, type QuoteLine } from "./quotes";
import { BACK_ORDER_AUTO_TYPE, STATUS_WORDS, arrivedMessage, daysOverdue, labourShare, lineMentionsPart, mayDecideBackOrder, mayRequestBackOrder, movedMoney, needsOwner, onOrderWords, splitProblem, type BackOrderStatus, type PayMode } from "./back-order-rules";

/*
 * BACK ORDER - FIT ON A LATER VISIT (13 November 2026, URGENT, J-00317).
 * A part that will not arrive for this visit leaves the job with its LPO; a linked follow-up job ("Continues J-…",
 * status booked = "Waiting for part - car not here") carries the part, the labour for fitting it and the customer's
 * existing approval (a copy of the approved lines, approved already: no second approval). This visit's invoice covers
 * only the work done (invoice-data.ts draftFrom reads the moves); the two jobs together charge exactly what the
 * customer approved. Gate-in opens the follow-up job instead of a new one (bodyshop.ts bookedJobOf).
 */

export type Actor = { id: string; display_name: string; role_id: string };
export type BackOrderRow = {
  id: string; job_id: string; follow_job_id: string | null; part_item_id: string; quotation_id: string | null; part_line_id: string | null; labour_line_id: string | null;
  labour_hours_moved: number; moved_net_aed: number | null; moved_total_aed: number | null; follow_quotation_id: string | null; reason: string; pay_mode: PayMode;
  status: BackOrderStatus; expected_date: string | null; requested_by: string | null; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null;
  deposit_invoice_id: string | null; appointment_id: string | null; arrived_at: string | null; arrived_notified_at: string | null; fitted_at: string | null;
};
const COLS = "id, job_id, follow_job_id, part_item_id, quotation_id, part_line_id, labour_line_id, labour_hours_moved, moved_net_aed, moved_total_aed, follow_quotation_id, reason, pay_mode, status, expected_date, requested_by, requested_at, decided_by, decided_at, decision_note, deposit_invoice_id, appointment_id, arrived_at, arrived_notified_at, fitted_at";
const toRow = (r: Record<string, unknown>): BackOrderRow => ({ ...(r as unknown as BackOrderRow), labour_hours_moved: Number(r.labour_hours_moved) || 0, moved_net_aed: r.moved_net_aed === null ? null : Number(r.moved_net_aed), moved_total_aed: r.moved_total_aed === null ? null : Number(r.moved_total_aed) });
/** A back order that holds its move (this visit's invoice leaves the part out, the follow-up job carries it). */
export const MOVED_STATUSES: BackOrderStatus[] = ["active", "arrived", "fitted"];

export async function backOrdersReady(): Promise<boolean> {
  return schemaReady("back_orders", "id, status, follow_job_id, labour_hours_moved");
}

const dubaiToday = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const SAVE_FAILED = "Couldn't save – nothing was recorded. Try again or tell the owner.";

type PartRow = { id: string; job_id: string; description: string; order_status: string; issue_status: string; expected_date: string | null; delivery_date: string | null; po_id: string | null; is_active: boolean; replaced_part_id: string | null; return_status: string | null; not_needed_at: string | null; disposition: string | null; exchange_status: string | null };
const PART_COLS = "id, job_id, description, order_status, issue_status, expected_date, delivery_date, po_id, is_active, replaced_part_id, return_status, not_needed_at, disposition, exchange_status";

/** Approved lines of a job's approved quotations (the customer's own approval), with their quotation. */
async function approvedLines(jobId: string): Promise<{ lines: QuoteLine[]; quotes: { id: string; number: string; vat_percent: number }[] }> {
  const quotes = await approvedQuotations(jobId);
  if (!quotes.length) return { lines: [], quotes: [] };
  const { data } = await createAdminClient().from("quotation_lines").select(LINE_SELECT).in("quotation_id", quotes.map((q) => q.id)).eq("is_active", true).order("position");
  return { lines: ((data ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isHidden(l) && !isUnchosen(l)), quotes: quotes.map((q) => ({ id: q.id, number: q.number, vat_percent: Number(q.vat_percent) || 5 })) };
}

/** Lines already moved by a live back order of this job. */
async function movedLineIds(jobId: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (!(await backOrdersReady())) return out;
  const { data } = await createAdminClient().from("back_orders").select("part_line_id, status, is_active").eq("job_id", jobId).eq("is_active", true).in("status", ["pending", ...MOVED_STATUSES]);
  for (const r of (data ?? []) as { part_line_id: string | null }[]) if (r.part_line_id) out.add(r.part_line_id);
  return out;
}

/**
 * THE line that charges a part: its own approved line (not left off), else the line of the part it replaces, else an
 * approved part line of the same name whose part is not one being fitted (J-00317: the customer's approved
 * "TRANSMISSION MOUNT" line points at an older price of the part that was then ordered from another supplier).
 */
export function chargingLineOf(p: PartRow, lines: QuoteLine[], liveIds: Set<string>, taken: Set<string>): QuoteLine | null {
  const ok = (l: QuoteLine) => l.line_type === "part" && !l.left_off && !taken.has(l.id);
  const own = lines.find((l) => ok(l) && l.part_item_id === p.id);
  if (own) return own;
  if (p.replaced_part_id) {
    const old = lines.find((l) => ok(l) && l.part_item_id === p.replaced_part_id);
    if (old) return old;
  }
  const name = (s: string) => s.replace(/\([^()]*\)\s*$/, "").trim().toUpperCase();
  return lines.find((l) => ok(l) && name(l.title) === name(p.description) && (!l.part_item_id || l.part_item_id === p.id || !liveIds.has(l.part_item_id))) ?? null;
}

export type Candidate = {
  partId: string; name: string; expected: string | null; orderWords: string; lpo: string | null; supplierPaid: string;
  line: { id: string; quotationId: string; number: string; amount: number } | null;
  /** The approved labour lines (hours) and the one that mentions this part. */
  suggestLabourId: string | null;
};
export type Choices = { ready: boolean; candidates: Candidate[]; labour: { id: string; title: string; hours: number; amount: number; number: string }[]; existing: (BackOrderRow & { partName: string; followNumber: string | null; words: string })[] };

const ORDER_WORDS: Record<string, string> = { none: "not ordered", to_order: "to order", ordered: "ordered", partly_received: "partly received", received: "received, not handed over" };

/** What the Work complete box and the job card offer: the parts not handed to the technician, each with its line. */
export async function backOrderChoices(jobId: string): Promise<Choices> {
  const ready = await backOrdersReady();
  const empty: Choices = { ready, candidates: [], labour: [], existing: [] };
  const admin = createAdminClient();
  const [{ data: partRows }, { lines }, taken, existing] = await Promise.all([
    admin.from("part_items").select(PART_COLS).eq("job_id", jobId).eq("is_active", true),
    approvedLines(jobId),
    movedLineIds(jobId),
    ready ? jobBackOrders(jobId) : Promise.resolve([] as Choices["existing"]),
  ]);
  const parts = (partRows ?? []) as PartRow[];
  const approved = parts.filter((p) => p.order_status !== "none" || p.issue_status !== "none");
  const needed = approved.filter((p) => p.return_status !== "returned" && !(p.not_needed_at && p.disposition !== "fit_approved") && p.exchange_status !== "needed" && p.exchange_status !== "ordered");
  const unhanded = needed.filter((p) => p.issue_status !== "confirmed");
  if (!unhanded.length && !existing.length) return { ...empty, existing };
  const liveIds = new Set(needed.map((p) => p.id));
  const pending = new Set(existing.filter((e) => e.status === "pending").map((e) => e.part_item_id));
  const poIds = Array.from(new Set(unhanded.map((p) => p.po_id).filter((x): x is string => !!x)));
  const { data: pos } = poIds.length ? await admin.from("purchase_orders").select("id, number, status, supplier_paid_at, pay_first_at").in("id", poIds) : { data: [] as { id: string; number: string; status: string; supplier_paid_at: string | null; pay_first_at?: string | null }[] };
  const poOf = new Map(((pos ?? []) as { id: string; number: string; status: string; supplier_paid_at: string | null; pay_first_at?: string | null }[]).map((p) => [p.id, p]));
  const numberOf = new Map((await approvedQuotations(jobId)).map((q) => [q.id, q.number]));
  const labour = lines.filter((l) => l.line_type === "labour" && (l.hours ?? 0) > 0).map((l) => ({ id: l.id, title: l.title, hours: Number(l.hours) || 0, amount: lineTotal(l), number: numberOf.get(l.quotation_id) ?? "" }));
  const used = new Set(taken);
  const candidates: Candidate[] = [];
  for (const p of unhanded) {
    if (pending.has(p.id)) continue;
    const line = chargingLineOf(p, lines, liveIds, used);
    if (line) used.add(line.id);
    const po = p.po_id ? poOf.get(p.po_id) : undefined;
    const suggest = labour.find((l) => lineMentionsPart(l.title, p.description));
    candidates.push({
      partId: p.id,
      name: p.description.toUpperCase(),
      expected: (p.expected_date ?? p.delivery_date)?.slice(0, 10) ?? null,
      orderWords: ORDER_WORDS[p.order_status] ?? p.order_status,
      lpo: po?.number ?? null,
      supplierPaid: !po ? "No LPO yet: nothing paid to the supplier" : po.supplier_paid_at ? `Supplier already paid (${formatDate(po.supplier_paid_at)})` : po.pay_first_at ? "Supplier to be paid in advance (marked pay first)" : "Supplier not paid yet",
      line: line ? { id: line.id, quotationId: line.quotation_id, number: numberOf.get(line.quotation_id) ?? "", amount: lineTotal(line) } : null,
      suggestLabourId: suggest?.id ?? null,
    });
  }
  return { ready, candidates, labour, existing };
}

/** The back orders of a job (as this visit) and of a follow-up job (as the later visit). */
export async function jobBackOrders(jobId: string): Promise<Choices["existing"]> {
  if (!(await backOrdersReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("back_orders").select(COLS).or(`job_id.eq.${jobId},follow_job_id.eq.${jobId}`).eq("is_active", true).order("created_at");
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toRow);
  if (!rows.length) return [];
  const [{ data: parts }, { data: jobs }] = await Promise.all([
    admin.from("part_items").select("id, description").in("id", rows.map((r) => r.part_item_id)),
    admin.from("jobs").select("id, job_number").in("id", rows.map((r) => r.follow_job_id).filter((x): x is string => !!x).concat(rows.map((r) => r.job_id))),
  ]);
  const nameOf = new Map(((parts ?? []) as { id: string; description: string }[]).map((p) => [p.id, p.description.toUpperCase()]));
  const numOf = new Map(((jobs ?? []) as { id: string; job_number: string }[]).map((j) => [j.id, j.job_number]));
  return rows.map((r) => ({ ...r, partName: nameOf.get(r.part_item_id) ?? "PART", followNumber: r.follow_job_id ? numOf.get(r.follow_job_id) ?? null : null, words: STATUS_WORDS[r.status] }));
}

export type BackOrderInput = { partId: string; reason: string; labourLineId: string | null; hoursLater: number; payMode: PayMode };
export type Answer = { ok?: boolean; pending?: boolean; error?: string; words?: string; followJobId?: string };

/** THE entry point: "Back order - fit on a later visit" for one part. */
export async function requestBackOrder(jobId: string, input: BackOrderInput, by: Actor): Promise<Answer> {
  if (!(await backOrdersReady())) return { error: "Back orders need the database update first (waiting for apply)." };
  if (!mayRequestBackOrder(by.role_id)) return { error: "Only the owner, a workshop manager, the bodyshop manager or an advisor can put a part on back order." };
  const reason = input.reason.trim();
  if (reason.length < 5) return { error: "Say why the part is fitted on a later visit (at least 5 characters)." };
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, is_open, status").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is not open." };
  const { data: tax } = await admin.from("invoices").select("id").eq("job_id", jobId).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null).limit(1);
  if ((tax ?? []).length) return { error: "A tax invoice is already out for this visit: a back order now needs a credit note (ask the owner)." };
  const choices = await backOrderChoices(jobId);
  const c = choices.candidates.find((x) => x.partId === input.partId);
  if (!c) return { error: "That part is not waiting for this visit any more (handed over, or already on back order)." };
  if (!c.line) return { error: `${c.name} has no approved line that charges it: revise the quotation first, then put it on back order.` };
  const labour = input.labourLineId ? choices.labour.find((l) => l.id === input.labourLineId) : null;
  if (input.labourLineId && !labour) return { error: "That labour line is not on the approved work." };
  const hours = labour ? Math.round((Number(input.hoursLater) || 0) * 10) / 10 : 0;
  if (labour) {
    const bad = splitProblem(labour.hours, hours);
    if (bad) return { error: bad };
  }
  const { data: inserted, error } = await admin.from("back_orders").insert({
    job_id: jobId, part_item_id: c.partId, quotation_id: c.line.quotationId, part_line_id: c.line.id, labour_line_id: labour?.id ?? null, labour_hours_moved: hours,
    reason, pay_mode: input.payMode, status: "pending", expected_date: c.expected, requested_by: by.id, created_by: by.id, updated_by: by.id,
  }).select("id").single();
  if (error || !inserted) {
    logAppError("back-order.request", error ?? new Error("no row"), { staffId: by.id, jobId });
    return { error: /back_orders_one_per_part/.test(error?.message ?? "") ? "This part is already on back order." : SAVE_FAILED };
  }
  const id = String(inserted.id);
  if (!needsOwner(by.role_id, input.payMode)) return applyBackOrder(id, by, null);
  // An advisor's ask (or "pays when fitted"): approved by itself when the owner ticked back orders in auto-approve.
  if (input.payMode === "now") {
    try {
      const { autoNow } = await import("./auto-approve");
      const { typeAllows, autoLogNote } = await import("./auto-approve-rules");
      const now = await autoNow();
      const figure = Math.round((c.line.amount + (labour ? labourShare({ hours: labour.hours, labour_rate: labour.hours ? labour.amount / labour.hours : 0, discount_percent: 0 }, hours) : 0)) * 100) / 100;
      if (now.active && now.owner && typeAllows(now.cfg, BACK_ORDER_AUTO_TYPE, figure)) {
        await admin.from("job_events").insert({ job_id: jobId, event_type: "auto_approved", note: autoLogNote(`back order – ${c.name}`, by.display_name, 0), created_by: by.id });
        return applyBackOrder(id, { id: now.owner.id, display_name: now.owner.display_name, role_id: "owner" }, "AUTO-APPROVED (OWNER AWAY)");
      }
    } catch (e) {
      logAppError("back-order.auto", e, { jobId });
    }
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "back_order_asked", note: `Back order asked by ${by.display_name}: ${c.name} fitted on a later visit (${reason})${input.payMode === "when_fitted" ? " · customer pays when fitted" : ""}. Waiting for the owner.`, created_by: by.id });
  await notifyRoles(["owner"], { type: "back_order", title: `Back order to approve · ${job.job_number}`, body: `${by.display_name}: ${c.name} fitted on a later visit (${reason}).`, href: "/approvals", jobId });
  return { ok: true, pending: true, words: `${c.name}: sent to the owner for approval. The part keeps blocking until he decides.` };
}

/** The owner's decision (the ONE approval box). */
export async function decideBackOrder(id: string, yes: boolean, note: string, by: Actor): Promise<Answer> {
  if (by.role_id !== "owner") return { error: "Only the owner decides a back order." };
  const admin = createAdminClient();
  const { data } = await admin.from("back_orders").select(COLS).eq("id", id).maybeSingle();
  const bo = data ? toRow(data as Record<string, unknown>) : null;
  if (!bo || bo.status !== "pending") return { error: "This back order is not waiting any more." };
  if (!yes) {
    const { data: done } = await admin.from("back_orders").update({ status: "refused", decided_by: by.id, decided_at: new Date().toISOString(), decision_note: note.trim() || null, updated_by: by.id }).eq("id", id).eq("status", "pending").select("id");
    if (!(done ?? []).length) return { error: "This back order is not waiting any more." };
    await admin.from("job_events").insert({ job_id: bo.job_id, event_type: "back_order_refused", note: `Back order refused by ${by.display_name}${note.trim() ? ` (${note.trim()})` : ""}`, created_by: by.id });
    if (bo.requested_by) await notifyStaff([bo.requested_by], { type: "back_order", title: "Back order refused", body: note.trim() || "The part stays on this visit.", href: `/jobs/${bo.job_id}`, jobId: bo.job_id });
    return { ok: true, words: "Refused: the part stays on this visit." };
  }
  return applyBackOrder(id, by, note.trim() || null);
}

/**
 * Makes it happen: the follow-up job, its approved copy of the moved lines, the part (with its LPO) moved across,
 * this visit's work line trimmed, the calendar entry, the customer's advance (pays now), the history and the bells.
 */
async function applyBackOrder(id: string, by: Actor, note: string | null): Promise<Answer> {
  if (!mayDecideBackOrder(by.role_id)) return { error: "Only the owner or a workshop manager can approve a back order." };
  const admin = createAdminClient();
  const settings = await getSettings();
  const nowIso = new Date().toISOString();
  const { data: claimed } = await admin.from("back_orders").update({ status: "active", decided_by: by.id, decided_at: nowIso, decision_note: note, updated_by: by.id }).eq("id", id).eq("status", "pending").select(COLS);
  const bo = (claimed ?? [])[0] ? toRow((claimed ?? [])[0] as Record<string, unknown>) : null;
  if (!bo) return { error: "This back order is not waiting any more." };
  const undo = async (why: unknown) => {
    logAppError("back-order.apply", why, { staffId: by.id, jobId: bo.job_id, detail: { id } });
    await admin.from("back_orders").update({ status: "pending", decided_by: null, decided_at: null, updated_by: by.id }).eq("id", id);
    return { error: SAVE_FAILED };
  };
  try {
    const [{ data: job }, { data: lineRows }, { data: q }, { data: part }] = await Promise.all([
      admin.from("jobs").select("id, job_number, vehicle_id, customer_id, department, advisor_id, gated_in_by, priority").eq("id", bo.job_id).maybeSingle(),
      admin.from("quotation_lines").select("*").in("id", [bo.part_line_id, bo.labour_line_id].filter((x): x is string => !!x)),
      admin.from("quotations").select("id, number, vat_percent, approver_name, approver_phone, responded_at, sent_at, sent_by, customer_id, vehicle_id").eq("id", bo.quotation_id ?? "").maybeSingle(),
      admin.from("part_items").select("id, description, job_id, po_id, expected_date, delivery_date").eq("id", bo.part_item_id).maybeSingle(),
    ]);
    if (!job || !q || !part) return undo(new Error("job, quotation or part missing"));
    const rows = (lineRows ?? []) as Record<string, unknown>[];
    const partLine = rows.find((r) => r.id === bo.part_line_id);
    const labLine = rows.find((r) => r.id === bo.labour_line_id) ?? null;
    if (!partLine) return undo(new Error("part line missing"));
    const vatPercent = Number(q.vat_percent) || 5;
    const partAmount = lineTotal(toLine(partLine));
    const lab = labLine ? toLine(labLine) : null;
    const labAmount = lab && bo.labour_hours_moved > 0 ? labourShare({ hours: Number(lab.hours) || 0, labour_rate: Number(lab.labour_rate) || 0, discount_percent: Number(lab.discount_percent) || 0 }, bo.labour_hours_moved) : 0;
    const money = movedMoney(partAmount, labAmount, vatPercent);
    // 1. The follow-up job: booked, not open (the gate-in opens it), the same car, customer, side and advisor.
    const advisor = job.advisor_id ?? job.gated_in_by;
    const { data: follow, error: fErr } = await admin.from("jobs").insert({ vehicle_id: job.vehicle_id, customer_id: job.customer_id, status: "booked", stage: "quote", is_open: false, department: job.department ?? "mechanical", priority: job.priority ?? "normal", gated_in_by: job.gated_in_by, advisor_id: advisor, gated_in_at: nowIso, booked_at: nowIso, continues_job_id: job.id, created_by: by.id, updated_by: by.id }).select("id, job_number").single();
    if (fErr || !follow) return undo(fErr ?? new Error("no follow-up job"));
    // 2. Its quotation: a copy of the moved lines, approved with the customer's approval of the original.
    const { data: fq, error: qErr } = await admin.from("quotations").insert({ kind: "quotation", job_id: follow.id, customer_id: q.customer_id, vehicle_id: q.vehicle_id, status: "draft", token: quoteToken(), vat_percent: vatPercent, discount_percent: 0, customer_note: `CONTINUES ${q.number} OF ${job.job_number}: APPROVED BY THE CUSTOMER${q.approver_name ? ` (${q.approver_name})` : ""}${q.responded_at ? ` ON ${formatDate(q.responded_at)}` : ""}. 6-MONTH WARRANTY ON THE PART FROM THE DAY IT IS FITTED.`, created_by: by.id, updated_by: by.id }).select("id, number").single();
    if (qErr || !fq) return undo(qErr ?? new Error("no follow-up quotation"));
    const strip = (r: Record<string, unknown>) => {
      const { id: _id, quotation_id: _q, created_at: _c, updated_at: _u, client_key: _k, revised_from_line_id: _r, ...rest } = r;
      void _id; void _q; void _c; void _u; void _k; void _r;
      return rest;
    };
    const copies: Record<string, unknown>[] = [{ ...strip(partLine), quotation_id: fq.id, part_item_id: bo.part_item_id, customer_approved: true, created_by: by.id, updated_by: by.id }];
    if (lab && labLine && bo.labour_hours_moved > 0) copies.push({ ...strip(labLine), quotation_id: fq.id, hours: bo.labour_hours_moved, line_total: labAmount, details: `FITTING ${String(part.description).toUpperCase()} (MOVED FROM ${job.job_number})`, customer_approved: true, created_by: by.id, updated_by: by.id });
    const { error: lErr } = await admin.from("quotation_lines").insert(copies, { defaultToNull: false });
    if (lErr) return undo(lErr);
    await refreshQuoteTotals(fq.id, settings, by.id);
    const { error: aErr } = await admin.from("quotations").update({ status: "approved", responded_at: q.responded_at ?? nowIso, approver_name: q.approver_name, approver_phone: q.approver_phone, sent_at: q.sent_at ?? nowIso, sent_by: q.sent_by, completed_at: nowIso, completed_by: by.id, rounded_total_aed: money.total, updated_by: by.id }).eq("id", fq.id);
    if (aErr) return undo(aErr);
    // 3. The part moves to the follow-up job with its LPO (the LPO itself stays as it is).
    const { error: pErr } = await admin.from("part_items").update({ job_id: follow.id, updated_by: by.id }).eq("id", bo.part_item_id);
    if (pErr) return undo(pErr);
    // 4. This visit's work line keeps only the hours done now (none left = off the work order).
    if (lab && bo.labour_hours_moved > 0) {
      const left = Math.round(((Number(lab.hours) || 0) - bo.labour_hours_moved) * 10) / 10;
      await admin.from("work_lines").update(left > 0 ? { hours_quoted: left, updated_by: by.id } : { is_active: false, updated_by: by.id }).eq("job_id", job.id).eq("quotation_line_id", lab.id).eq("is_active", true);
    }
    // 5. The calendar: the expected arrival, as a car drop to book (moved when the part arrives).
    const expected = (part.expected_date ?? part.delivery_date ?? bo.expected_date)?.slice(0, 10) ?? null;
    const startIso = new Date(`${expected ?? dubaiToday()}T10:00:00+04:00`).toISOString();
    const { data: appt } = await admin.from("appointments").insert({ kind: "car_drop", department: job.department ?? "mechanical", customer_id: job.customer_id, vehicle_id: job.vehicle_id, job_id: follow.id, reason: `Fit ${String(part.description).toUpperCase()} (back order, continues ${job.job_number}) – to confirm when the part arrives`, starts_at: startIso, duration_minutes: 60, advisor_id: advisor, status: "booked", created_by: by.id, updated_by: by.id }).select("id").maybeSingle();
    // 6. The money: "pays now" = the customer's advance on the follow-up job (a deposit proforma accounts record against).
    let depositId: string | null = null;
    let depositWords = "";
    if (bo.pay_mode === "now") {
      const { requestDeposit } = await import("./bodyshop");
      const d = await requestDeposit(follow.id, money.total, { id: by.id, display_name: by.display_name } as never, settings);
      if (d.error) logAppError("back-order.deposit", new Error(d.error), { jobId: follow.id });
      else {
        const { data: inv } = await admin.from("invoices").select("id").eq("job_id", follow.id).eq("number", d.number ?? "").maybeSingle();
        depositId = (inv?.id as string | undefined) ?? null;
        depositWords = ` Advance ${d.number} (AED ${money.total.toFixed(2)}) is ready for the customer to pay now.`;
      }
    }
    await admin.from("back_orders").update({ follow_job_id: follow.id, follow_quotation_id: fq.id, moved_net_aed: money.net, moved_total_aed: money.total, expected_date: expected, appointment_id: appt?.id ?? null, deposit_invoice_id: depositId, updated_by: by.id }).eq("id", id);
    const words = `${String(part.description).toUpperCase()} goes on back order: fitted on a later visit (${follow.job_number}, continues ${job.job_number}).${bo.labour_hours_moved > 0 ? ` ${bo.labour_hours_moved.toFixed(1)} h of labour moves with it.` : ""} AED ${money.total.toFixed(2)} with VAT moves to ${follow.job_number}; this visit's invoice covers only the work done.${depositWords}`;
    await admin.from("job_events").insert([
      { job_id: job.id, event_type: "back_order", note: `${words} Approved by ${by.display_name}. Reason: ${bo.reason}`, created_by: by.id },
      { job_id: follow.id, event_type: "back_order", note: `Continues ${job.job_number}: ${String(part.description).toUpperCase()} on order, expected ${expected ? formatDate(expected) : "no date yet"}. Approved by the customer on ${q.number}; no second approval.`, created_by: by.id },
    ]);
    const advisors = await jobAdvisorIds(job.id);
    const msg = { type: "back_order", title: `Back order · ${job.job_number} → ${follow.job_number}`, body: words, jobId: job.id, href: `/jobs/${job.id}#back-orders` };
    await notifyStaff(advisors.filter((a) => a !== by.id), msg);
    await notifyManagers(job.department ?? null, { ...msg, body: `${String(part.description).toUpperCase()} is fitted on a later visit (${follow.job_number}): this visit continues without it.` });
    await notifyRoles(["parts"], { ...msg, body: `${String(part.description).toUpperCase()} now belongs to ${follow.job_number} (the car is not here). Receive it as usual: the advisor is told to book the customer.`, href: `/parts/${follow.id}` });
    if (bo.requested_by && bo.requested_by !== by.id) await notifyStaff([bo.requested_by], { ...msg, title: `Back order approved · ${job.job_number}` });
    return { ok: true, words, followJobId: follow.id };
  } catch (e) {
    return undo(e);
  }
}

/** For the invoice draft and the work order: the moves of this visit's approved lines. */
export type LineMove = { lineId: string; quotationId: string; whole: boolean; hours: number; movedTotal: number };
export async function lineMovesMany(jobIds: string[]): Promise<Map<string, LineMove[]>> {
  const out = new Map<string, LineMove[]>();
  if (!jobIds.length || !(await backOrdersReady())) return out;
  const { data } = await createAdminClient().from("back_orders").select("job_id, quotation_id, part_line_id, labour_line_id, labour_hours_moved, moved_total_aed, status").in("job_id", jobIds).eq("is_active", true).in("status", MOVED_STATUSES);
  for (const r of (data ?? []) as { job_id: string; quotation_id: string; part_line_id: string | null; labour_line_id: string | null; labour_hours_moved: number | string; moved_total_aed: number | string | null }[]) {
    const list = out.get(r.job_id) ?? [];
    let total = Number(r.moved_total_aed) || 0;
    if (r.part_line_id) { list.push({ lineId: r.part_line_id, quotationId: r.quotation_id, whole: true, hours: 0, movedTotal: total }); total = 0; }
    if (r.labour_line_id && Number(r.labour_hours_moved) > 0) list.push({ lineId: r.labour_line_id, quotationId: r.quotation_id, whole: false, hours: Number(r.labour_hours_moved) || 0, movedTotal: total });
    out.set(r.job_id, list);
  }
  return out;
}

/** The customer's one line per back-ordered part on this visit's documents. */
export async function onOrderLines(jobId: string | null): Promise<string[]> {
  if (!jobId || !(await backOrdersReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("back_orders").select("part_item_id, expected_date, status").eq("job_id", jobId).eq("is_active", true).in("status", ["active", "arrived"]);
  const rows = (data ?? []) as { part_item_id: string; expected_date: string | null }[];
  if (!rows.length) return [];
  const { data: parts } = await admin.from("part_items").select("id, description, expected_date, delivery_date").in("id", rows.map((r) => r.part_item_id));
  const of = new Map(((parts ?? []) as { id: string; description: string; expected_date: string | null; delivery_date: string | null }[]).map((p) => [p.id, p]));
  return rows.map((r) => { const p = of.get(r.part_item_id); return onOrderWords(p?.description ?? "PART", (p?.expected_date ?? p?.delivery_date ?? r.expected_date)?.slice(0, 10) ?? null); });
}

/** The parts desk received a back-ordered part: the advisor is told to book the customer (with a draft message). */
export async function noticeBackOrderArrivals(): Promise<number> {
  if (!(await backOrdersReady())) return 0;
  const admin = createAdminClient();
  const { data } = await admin.from("back_orders").select(COLS).eq("is_active", true).in("status", ["active", "arrived"]);
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toRow);
  if (!rows.length) return 0;
  const { data: parts } = await admin.from("part_items").select("id, description, order_status, received_qty, issue_status").in("id", rows.map((r) => r.part_item_id));
  const partOf = new Map(((parts ?? []) as { id: string; description: string; order_status: string; received_qty: number | string | null; issue_status: string }[]).map((p) => [p.id, p]));
  const follows = rows.map((r) => r.follow_job_id).filter((x): x is string => !!x);
  const { data: fj } = follows.length ? await admin.from("jobs").select("id, job_number, gated_out_at, status").in("id", follows) : { data: [] };
  const jobOf = new Map(((fj ?? []) as { id: string; job_number: string; gated_out_at: string | null; status: string }[]).map((j) => [j.id, j]));
  let n = 0;
  for (const r of rows) {
    const p = partOf.get(r.part_item_id);
    const f = r.follow_job_id ? jobOf.get(r.follow_job_id) : undefined;
    // Fitted: the follow-up visit is done (the part's 6-month warranty runs from that day).
    if (f?.gated_out_at && r.status !== "fitted") {
      await admin.from("back_orders").update({ status: "fitted", fitted_at: f.gated_out_at }).eq("id", r.id);
      continue;
    }
    if (!p || r.status !== "active" || r.arrived_notified_at || p.order_status !== "received" || !r.follow_job_id || !f) continue;
    const { data: claimed } = await admin.from("back_orders").update({ status: "arrived", arrived_at: new Date().toISOString(), arrived_notified_at: new Date().toISOString() }).eq("id", r.id).is("arrived_notified_at", null).select("id");
    if (!(claimed ?? []).length) continue;
    n++;
    const name = p.description.toUpperCase();
    await admin.from("job_events").insert({ job_id: r.follow_job_id, event_type: "back_order_arrived", note: `${name} arrived: book the customer to have it fitted.` });
    await notifyStaff(await jobAdvisorIds(r.follow_job_id), { type: "back_order", title: `Back-order part arrived - book the customer · ${f.job_number}`, body: `${name} has arrived. Open the job for the customer's message and book the visit.`, jobId: r.follow_job_id, href: `/jobs/${r.follow_job_id}#back-orders` });
  }
  return n;
}

/** The customer's draft message for an arrived back order (shown on the follow-up job card). */
export async function arrivedMessageFor(followJobId: string, partName: string): Promise<string> {
  const { data } = await createAdminClient().from("jobs").select("customer:customers(full_name, company_name, address_as), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", followJobId).maybeSingle();
  const d = data as unknown as { customer: { full_name: string | null; company_name: string | null; address_as?: string | null } | null; vehicle: (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null } | null;
  const v = d?.vehicle;
  const car = v ? `${[v.make?.name, v.model?.name].filter(Boolean).join(" ").toUpperCase()} (${formatPlate(v)})` : "car";
  return arrivedMessage(greetingNameOf(d?.customer ?? null) || "Customer", partName, car);
}

export type BackOrderListRow = { id: string; jobId: string; jobNumber: string; followJobId: string | null; followNumber: string | null; plate: string; car: string; part: string; expected: string | null; daysOverdue: number; paidByCustomer: boolean | null; status: BackOrderStatus; words: string; advisorId: string | null };

/** The "Back orders (n)" list: live back orders (waiting for the owner, waiting for the part, part arrived). */
export async function loadBackOrderList(opts: { advisorId?: string | null } = {}): Promise<BackOrderListRow[]> {
  if (!(await backOrdersReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("back_orders").select(COLS).eq("is_active", true).in("status", ["pending", "active", "arrived"]).order("expected_date", { ascending: true });
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toRow);
  if (!rows.length) return [];
  const jobIds = Array.from(new Set(rows.flatMap((r) => [r.job_id, r.follow_job_id].filter((x): x is string => !!x))));
  const [{ data: jobs }, { data: parts }, { data: invs }] = await Promise.all([
    admin.from("jobs").select("id, job_number, advisor_id, gated_in_by, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds),
    admin.from("part_items").select("id, description, expected_date, delivery_date").in("id", rows.map((r) => r.part_item_id)),
    admin.from("invoices").select("id, total_aed").in("id", rows.map((r) => r.deposit_invoice_id).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])),
  ]);
  const depIds = ((invs ?? []) as { id: string }[]).map((i) => i.id);
  const { data: pays } = depIds.length ? await admin.from("payments").select("invoice_id, amount_aed, status").in("invoice_id", depIds).eq("is_active", true) : { data: [] };
  const paidOn = new Map<string, number>();
  for (const p of (pays ?? []) as { invoice_id: string; amount_aed: number | string; status: string }[]) if (p.status !== "void" && p.status !== "bounced") paidOn.set(p.invoice_id, (paidOn.get(p.invoice_id) ?? 0) + (Number(p.amount_aed) || 0));
  type J = { id: string; job_number: string; advisor_id: string | null; gated_in_by: string | null; vehicle: (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null };
  const jobOf = new Map(((jobs ?? []) as unknown as J[]).map((j) => [j.id, j]));
  const partOf = new Map(((parts ?? []) as { id: string; description: string; expected_date: string | null; delivery_date: string | null }[]).map((p) => [p.id, p]));
  const today = dubaiToday();
  return rows
    .map((r) => {
      const j = jobOf.get(r.job_id);
      const f = r.follow_job_id ? jobOf.get(r.follow_job_id) : undefined;
      const p = partOf.get(r.part_item_id);
      const expected = (p?.expected_date ?? p?.delivery_date ?? r.expected_date)?.slice(0, 10) ?? null;
      const v = j?.vehicle ?? null;
      const advisorId = f?.advisor_id ?? j?.advisor_id ?? j?.gated_in_by ?? null;
      return {
        id: r.id, jobId: r.job_id, jobNumber: j?.job_number ?? "", followJobId: r.follow_job_id, followNumber: f?.job_number ?? null,
        plate: v ? formatPlate(v) : "", car: v ? [v.make?.name, v.model?.name].filter(Boolean).join(" ").toUpperCase() : "",
        part: (p?.description ?? "PART").toUpperCase(), expected, daysOverdue: r.status === "arrived" ? 0 : daysOverdue(expected, today),
        paidByCustomer: r.pay_mode === "when_fitted" ? false : r.deposit_invoice_id ? (paidOn.get(r.deposit_invoice_id) ?? 0) >= (Number(r.moved_total_aed) || 0) - 0.005 : null,
        status: r.status, words: STATUS_WORDS[r.status], advisorId,
      };
    })
    .filter((r) => !opts.advisorId || r.advisorId === opts.advisorId);
}

/** The approvals list: back orders waiting for the owner. */
export async function backOrderApprovals(): Promise<{ id: string; jobId: string; jobNumber: string; part: string; reason: string; payMode: PayMode; askedBy: string | null; askedAt: string; hours: number }[]> {
  if (!(await backOrdersReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("back_orders").select(COLS).eq("status", "pending").eq("is_active", true);
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toRow);
  if (!rows.length) return [];
  const [{ data: jobs }, { data: parts }, { data: staff }] = await Promise.all([
    admin.from("jobs").select("id, job_number").in("id", rows.map((r) => r.job_id)),
    admin.from("part_items").select("id, description").in("id", rows.map((r) => r.part_item_id)),
    admin.from("staff").select("id, display_name").in("id", rows.map((r) => r.requested_by).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])),
  ]);
  const jn = new Map(((jobs ?? []) as { id: string; job_number: string }[]).map((j) => [j.id, j.job_number]));
  const pn = new Map(((parts ?? []) as { id: string; description: string }[]).map((p) => [p.id, p.description.toUpperCase()]));
  const sn = new Map(((staff ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  return rows.map((r) => ({ id: r.id, jobId: r.job_id, jobNumber: jn.get(r.job_id) ?? "", part: pn.get(r.part_item_id) ?? "PART", reason: r.reason, payMode: r.pay_mode, askedBy: r.requested_by ? sn.get(r.requested_by) ?? null : null, askedAt: r.requested_at, hours: r.labour_hours_moved }));
}

/** The follow-up job a car's gate-in opens (a back-order visit), with what it continues. */
export async function followUpOfVehicle(vehicleId: string): Promise<{ id: string; job_number: string; continues: string | null } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("jobs").select("id, job_number, continues_job_id").eq("vehicle_id", vehicleId).eq("status", "booked").not("continues_job_id", "is", null).order("booked_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const { data: orig } = await admin.from("jobs").select("job_number").eq("id", String(data.continues_job_id)).maybeSingle();
  return { id: String(data.id), job_number: String(data.job_number), continues: (orig?.job_number as string | undefined) ?? null };
}
