import "server-only";
import { checkFigures, CLEARING_LABEL, isClearing, preTicked, SETTLE_AFTER_WORKING_DAYS, splitFigures, type ClearingMethod } from "./card-settlement-rules";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { workingTimeOf } from "./jobs";
import { round2 } from "./money";
import { addWorkingDays } from "./planning";
import { getSettings } from "./settings";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";
import { recordOwnerReport } from "./owner-report";
import { reopenZoho, tryEnqueueZoho } from "./zoho-sync";

/** A card or payment-link payment still in the clearing account (no settlement yet). */
export type UnsettledPayment = {
  id: string;
  number: string;
  method: ClearingMethod;
  amount: number;
  estimate: number;
  /** The estimate in the bank's parts (null on payments recorded before 29 October 2026). */
  est: { msf: number; txn: number; vat: number } | null;
  authCode: string | null;
  receivedAt: string;
  jobId: string | null;
  plate: string;
  isDeposit: boolean;
  /** Received on a day before the given settlement day: pre-ticked on the screen. */
  preTicked?: boolean;
  /** Older than three working days: amber (the bank should have paid it out by now). */
  late: boolean;
};

export type SettlementRow = {
  id: string;
  number: string;
  method: ClearingMethod;
  settledOn: string;
  count: number;
  gross: number;
  received: number;
  fee: number;
  /** The parts of the fee (null on settlements recorded before 29 October 2026). */
  msf: number | null;
  txn: number | null;
  vat: number | null;
  /** Saved on purpose with figures that did not add up (the reason in differenceNote). */
  difference: number;
  differenceNote: string | null;
  source: string;
  statementRef: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  zohoStatus: string | null;
  /** False once undone (kept on record with the reason in the note). */
  active: boolean;
};

const PLATE_SELECT = "kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant";
const dubaiDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3600 * 1000).toISOString().slice(0, 10);
export const dubaiToday = () => dubaiDay(new Date().toISOString());

/** The card/link payments the bank has not paid out yet, oldest first. */
export async function loadUnsettled(settledOn?: string): Promise<UnsettledPayment[]> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const wt = workingTimeOf(settings);
  const today = dubaiToday();
  const { data } = await admin
    .from("payments")
    .select(`id, number, method, amount_aed, bank_charge_aed, fee_msf_aed, fee_txn_aed, fee_vat_aed, auth_code, received_at, job_id, is_deposit, job:jobs!payments_job_id_fkey(job_number, vehicle:vehicles(${PLATE_SELECT}))`)
    .eq("is_active", true)
    .eq("status", "recorded")
    .in("method", ["card", "link"])
    .is("settlement_id", null)
    .order("received_at", { ascending: true })
    .limit(500);
  return ((data ?? []) as unknown as { id: string; number: string; method: string; amount_aed: number | string; bank_charge_aed: number | string; fee_msf_aed: number | string | null; fee_txn_aed: number | string | null; fee_vat_aed: number | string | null; auth_code: string | null; received_at: string; job_id: string | null; is_deposit: boolean; job: { job_number: string; vehicle: Parameters<typeof formatPlate>[0] | null } | null }[])
    .filter((p) => isClearing(p.method))
    .map((p) => ({
      id: p.id,
      number: p.number,
      method: p.method as ClearingMethod,
      amount: round2(Number(p.amount_aed) || 0),
      estimate: round2(Number(p.bank_charge_aed) || 0),
      est: p.fee_msf_aed === null ? null : { msf: Number(p.fee_msf_aed) || 0, txn: Number(p.fee_txn_aed) || 0, vat: Number(p.fee_vat_aed) || 0 },
      authCode: p.auth_code,
      receivedAt: p.received_at,
      jobId: p.job_id,
      plate: p.job?.vehicle ? formatPlate(p.job.vehicle) : (p.job?.job_number ?? "No job"),
      isDeposit: p.is_deposit,
      ...(settledOn ? { preTicked: preTicked(p.received_at, settledOn) } : {}),
      late: addWorkingDays(dubaiDay(p.received_at), SETTLE_AFTER_WORKING_DAYS, wt) < today,
    }));
}

export async function loadSettlements(limit = 40): Promise<SettlementRow[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("card_settlements").select("id, number, method, settled_on, payment_count, gross_aed, received_aed, fee_aed, msf_aed, txn_fee_aed, vat_aed, difference_aed, difference_note, source, statement_ref, note, created_at, created_by, is_active").order("created_at", { ascending: false }).limit(limit);
  // A settlement undone in the same breath as it was made (two people at once) is noise, not history.
  const rows = ((data ?? []) as { id: string; number: string; method: ClearingMethod; settled_on: string; payment_count: number; gross_aed: number | string; received_aed: number | string; fee_aed: number | string; msf_aed: number | string | null; txn_fee_aed: number | string | null; vat_aed: number | string | null; difference_aed: number | string | null; difference_note: string | null; source: string | null; statement_ref: string | null; note: string | null; created_at: string; created_by: string | null; is_active: boolean }[]).filter((r) => r.is_active || !/settled by someone else at the same time/.test(r.note ?? ""));
  const ids = rows.map((r) => r.id);
  const staffIds = Array.from(new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x)));
  const [{ data: ob }, { data: people }] = await Promise.all([
    ids.length ? admin.from("zoho_outbox").select("record_id, status").eq("kind", "settlement").in("record_id", ids) : Promise.resolve({ data: [] as { record_id: string; status: string }[] }),
    staffIds.length ? admin.from("staff").select("id, full_name").in("id", staffIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const zoho = new Map(((ob ?? []) as { record_id: string; status: string }[]).map((o) => [o.record_id, o.status]));
  const names = new Map(((people ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    method: r.method,
    settledOn: r.settled_on,
    count: r.payment_count,
    gross: Number(r.gross_aed),
    received: Number(r.received_aed),
    fee: Number(r.fee_aed),
    msf: r.msf_aed === null ? null : Number(r.msf_aed),
    txn: r.txn_fee_aed === null ? null : Number(r.txn_fee_aed),
    vat: r.vat_aed === null ? null : Number(r.vat_aed),
    difference: Number(r.difference_aed) || 0,
    differenceNote: r.difference_note,
    source: r.source ?? "manual",
    statementRef: r.statement_ref,
    note: r.note,
    createdAt: r.created_at,
    createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
    zohoStatus: zoho.get(r.id) ?? null,
    active: r.is_active,
  }));
}

async function nextNumber(): Promise<string> {
  const { data } = await createAdminClient().from("card_settlements").select("number").like("number", "STL-%").order("number", { ascending: false }).limit(1);
  const last = Number(String((data?.[0] as { number: string } | undefined)?.number ?? "STL-0").slice(4)) || 0;
  return `STL-${String(last + 1).padStart(5, "0")}`;
}

export type SettleInput = {
  method: string;
  settledOn: string;
  paymentIds: string[];
  /** What reached the bank. */
  net: number | null;
  /** The bank's MSF, its fee per transaction and the VAT on both, as the statement or report shows them. */
  msf: number | null;
  txn: number | null;
  vat: number | null;
  statementRef: string | null;
  note: string | null;
  confirmed: boolean;
  /** Figures that do not add up are saved only on purpose, with the reason in the note (owner and accounts). */
  override?: boolean;
  /** From the bank's report: each payment's own MSF, fee, VAT and net. */
  exact?: Record<string, { msf: number; txn: number; vat: number; net?: number }>;
  reportId?: string | null;
};
export type SettleResult = { ok: true; id: string; number: string; fee: number; cost: number; count: number; difference: number } | { ok: false; error: string; askAgain?: string; difference?: number };

/**
 * Records one settlement: the ticked payments (one method, all still unsettled), the net that reached the bank and
 * what the bank kept (MSF, fee per transaction, VAT); ticked = net + MSF + fee + VAT, else nothing is saved unless
 * the difference is explained in the note on purpose. Each payment takes its share (exact when the bank's report
 * names it), the job's profit switches to the actual MSF + fee, then the Zoho entries are queued. Nothing half-done:
 * a payment settled by someone else in the meantime undoes the whole settlement.
 */
export async function recordSettlement(input: SettleInput, actorId: string): Promise<SettleResult> {
  if (!isClearing(input.method)) return { ok: false, error: "Pick Card machine or Payment link." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.settledOn)) return { ok: false, error: "Pick the settlement date (the day the money reached the bank)." };
  if (input.settledOn > dubaiToday()) return { ok: false, error: "The settlement date cannot be in the future." };
  const ids = Array.from(new Set(input.paymentIds.filter(Boolean)));
  if (!ids.length) return { ok: false, error: "Tick the payments this settlement paid out." };
  const admin = createAdminClient();
  const { data: rows } = await admin.from("payments").select("id, number, method, amount_aed, status, is_active, settlement_id, received_at, job_id").in("id", ids);
  const pays = (rows ?? []) as { id: string; number: string; method: string; amount_aed: number | string; status: string; is_active: boolean; settlement_id: string | null; received_at: string; job_id: string | null }[];
  if (pays.length !== ids.length) return { ok: false, error: "One of the ticked payments no longer exists. Reload the page." };
  const wrong = pays.find((p) => p.method !== input.method);
  if (wrong) return { ok: false, error: `${wrong.number} is not a ${CLEARING_LABEL[input.method].toLowerCase()} payment. One settlement covers one method.` };
  const gone = pays.find((p) => p.settlement_id || p.status !== "recorded" || !p.is_active);
  if (gone) return { ok: false, error: `${gone.number} is ${gone.settlement_id ? "already in another settlement" : "voided"}. Reload the page.` };
  // Money cannot leave the clearing account before it came in: a payment taken after the settlement day is refused.
  const late = pays.find((p) => dubaiDay(p.received_at) > input.settledOn);
  if (late) return { ok: false, error: `${late.number} was received on ${dubaiDay(late.received_at)}, after the settlement date ${input.settledOn}. Untick it or pick the right date.` };
  const amounts = pays.map((p) => ({ id: p.id, amount: round2(Number(p.amount_aed) || 0) }));
  const gross = round2(amounts.reduce((a, p) => a + p.amount, 0));
  const check = checkFigures({ gross, net: input.net, msf: input.msf, txn: input.txn, vat: input.vat });
  let difference = 0;
  if (!check.ok) {
    if (!check.difference) return { ok: false, error: check.error ?? "Check the figures." };
    // The figures do not add up: saved only on purpose, the reason written down (and kept on the settlement).
    if (!input.override) return { ok: false, error: check.error ?? "The figures do not add up.", difference: check.difference };
    if ((input.note ?? "").trim().length < 5) return { ok: false, error: `Write in the note why the figures differ by AED ${Math.abs(check.difference).toFixed(2)} (a few words), then save anyway.`, difference: check.difference };
    difference = check.difference;
  }
  if (check.askAgain && !input.confirmed) return { ok: false, error: check.askAgain, askAgain: check.askAgain };
  const msf = round2(input.msf ?? 0);
  const txn = round2(input.txn ?? 0);
  const vat = round2(input.vat ?? 0);
  const net = round2(input.net ?? 0);
  const shares = splitFigures(amounts, { msf, txn, vat }, input.exact ?? {});

  let number = await nextNumber();
  let made: { id: string; number: string } | null = null;
  for (let attempt = 0; attempt < 2 && !made; attempt++) {
    const { data, error } = await admin
      .from("card_settlements")
      .insert({ number, method: input.method, settled_on: input.settledOn, payment_count: pays.length, gross_aed: gross, received_aed: net, fee_aed: round2(msf + txn + vat), msf_aed: msf, txn_fee_aed: txn, vat_aed: vat, difference_aed: difference, difference_note: difference ? (input.note ?? "").trim().slice(0, 600) : null, source: input.exact && Object.keys(input.exact).length ? "report" : "manual", report_id: input.reportId ?? null, statement_ref: input.statementRef, note: input.note, created_by: actorId, updated_by: actorId })
      .select("id, number")
      .single();
    if (data) made = data as { id: string; number: string };
    else if (error && /duplicate|unique/i.test(error.message)) number = await nextNumber();
    else {
      await logAppError("card_settlement_insert", error ?? "no row", { staffId: actorId, detail: { number, ids } });
      return { ok: false, error: SAVE_FAILED };
    }
  }
  if (!made) return { ok: false, error: SAVE_FAILED };

  // Each payment takes its share; the guard makes sure no one else settled it in the meantime.
  let done = 0;
  for (const p of amounts) {
    const s = shares.get(p.id) ?? { msf: 0, txn: 0, vat: 0 };
    const { data: upd, error } = await admin.from("payments").update({ settlement_id: made.id, actual_msf_aed: s.msf, actual_txn_fee_aed: s.txn, actual_vat_aed: s.vat, actual_fee_aed: round2(s.msf + s.txn), updated_by: actorId }).eq("id", p.id).is("settlement_id", null).select("id");
    if (error) await logAppError("card_settlement_payment", error, { staffId: actorId, detail: { settlement: made.number, payment: p.id } });
    if (upd?.length) done++;
  }
  if (done !== amounts.length) {
    await admin.from("payments").update({ settlement_id: null, actual_fee_aed: null, actual_msf_aed: null, actual_txn_fee_aed: null, actual_vat_aed: null, updated_by: actorId }).eq("settlement_id", made.id);
    await admin.from("card_settlements").update({ is_active: false, note: `Undone: a payment was settled by someone else at the same time.`, updated_by: actorId }).eq("id", made.id);
    return { ok: false, error: "Someone else settled one of these payments at the same time. Nothing was recorded: reload the page and try again." };
  }
  if (difference) {
    // A settlement saved with figures that do not add up: written in the change log for the owner and the accountant.
    await admin.from("audit_log").insert({ table_name: "card_settlements", record_id: made.id, action: "update", new_data: { saved_with_difference_aed: difference, reason: (input.note ?? "").trim(), number: made.number }, changed_by: actorId }).then(() => null, () => null);
  }
  await tryEnqueueZoho("settlement", made.id, null, actorId);
  await refreshClosedReports(pays.map((p) => p.job_id));
  return { ok: true, id: made.id, number: made.number, fee: round2(msf + txn + vat), cost: round2(msf + txn), count: pays.length, difference };
}

/** Closed jobs keep a frozen owner report: rebuilt when their card fee switches between estimate and actual. */
async function refreshClosedReports(jobIds: (string | null)[]): Promise<void> {
  const ids = Array.from(new Set(jobIds.filter((x): x is string => !!x)));
  if (!ids.length) return;
  const { data } = await createAdminClient().from("jobs").select("id").in("id", ids).eq("is_open", false);
  const settings = await getSettings();
  for (const j of (data ?? []) as { id: string }[]) {
    try {
      await recordOwnerReport(j.id, settings);
    } catch (e) {
      await logAppError("card_settlement_owner_report", e, { jobId: j.id });
    }
  }
}

export type UndoResult = { ok: true; number: string; posted: boolean } | { ok: false; error: string };

/**
 * Undoes a settlement (a wrong amount or wrong ticks): its payments go back to unsettled with their estimated fee,
 * the settlement stays on record as undone with the reason, and Zoho is told. A transfer that already reached Zoho
 * turns red on the sync page for the accountant to remove by hand; one that had not is never posted.
 */
export async function undoSettlement(settlementId: string, reason: string, actorId: string): Promise<UndoResult> {
  const clean = reason.trim().slice(0, 300);
  if (clean.length < 3) return { ok: false, error: "Write why the settlement is undone." };
  const admin = createAdminClient();
  const { data } = await admin.from("card_settlements").select("id, number, is_active, note, zoho_transfer_id, zoho_fee_id").eq("id", settlementId).maybeSingle();
  const st = data as { id: string; number: string; is_active: boolean; note: string | null; zoho_transfer_id: string | null; zoho_fee_id: string | null } | null;
  if (!st) return { ok: false, error: "Settlement not found." };
  if (!st.is_active) return { ok: false, error: `${st.number} is already undone.` };
  const { data: payRows } = await admin.from("payments").select("id, job_id").eq("settlement_id", st.id);
  const { error: e1 } = await admin.from("card_settlements").update({ is_active: false, note: [st.note, `Undone: ${clean}`].filter(Boolean).join(" · ").slice(0, 600), updated_by: actorId }).eq("id", st.id).eq("is_active", true);
  if (e1) {
    await logAppError("card_settlement_undo", e1, { staffId: actorId, detail: { settlement: st.number } });
    return { ok: false, error: SAVE_FAILED };
  }
  const { error: e2 } = await admin.from("payments").update({ settlement_id: null, actual_fee_aed: null, actual_msf_aed: null, actual_txn_fee_aed: null, actual_vat_aed: null, updated_by: actorId }).eq("settlement_id", st.id);
  if (e2) await logAppError("card_settlement_undo_payments", e2, { staffId: actorId, detail: { settlement: st.number } });
  // The outbox row runs again: unposted = skipped, posted = red with the by-hand words.
  await tryEnqueueZoho("settlement", st.id, null, actorId);
  await reopenZoho("settlement", st.id);
  await refreshClosedReports(((payRows ?? []) as { job_id: string | null }[]).map((p) => p.job_id));
  return { ok: true, number: st.number, posted: !!(st.zoho_transfer_id || st.zoho_fee_id) };
}

/** The clearing accounts' open balance at the end of a Dubai day (ERP side): card/link money not yet paid out. */
export async function clearingOpenAt(day: string): Promise<Record<ClearingMethod, { count: number; total: number; oldest: string | null }>> {
  const admin = createAdminClient();
  const end = new Date(Date.parse(`${day}T00:00:00+04:00`) + 24 * 3600 * 1000).toISOString();
  const [{ data: pays }, { data: sets }] = await Promise.all([
    admin.from("payments").select("method, amount_aed, received_at, settlement_id").eq("is_active", true).eq("status", "recorded").in("method", ["card", "link"]).lt("received_at", end),
    admin.from("card_settlements").select("id, settled_on").eq("is_active", true).lte("settled_on", day),
  ]);
  const settledBy = new Set(((sets ?? []) as { id: string }[]).map((s) => s.id));
  const out: Record<ClearingMethod, { count: number; total: number; oldest: string | null }> = { card: { count: 0, total: 0, oldest: null }, link: { count: 0, total: 0, oldest: null } };
  for (const p of (pays ?? []) as { method: string; amount_aed: number | string; received_at: string; settlement_id: string | null }[]) {
    if (!isClearing(p.method) || (p.settlement_id && settledBy.has(p.settlement_id))) continue;
    const o = out[p.method];
    o.count++;
    o.total = round2(o.total + (Number(p.amount_aed) || 0));
    const d = dubaiDay(p.received_at);
    if (!o.oldest || d < o.oldest) o.oldest = d;
  }
  return out;
}
