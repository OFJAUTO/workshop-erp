import "server-only";
import { createAdminClient } from "./supabase/admin";
import { bankFeesOf, type Settings } from "./settings";
import { feesFor } from "./bank-fees";
import { needsAuthCode } from "./auth-code";
import { notifyRoles } from "./notifications";
import { checkPaymentDate, dateRoleOf, dubaiDayOf, monthMismatchWords, stampOfDay } from "./payment-date-rules";
import { flagZohoAttention, reopenZoho } from "./zoho-sync";
import { photoSizesLater } from "./photo-sizes";

/*
 * THE payment date on the server (17 November 2026, Section 3): the closed month, the "different month from its tax
 * invoice" flag, and "Correct this payment" for customer payments (date, method, reference, proof - never the amount or
 * the customer; a reason; the old values kept in the history; Zoho on OFJ TEST: taken back and posted again).
 */

/** "YYYY-MM" the books are closed through (Settings > Money), or null. */
export function closedThroughOf(settings: Settings): string | null {
  const v = String((settings as unknown as Record<string, unknown>).books_closed_through ?? "").trim();
  return /^\d{4}-\d{2}$/.test(v) ? v : null;
}

const METHODS = ["cash", "card", "link", "transfer", "cheque"] as const;
const BANK = new Set(["cheque", "transfer"]);

/** A payment dated in another month than its tax invoice: accounts are told (the invoice's date is never changed). */
export async function flagPaymentMonth(paymentId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("payments").select("id, number, received_at, invoice_id, job_id").eq("id", paymentId).maybeSingle();
  if (!p?.invoice_id) return null;
  const { data: inv } = await admin.from("invoices").select("number, kind, issued_at, status").eq("id", p.invoice_id).maybeSingle();
  if (!inv || inv.kind !== "tax_invoice" || !inv.issued_at) return null;
  const words = monthMismatchWords({ number: String(p.number), day: dubaiDayOf(p.received_at as string) }, { number: String(inv.number), day: dubaiDayOf(inv.issued_at as string) });
  if (!words) return null;
  await notifyRoles(["accounts"], { type: "payment_month_differs", title: `Payment in another month than its tax invoice · ${p.number}`, body: words, jobId: (p.job_id as string | null) ?? null, href: p.job_id ? `/jobs/${p.job_id}/invoice` : "/invoices" }).catch(() => null);
  return words;
}

export type CorrectionChange = { field: string; old: string; new: string };
export type PaymentCorrection = { at: string; by: string; reason: string; changes: CorrectionChange[] };

/** The corrections of these payments (newest last), from the change log. */
export async function paymentCorrections(ids: string[]): Promise<Map<string, PaymentCorrection[]>> {
  const out = new Map<string, PaymentCorrection[]>();
  if (!ids.length) return out;
  const { data } = await createAdminClient().from("audit_log").select("record_id, new_data, changed_at").eq("table_name", "payments").in("record_id", ids).not("new_data->correction", "is", null).order("changed_at");
  for (const r of (data ?? []) as { record_id: string; new_data: { correction?: PaymentCorrection } | null }[]) {
    const c = r.new_data?.correction;
    if (c) out.set(r.record_id, [...(out.get(r.record_id) ?? []), c]);
  }
  return out;
}

const LABEL: Record<string, string> = { cash: "Cash", card: "Card machine", link: "Payment link", transfer: "Bank transfer", cheque: "Cheque" };
const nice = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * "Correct this payment" (customer payments): the date, method, reference or proof, with a reason. Owner and accounts.
 * The amount and the customer cannot change here (void it and record it again). A payment already in Zoho is taken
 * back and posted again at the next Sync to Zoho (OFJ TEST until go-live); one already moved to the bank in Zoho turns
 * red for the accountant instead.
 */
export async function correctCustomerPayment(
  paymentId: string,
  c: { day: string | null; method: string | null; reference: string | null; proof: File | null; reason: string },
  by: { id: string; display_name: string; role_id: string },
  settings: Settings,
): Promise<{ error?: string; words?: string }> {
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only the owner or accounts correct a payment." };
  const reason = c.reason.trim();
  if (reason.length < 5) return { error: "Write why it is corrected (a few words) – it stays in the history." };
  const admin = createAdminClient();
  const { data: raw } = await admin.from("payments").select("id, number, status, method, amount_aed, received_at, reference, proof_path, job_id, invoice_id, customer_id, settlement_id, zoho_payment_id, cheque_status, is_deposit, auth_code").eq("id", paymentId).maybeSingle();
  const p = raw as { id: string; number: string; status: string; method: string; amount_aed: number | string; received_at: string; reference: string | null; proof_path: string | null; job_id: string | null; invoice_id: string | null; customer_id: string; settlement_id: string | null; zoho_payment_id: string | null; cheque_status: string | null; is_deposit: boolean; auth_code: string | null } | null;
  if (!p) return { error: "This payment is not there any more. Reload the page." };
  if (p.status !== "recorded" && p.status !== "pending_owner") return { error: `${p.number} is ${p.status}: nothing to correct.` };
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const oldDay = dubaiDayOf(p.received_at);
  const newDay = c.day && c.day !== oldDay ? c.day : null;
  const newMethod = c.method && c.method !== p.method ? c.method : null;
  if (c.method && !(METHODS as readonly string[]).includes(c.method)) return { error: "Pick how it was really paid." };
  const ref = (c.reference ?? "").trim().slice(0, 120) || null;
  const refChanged = ref !== (p.reference ?? null);
  if (!newDay && !newMethod && !refChanged && !c.proof) return { error: "Nothing changed: change the date, the method, the reference or the proof." };
  if (newDay) {
    const chk = checkPaymentDate({ day: newDay, today, role: dateRoleOf(by.role_id), closedThrough: closedThroughOf(settings) });
    if (!chk.ok) return { error: chk.error };
    // The month it LEAVES must be open too (moving a payment out of a closed month changes that month).
    const fromClosed = checkPaymentDate({ day: oldDay, today, role: dateRoleOf(by.role_id), closedThrough: closedThroughOf(settings) });
    if (!fromClosed.ok && fromClosed.needsOwner) return { error: fromClosed.error };
  }
  // A card or link payment already in a bank settlement keeps its method, and its day stays on or before the settlement.
  if (p.settlement_id && (newMethod || newDay)) {
    const { data: st } = await admin.from("card_settlements").select("number, settled_on").eq("id", p.settlement_id).maybeSingle();
    if (newMethod) return { error: `${p.number} is in the bank settlement ${st?.number ?? ""}: its method cannot change. Undo the settlement first (Accounts posting).` };
    if (newDay && st?.settled_on && newDay > String(st.settled_on).slice(0, 10)) return { error: `${p.number} is in the bank settlement ${st.number} of ${nice(String(st.settled_on).slice(0, 10))}: its date cannot be after that day.` };
  }
  const changes: CorrectionChange[] = [];
  const update: Record<string, unknown> = { updated_by: by.id };
  if (newDay) {
    changes.push({ field: "Date", old: nice(oldDay), new: nice(newDay) });
    update.received_at = stampOfDay(newDay, today, new Date().toISOString());
  }
  if (newMethod) {
    changes.push({ field: "Method", old: LABEL[p.method] ?? p.method, new: LABEL[newMethod] ?? newMethod });
    update.method = newMethod;
    const fees = feesFor(Number(p.amount_aed) || 0, bankFeesOf(settings)[newMethod as keyof ReturnType<typeof bankFeesOf>]);
    Object.assign(update, { bank_charge_aed: fees.cost, fee_msf_aed: fees.msf, fee_txn_aed: fees.txn, fee_vat_aed: fees.vat });
    if (!needsAuthCode(newMethod)) update.auth_code = null;
    if (BANK.has(newMethod) && !BANK.has(p.method)) update.cheque_status = "pending";
    if (!BANK.has(newMethod) && BANK.has(p.method)) Object.assign(update, { cheque_status: null, cleared_at: null });
  }
  if (refChanged) {
    changes.push({ field: "Reference", old: p.reference ?? "", new: ref ?? "" });
    update.reference = ref;
  }
  if (c.proof) {
    if (c.proof.size > 25 * 1024 * 1024) return { error: "The proof is too large (over 25 MB)." };
    const ext = c.proof.type.includes("png") ? "png" : c.proof.type.includes("webp") ? "webp" : c.proof.type.includes("pdf") ? "pdf" : "jpg";
    const path = `payments/${p.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage.from("job-files").upload(path, Buffer.from(await c.proof.arrayBuffer()), { contentType: c.proof.type || "image/jpeg", upsert: false });
    if (upErr) return { error: "The proof could not be saved – nothing was changed. Try again." };
    photoSizesLater("job-files", path, c.proof.type || "image/jpeg");
    changes.push({ field: "Proof", old: p.proof_path ? "a proof" : "none", new: "new proof" });
    update.proof_path = path;
  }
  const { data: done, error } = await admin.from("payments").update(update).eq("id", p.id).in("status", ["recorded", "pending_owner"]).select("id");
  if (error || !done?.length) return { error: "Couldn't save – nothing was changed. Try again." };
  const correction: PaymentCorrection = { at: new Date().toISOString(), by: by.display_name, reason, changes };
  await admin.from("audit_log").insert({ table_name: "payments", record_id: p.id, action: "update", old_data: { received_at: p.received_at, method: p.method, reference: p.reference, proof_path: p.proof_path }, new_data: { correction, number: p.number }, changed_by: by.id });
  const words = `${p.number} corrected by ${by.display_name}: ${changes.map((x) => `${x.field} ${x.old || "—"} → ${x.new || "—"}`).join("; ")} (${reason}).`;
  if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "payment", note: words, created_by: by.id });
  // Zoho: posted already = taken back and posted again; moved to the bank there already = the accountant's, by hand.
  const kind = p.is_deposit && !p.invoice_id ? "deposit" : "payment";
  let zohoWords = "";
  if (p.zoho_payment_id && (newDay || newMethod || refChanged)) {
    const { data: moved } = await admin.from("zoho_outbox").select("status").eq("kind", "bankmove").eq("record_id", p.id).eq("status", "synced").maybeSingle();
    if (moved) {
      await flagZohoAttention(kind, p.id, `${p.number} was corrected after it reached Zoho and was moved to the bank there (${changes.map((x) => `${x.field} ${x.old} → ${x.new}`).join("; ")}): correct it in Zoho by hand, then press "Done by hand".`);
      zohoWords = " Zoho: corrected by hand (it was already moved to the bank there).";
    } else {
      const { data: ob } = await admin.from("zoho_outbox").select("zoho_result").eq("kind", kind).eq("record_id", p.id).maybeSingle();
      const prev = ((ob as { zoho_result?: Record<string, unknown> | null } | null)?.zoho_result ?? {}) as Record<string, unknown>;
      await admin.from("zoho_outbox").update({ zoho_result: { ...prev, repost_requested_at: new Date().toISOString(), repost_reason: reason } }).eq("kind", kind).eq("record_id", p.id);
      await reopenZoho(kind, p.id);
      zohoWords = " Its Zoho payment is taken back and posted again at the next Sync to Zoho.";
    }
  } else if (newDay || newMethod || refChanged) {
    await reopenZoho(kind, p.id);
  }
  const month = newDay ? await flagPaymentMonth(p.id) : null;
  return { words: `${words}${zohoWords}${month ? ` ${month}` : ""}` };
}

/**
 * The bank paid out on a day BEFORE the day these receipts were recorded (18 November 2026, Mathew: "NETWORK
 * COLLECTION POSTING ON 13/11" with receipts recorded on 14 Nov): the customer paid on or before the bank day, so each
 * receipt's payment date moves to it through THE correction (closed months, Zoho re-post and the history included).
 * Returns words when one is refused (the ones before it stay corrected, each with its own history line).
 */
export async function moveLateReceipts(late: { id: string; number: string; day: string }[], bankDay: string, by: { id: string; display_name: string; role_id: string }, settings: Settings): Promise<string | null> {
  for (const p of late) {
    const res = await correctCustomerPayment(p.id, { day: bankDay, method: null, reference: null, proof: null, reason: `Paid on or before the bank settlement of ${nice(bankDay)} (the receipt was recorded on ${nice(p.day)})` }, by, settings);
    if (res.error) return `${p.number}: ${res.error}`;
  }
  return null;
}
