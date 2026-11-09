import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { getSettings } from "./settings";
import { notifyRoles, notifyStaff, jobAdvisorIds } from "./notifications";
import { bankPostingReady } from "./schema-ready";
import { awaitsBank, bankWord, chequeNotDue, transferArrival } from "./bank-status";
import { dubaiToday, nextSettlementNumber } from "./card-settlements";
import { round2 } from "./money";

/*
 * Accounts posting for cheques and bank transfers (9 November 2026, Section 2). THE steps:
 *   - markChequeDeposited: a cheque goes to the bank (date, bank account); a post-dated cheque waits for its date;
 *   - clearBankPayments: THE posting row - ticked cheques cleared / transfers confirmed on the day the money reached
 *     the bank (never in the future, never before the payments), with the amount and the statement reference. One
 *     transfer may arrive short (the balance stays open) or over (the rest becomes an advance). Once the database
 *     change is applied it is recorded as an STL- posting so Zoho moves the money from Undeposited Funds to the bank;
 *   - bounceBankPayment: a bounced cheque or a transfer that never arrived reverses the payment, the balance reopens,
 *     the advisors and the owner hear it, a bank charge is written down as an expense.
 * After a clearing every job and document the money touches is settled exactly as a payment recorded straight would be.
 */

export type BankActor = { id: string; display_name: string; role_id: string };
const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dubaiDay = (iso: string) => new Date(Date.parse(iso) + 4 * 3600 * 1000).toISOString().slice(0, 10);
/** A day as a timestamp at noon Dubai time (the statement day, never shifted across midnight). */
const noonOf = (day: string) => `${day}T08:00:00.000Z`;

type Pay = { id: string; number: string; method: string; amount_aed: number | string; status: string; is_active: boolean; cheque_status: string | null; cheque_number: string | null; cheque_date: string | null; received_at: string; job_id: string | null; invoice_id: string | null; customer_id: string; vehicle_id?: string | null; is_deposit: boolean; settlement_id: string | null; zoho_payment_id: string | null };
const PAY_COLS = "id, number, method, amount_aed, status, is_active, cheque_status, cheque_number, cheque_date, received_at, job_id, invoice_id, customer_id, is_deposit, settlement_id, zoho_payment_id";
const mayPost = (a: BankActor) => a.role_id === "owner" || a.role_id === "accounts";

export async function markChequeDeposited(paymentId: string, input: { date: string; account: string }, actor: BankActor): Promise<{ error?: string; ok?: boolean; words?: string }> {
  if (!mayPost(actor)) return { error: "Only accounts or the owner mark a cheque deposited." };
  if (!(await bankPostingReady())) return { error: "Marking a cheque deposited switches on with the database update of 9 November (WAITING FOR APPLY). Mark it cleared when it is on the statement." };
  const admin = createAdminClient();
  const { data } = await admin.from("payments").select(PAY_COLS).eq("id", paymentId).maybeSingle();
  const p = data as Pay | null;
  if (!p || p.method !== "cheque" || p.status !== "recorded" || !p.is_active) return { error: "That cheque is no longer waiting." };
  if (p.cheque_status !== "pending") return { error: `${p.number} is already ${p.cheque_status}.` };
  const today = dubaiToday();
  const notDue = chequeNotDue(p.cheque_date, today);
  if (notDue) return { error: `Post-dated cheque: it cannot be deposited before its date (${notDue}).` };
  const day = String(input.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Pick the day it went to the bank." };
  if (day > today) return { error: "The deposit day cannot be in the future." };
  if (day < dubaiDay(p.received_at)) return { error: `The deposit day cannot be before the cheque was received (${dubaiDay(p.received_at)}).` };
  const account = String(input.account ?? "").trim();
  if (account.length < 2) return { error: "Which bank account did it go into?" };
  const { error } = await admin.from("payments").update({ cheque_deposited_at: day, cheque_deposited_to: account.slice(0, 80), cheque_deposited_by: actor.id, updated_by: actor.id }).eq("id", p.id).eq("cheque_status", "pending");
  if (error) { await logAppError("bank-posting: deposited", error, { staffId: actor.id, jobId: p.job_id }); return { error: SAVE_FAILED }; }
  const words = `${p.number}: cheque ${p.cheque_number ?? ""} deposited on ${day} into ${account} (${actor.display_name})`.replace(/\s+/g, " ");
  if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment", note: words, created_by: actor.id });
  return { ok: true, words };
}

export type ClearResult = { error?: string; ok?: boolean; words?: string; number?: string | null };

/**
 * THE posting: ticked cheques / transfers reached the bank on `date`. The amount must equal what was ticked, except
 * for ONE transfer, which may arrive short or over.
 */
export async function clearBankPayments(ids: string[], input: { date: string; amount: number; statementRef?: string | null; fee?: number | null; note?: string | null }, actor: BankActor): Promise<ClearResult> {
  if (!mayPost(actor)) return { error: "Only accounts or the owner record money reaching the bank." };
  // A combined cheque or transfer (one payment for several cars) clears as ONE: every share of its group goes together.
  const { groupSiblings } = await import("./payment-groups");
  const list = await groupSiblings(Array.from(new Set(ids.filter(Boolean))));
  if (!list.length) return { error: "Tick the payments this money covers." };
  const day = String(input.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Pick the day the money reached the bank (on the statement)." };
  const today = dubaiToday();
  if (day > today) return { error: "That day is in the future: pick the day on the statement." };
  const admin = createAdminClient();
  const { data } = await admin.from("payments").select(PAY_COLS).in("id", list);
  const pays = (data ?? []) as Pay[];
  if (pays.length !== list.length) return { error: "One of the ticked payments no longer exists. Reload the page." };
  const method = pays[0].method;
  if (pays.some((p) => p.method !== method)) return { error: "One posting covers one method: cheques, or transfers." };
  if (method !== "cheque" && method !== "transfer") return { error: "Card and payment-link money is recorded on their own tabs." };
  const gone = pays.find((p) => !awaitsBank(p) || p.status !== "recorded" || !p.is_active);
  if (gone) return { error: `${gone.number} is not waiting any more (${gone.cheque_status ?? gone.status}). Reload the page.` };
  const early = pays.find((p) => dubaiDay(p.received_at) > day);
  if (early) return { error: `${early.number} was received on ${dubaiDay(early.received_at)}, after ${day}. Untick it or pick the right day.` };
  const notDue = pays.find((p) => p.method === "cheque" && chequeNotDue(p.cheque_date, day));
  if (notDue) return { error: `${notDue.number} is a post-dated cheque (${chequeNotDue(notDue.cheque_date, day)}): it cannot clear before then.` };
  const gross = round2(pays.reduce((a, p) => a + (Number(p.amount_aed) || 0), 0));
  const fee = round2(Number(input.fee) || 0);
  const arrived = round2(Number(input.amount) || 0);
  if (!(arrived > 0)) return { error: "Type the amount that reached the bank." };
  let arrival: ReturnType<typeof transferArrival> = { kind: "exact", difference: 0 };
  if (Math.abs(arrived + fee - gross) > 0.004) {
    if (pays.length !== 1 || method !== "transfer") return { error: `The ticked ${method === "cheque" ? "cheques" : "transfers"} come to ${money(gross)} but ${money(arrived + fee)} was typed. ${method === "cheque" ? "A cheque clears whole: check the ticks." : "Record a transfer that arrived short or over on its own."}` };
    arrival = transferArrival(gross, arrived + fee);
  }
  const ready = await bankPostingReady();
  const ref = (input.statementRef ?? "").trim().slice(0, 120) || null;

  // The posting row (STL-) once the database change is applied: Zoho moves the money to the bank from it.
  let posting: { id: string; number: string } | null = null;
  if (ready) {
    let number = await nextSettlementNumber();
    for (let i = 0; i < 2 && !posting; i++) {
      // What reached the bank plus any fee = the money posted (a short transfer counts what arrived; an over one counts
      // the extra advance too, which joins this posting).
      const { data: made, error } = await admin.from("card_settlements").insert({ number, method, settled_on: day, payment_count: pays.length + (arrival.kind === "more" ? 1 : 0), gross_aed: round2(arrived + fee), received_aed: arrived, fee_aed: fee, msf_aed: fee, txn_fee_aed: 0, vat_aed: 0, difference_aed: 0, source: "manual", statement_ref: ref, note: (input.note ?? "").trim().slice(0, 600) || null, created_by: actor.id, updated_by: actor.id }).select("id, number").single();
      if (made) posting = made as { id: string; number: string };
      else if (error && /duplicate|unique/i.test(error.message)) number = await nextSettlementNumber();
      else { await logAppError("bank-posting: posting row", error ?? "no row", { staffId: actor.id }); return { error: SAVE_FAILED }; }
    }
  }

  const at = noonOf(day);
  const cleared: Pay[] = [];
  for (const p of pays) {
    const patch: Record<string, unknown> = { cheque_status: "cleared", cleared_at: at, verified_at: new Date().toISOString(), verified_by: actor.id, updated_by: actor.id, ...(posting ? { settlement_id: posting.id } : {}) };
    // One transfer that arrived short: the payment is what arrived (the balance stays open); the words keep both figures.
    if (arrival.kind === "less") patch.amount_aed = round2(Number(p.amount_aed) - arrival.difference);
    if (arrival.kind !== "exact") patch.notes = [`Recorded ${money(Number(p.amount_aed))}, ${money(arrived + fee)} reached the bank on ${day}`].join(" · ");
    const { data: upd, error } = await admin.from("payments").update(patch).eq("id", p.id).eq("cheque_status", "pending").select("id");
    if (error) await logAppError("bank-posting: clear", error, { staffId: actor.id, jobId: p.job_id });
    if (upd?.length) cleared.push(p);
  }
  if (cleared.length !== pays.length) {
    if (posting) {
      await admin.from("payments").update({ settlement_id: null, updated_by: actor.id }).eq("settlement_id", posting.id);
      await admin.from("card_settlements").update({ is_active: false, note: "Undone: a payment was cleared by someone else at the same time.", updated_by: actor.id }).eq("id", posting.id);
    }
    if (!cleared.length) return { error: "Someone else cleared these at the same time. Nothing was recorded: reload the page." };
  }
  // One transfer that arrived over: the rest is an advance on the same job (or the customer's account).
  if (arrival.kind === "more") {
    const p = pays[0];
    const { error } = await admin.from("payments").insert({ job_id: p.job_id, invoice_id: null, customer_id: p.customer_id, method: "transfer", amount_aed: arrival.difference, is_deposit: true, status: "recorded", cheque_status: "cleared", cleared_at: at, received_at: p.received_at, received_by: actor.id, notes: `Extra that reached the bank with ${p.number} on ${day}: kept as an advance`, verified_at: new Date().toISOString(), verified_by: actor.id, ...(posting ? { settlement_id: posting.id } : {}), created_by: actor.id, updated_by: actor.id });
    if (error) await logAppError("bank-posting: extra advance", error, { staffId: actor.id, jobId: p.job_id });
  }
  if (posting) {
    const { tryEnqueueZoho } = await import("./zoho-sync");
    await tryEnqueueZoho("settlement", posting.id, null, actor.id);
  }
  await afterBankMoney(cleared, "cleared", actor, day);
  const what = method === "cheque" ? `cheque${cleared.length === 1 ? "" : "s"}` : `transfer${cleared.length === 1 ? "" : "s"}`;
  const extra = arrival.kind === "less" ? ` ${money(arrival.difference)} short: the balance stays open.` : arrival.kind === "more" ? ` ${money(arrival.difference)} over: kept as an advance.` : "";
  return { ok: true, number: posting?.number ?? null, words: `${cleared.map((p) => p.number).join(", ")}: ${cleared.length} ${what} ${method === "cheque" ? "cleared" : "confirmed in the bank"} on ${day}${posting ? ` (${posting.number})` : ""}.${extra}` };
}

/** A bounced cheque, or a transfer that never arrived: the payment reverses and the balance is due again. A combined
 *  cheque (one payment for several cars) bounces as ONE: every share is reversed, the bank charge written once. */
export async function bounceBankPayment(paymentId: string, input: { charge?: number | null; note?: string | null }, actor: BankActor): Promise<{ error?: string; ok?: boolean; words?: string }> {
  if (!mayPost(actor)) return { error: "Only accounts or the owner mark a payment bounced." };
  const { groupSiblings } = await import("./payment-groups");
  const all = await groupSiblings([paymentId]);
  if (all.length > 1) {
    const words: string[] = [];
    for (const id of all) {
      const r = await bounceOne(id, id === paymentId ? input : { note: input.note }, actor);
      if (r.error) return { error: r.error, words: words.join(" ") || undefined };
      words.push(r.words ?? "");
    }
    const { data: g } = await createAdminClient().from("payments").select("group_id").eq("id", paymentId).maybeSingle();
    if (g?.group_id) {
      const { reopenZoho } = await import("./zoho-sync");
      await reopenZoho("paygroup", String(g.group_id)).catch(() => null);
    }
    return { ok: true, words: `One combined payment: all ${all.length} shares reversed. ${words.join(" ")}` };
  }
  return bounceOne(paymentId, input, actor);
}

async function bounceOne(paymentId: string, input: { charge?: number | null; note?: string | null }, actor: BankActor): Promise<{ error?: string; ok?: boolean; words?: string }> {
  const admin = createAdminClient();
  const { data } = await admin.from("payments").select(PAY_COLS).eq("id", paymentId).maybeSingle();
  const p = data as Pay | null;
  if (!p || !["cheque", "transfer"].includes(p.method) || p.status !== "recorded" || !p.is_active) return { error: "That payment is no longer waiting." };
  if (p.cheque_status !== "pending") return { error: `${p.number} is already ${p.cheque_status}.` };
  const charge = round2(Number(input.charge) || 0);
  const ready = await bankPostingReady();
  const why = p.method === "cheque" ? "Cheque bounced" : "Transfer never arrived";
  const now = new Date().toISOString();
  const { data: upd, error } = await admin.from("payments").update({ cheque_status: "bounced", status: "reversed", reversed_at: now, reversed_reason: `${why}${input.note?.trim() ? `: ${input.note.trim().slice(0, 200)}` : ""}`, ...(ready && charge > 0 ? { bounce_charge_aed: charge } : {}), updated_by: actor.id }).eq("id", p.id).eq("cheque_status", "pending").select("id");
  if (error) { await logAppError("bank-posting: bounce", error, { staffId: actor.id, jobId: p.job_id }); return { error: SAVE_FAILED }; }
  if (!upd?.length) return { error: "Someone else changed it at the same time. Reload the page." };
  // Zoho: once posted into Undeposited Funds, the worker takes it back out (THE reversal of a voided payment).
  if (p.zoho_payment_id) {
    const { reopenZoho } = await import("./zoho-sync");
    await reopenZoho(p.is_deposit ? "deposit" : "payment", p.id).catch((e) => logAppError("bank-posting: bounce zoho", e, { staffId: actor.id }));
  }
  await afterBankMoney([p], "bounced", actor, dubaiToday(), charge);
  return { ok: true, words: `${p.number}: ${why.toLowerCase()} – ${money(Number(p.amount_aed))} reversed, the balance is due again.${charge ? ` Bank charge ${money(charge)} written down as an expense.` : ""}` };
}

/** After money cleared or bounced: the job's history, the documents settled, the people told. */
async function afterBankMoney(pays: Pay[], what: "cleared" | "bounced", actor: BankActor, day: string, charge = 0): Promise<void> {
  const admin = createAdminClient();
  const settings = await getSettings();
  const { settleJob, tellDepositCovered } = await import("./payments");
  const { tryEnqueueZoho } = await import("./zoho-sync");
  const { afterPendingChargePayment } = await import("./charges");
  const { afterEstimatePayment } = await import("./estimate-money");
  for (const p of pays) {
    try {
      const word = p.method === "cheque" ? `cheque ${p.cheque_number ?? ""}`.trim() : "transfer";
      if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment", note: `${p.number}: ${word} ${what === "cleared" ? (p.method === "cheque" ? "cleared" : "confirmed in the bank") : p.method === "cheque" ? "BOUNCED" : "never arrived"} (${day}, ${actor.display_name})${charge ? ` · bank charge ${money(charge)} (expense)` : ""}`, created_by: actor.id });
      if (what === "cleared") {
        // Zoho: before the posting change it posts now (straight to the bank, dated the clearing day); after it, it was
        // already in Undeposited Funds and the posting row moves it.
        await tryEnqueueZoho(p.is_deposit ? "deposit" : "payment", p.id, p.job_id, actor.id);
        if (p.job_id && p.invoice_id) await settleJob(p.job_id, p.invoice_id, actor.id, settings);
        if (p.job_id && !p.invoice_id) await tellDepositCovered(p.job_id).catch(() => null);
        if (!p.job_id && p.invoice_id) {
          await afterPendingChargePayment(p.invoice_id, { id: actor.id, display_name: actor.display_name, role_id: actor.role_id }, settings).catch(() => null);
          await afterEstimatePayment(p.invoice_id, { id: actor.id, display_name: actor.display_name }, settings).catch(() => null);
        }
      } else {
        const body = `${money(Number(p.amount_aed))} reversed (${p.number}). The balance is due again.${charge ? ` Bank charge ${money(charge)}.` : ""}`;
        const title = `${p.method === "cheque" ? "Cheque bounced" : "Transfer never arrived"} · ${p.number}`;
        if (p.job_id) await notifyStaff(await jobAdvisorIds(p.job_id), { type: "cheque_bounced", title, body, jobId: p.job_id, href: `/jobs/${p.job_id}/invoice` });
        await notifyRoles(["owner"], { type: "cheque_bounced", title, body, jobId: p.job_id, href: p.job_id ? `/jobs/${p.job_id}/invoice` : "/accounts-posting?tab=cheque" });
      }
    } catch (e) {
      await logAppError("bank-posting: after", e, { staffId: actor.id, jobId: p.job_id });
    }
  }
}

export type BankWaiting = { id: string; number: string; method: "cheque" | "transfer"; amount: number; receivedAt: string; chequeNumber: string | null; chequeBank: string | null; chequeDate: string | null; notDue: string | null; depositedAt: string | null; depositedTo: string | null; reference: string | null; jobId: string | null; jobNumber: string | null; plate: string; customer: string; late: boolean; proofPath: string | null; /** A share of a combined payment (one cheque for several cars): it clears and bounces with the whole. */ group: { number: string; words: string; total: number } | null };

/** Cheques and transfers waiting for the bank, oldest first (Accounts posting's Cheque and Bank transfer tabs). */
export async function loadBankWaiting(opts: { jobIds?: string[]; ids?: string[] } = {}): Promise<BankWaiting[]> {
  const admin = createAdminClient();
  const ready = await bankPostingReady();
  let query = admin
    .from("payments")
    .select(`id, number, method, amount_aed, received_at, cheque_number, cheque_bank, cheque_date, reference, proof_path, job_id, customer_id${ready ? ", cheque_deposited_at, cheque_deposited_to" : ""}, job:jobs!payments_job_id_fkey(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)), customer:customers(full_name, company_name)`)
    .eq("is_active", true)
    .eq("status", "recorded")
    .in("method", ["cheque", "transfer"])
    .eq("cheque_status", "pending")
    .order("received_at", { ascending: true })
    .limit(500);
  if (opts.jobIds?.length) query = query.in("job_id", opts.jobIds);
  if (opts.ids?.length) query = query.in("id", opts.ids);
  const { data } = await query;
  const settings = await getSettings();
  const { workingTimeOf } = await import("./jobs");
  const { addWorkingDays } = await import("./planning");
  const { formatPlate } = await import("./types");
  const wt = workingTimeOf(settings);
  const today = dubaiToday();
  type Row = { id: string; number: string; method: "cheque" | "transfer"; amount_aed: number | string; received_at: string; cheque_number: string | null; cheque_bank: string | null; cheque_date: string | null; reference: string | null; proof_path: string | null; job_id: string | null; cheque_deposited_at?: string | null; cheque_deposited_to?: string | null; job: { job_number: string; vehicle: Parameters<typeof formatPlate>[0] | null } | null; customer: { full_name: string | null; company_name: string | null } | null };
  const rows = (data ?? []) as unknown as Row[];
  const { groupWordsFor } = await import("./payment-groups");
  const groups = await groupWordsFor(rows.map((r) => r.id));
  return rows.map((p) => ({
    id: p.id,
    number: p.number,
    method: p.method,
    amount: round2(Number(p.amount_aed) || 0),
    receivedAt: p.received_at,
    chequeNumber: p.cheque_number,
    chequeBank: p.cheque_bank,
    chequeDate: p.cheque_date,
    notDue: p.method === "cheque" ? chequeNotDue(p.cheque_date, today) : null,
    depositedAt: p.cheque_deposited_at ?? null,
    depositedTo: p.cheque_deposited_to ?? null,
    reference: p.reference,
    jobId: p.job_id,
    jobNumber: p.job?.job_number ?? null,
    plate: p.job?.vehicle ? formatPlate(p.job.vehicle) : "",
    customer: p.customer?.company_name || p.customer?.full_name || "",
    late: addWorkingDays(dubaiDay(p.received_at), 3, wt) < today,
    proofPath: p.proof_path,
    group: groups.has(p.id) ? { number: groups.get(p.id)!.number, words: groups.get(p.id)!.words, total: groups.get(p.id)!.amount } : null,
  }));
}

export { bankWord };
